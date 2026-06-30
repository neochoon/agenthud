// tests/ui/App.test.tsx
import { render } from "ink-testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActivityEntry,
  ProjectNode,
  SessionNode,
  SessionTree,
} from "../../src/types/index.js";

vi.mock("../../src/config/globalConfig.js", () => ({
  loadGlobalConfig: () => ({
    refreshIntervalMs: 60000,
    hiddenSessions: [],
    hiddenSubAgents: [],
    filterPresets: [[], ["response"], ["commit"]],
  }),
  hasProjectLevelConfig: () => false,
}));

let mockTree: SessionTree = {
  projects: [],
  coldProjects: [],
  totalCount: 0,
  timestamp: new Date().toISOString(),
  hiddenStats: { total: 0, active: 0 },
};

vi.mock("../../src/data/sessions.js", () => ({
  discoverSessions: () => mockTree,
  getProjectsDir: () => "/tmp/nonexistent-projects-dir",
}));

let mockActivities: ActivityEntry[] = [];
vi.mock("../../src/data/sessionHistory.js", () => ({
  parseSessionHistory: () => mockActivities,
}));

// The search integration tests drive many sequential keystrokes, each gated on
// a condition wait. On slow CI runners (notably Windows) the *sum* of those
// steps can exceed Vitest's default 5s per-test budget — the layering test died
// at ~5082ms there while passing on macOS/Linux. Raise the ceiling for the whole
// file; fast tests are unaffected (a higher cap doesn't slow a quick test), and
// each `vi.waitFor` keeps its own 3s timeout so a genuinely stuck condition
// still fails fast.
vi.setConfig({ testTimeout: 20000 });

const {
  App,
  appendSubAgentRows,
  findParentTarget,
  collapseTargetForChild,
  seededDetailSearch,
  initialSelectedId,
  initialExpandedIds,
  filterTreeByHidden,
  computeCensus,
} = await import("../../src/ui/App.js");

const emptyTree = (): SessionTree => ({
  projects: [],
  coldProjects: [],
  totalCount: 0,
  timestamp: new Date().toISOString(),
  hiddenStats: { total: 0, active: 0 },
});

const makeColdSession = (projectName: string, id: string): SessionNode => ({
  id,
  hideKey: `${projectName}/${id}`,
  filePath: `/tmp/${projectName}/${id}.jsonl`,
  projectPath: `/tmp/${projectName}`,
  projectName,
  lastModifiedMs: Date.now() - 7 * 24 * 60 * 60 * 1000, // a week ago
  status: "cold",
  modelName: null,
  subAgents: [],
  nonInteractive: false,
  firstUserPrompt: null,
  liveState: null,
});

const makeColdProject = (name: string): ProjectNode => ({
  name,
  projectPath: `/tmp/${name}`,
  sessions: [makeColdSession(name, `${name}-sess`)],
  hotness: "cold",
});

beforeEach(() => {
  mockTree = emptyTree();
  mockActivities = [];
});

describe("App", () => {
  it("renders without crashing when there are no sessions", () => {
    const { lastFrame } = render(<App mode="once" />);
    expect(lastFrame()).toContain("No Claude sessions");
  });

  it("renders watch-mode shell without crashing", () => {
    const { lastFrame } = render(<App mode="watch" />);
    const out = lastFrame() ?? "";
    // The branding ("AgentHUD vX.Y.Z") is conditionally hidden on narrow
    // terminals (ink-testing-library defaults to 80 cols). Verify watch-
    // mode rendered SOMETHING by checking for any of the always-present
    // status-bar / panel indicators.
    expect(out).toMatch(/(Tab:|Projects|q: quit)/);
  });
});

describe("App with only cold projects (post-vacation boot)", () => {
  beforeEach(() => {
    mockTree = {
      projects: [],
      coldProjects: [
        makeColdProject("alpha"),
        makeColdProject("beta"),
        makeColdProject("gamma"),
      ],
      totalCount: 3,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
  });

  it("expands the cold group at boot so the cold projects are visible", () => {
    const { lastFrame } = render(<App mode="once" />);
    const out = lastFrame() ?? "";
    // Without the fix, only the "3 cold" summary row renders and the
    // individual project names stay hidden behind the collapsed sentinel.
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
    expect(out).toContain("gamma");
  });
});

describe("initialSelectedId", () => {
  it("returns the first hot project's sentinel when hot projects exist", () => {
    const tree: SessionTree = {
      projects: [makeColdProject("hot1")], // shape only — sit-in for any project
      coldProjects: [makeColdProject("cold1")],
      totalCount: 2,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    expect(initialSelectedId(tree)).toBe("__proj-hot1__");
  });

  it("falls back to __cold__ when only cold projects exist", () => {
    const tree: SessionTree = {
      projects: [],
      coldProjects: [makeColdProject("cold1"), makeColdProject("cold2")],
      totalCount: 2,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    expect(initialSelectedId(tree)).toBe("__cold__");
  });

  it("returns null when no projects exist at all", () => {
    expect(initialSelectedId(emptyTree())).toBeNull();
  });
});

describe("initialExpandedIds", () => {
  it("expands __cold__ when only cold projects exist", () => {
    const tree: SessionTree = {
      projects: [],
      coldProjects: [makeColdProject("cold1")],
      totalCount: 1,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    expect(initialExpandedIds(tree).has("__cold__")).toBe(true);
  });

  it("leaves __cold__ collapsed when hot projects exist", () => {
    const tree: SessionTree = {
      projects: [makeColdProject("hot1")],
      coldProjects: [makeColdProject("cold1")],
      totalCount: 2,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    expect(initialExpandedIds(tree).has("__cold__")).toBe(false);
  });

  it("returns an empty set when there are no projects at all", () => {
    expect(initialExpandedIds(emptyTree()).size).toBe(0);
  });
});

describe("appendSubAgentRows", () => {
  const baseSubAgent = (
    id: string,
    status: SessionNode["status"],
  ): SessionNode => ({
    id,
    hideKey: `parent/${id}`,
    filePath: `/tmp/${id}.jsonl`,
    projectPath: "/tmp/p",
    projectName: "p",
    lastModifiedMs: 0,
    status,
    modelName: null,
    subAgents: [],
    nonInteractive: false,
    firstUserPrompt: null,
    liveState: null,
  });

  const sessionWith = (
    id: string,
    status: SessionNode["status"],
    subs: SessionNode[],
  ): SessionNode => ({
    id,
    hideKey: `p/${id}`,
    filePath: `/tmp/p/${id}.jsonl`,
    projectPath: "/tmp/p",
    projectName: "p",
    lastModifiedMs: 0,
    status,
    modelName: null,
    subAgents: subs,
    nonInteractive: false,
    firstUserPrompt: null,
    liveState: null,
  });

  it("cold session with no expand keys appends nothing (hidden by default)", () => {
    const session = sessionWith("s1", "cold", [
      baseSubAgent("a", "hot"),
      baseSubAgent("b", "cold"),
    ]);
    const result: SessionNode[] = [];
    appendSubAgentRows(result, session, new Set());
    expect(result).toEqual([]);
  });

  it("cold session expanded via sessionExpandedKey appends ALL sub-agents", () => {
    // This is the bug we're fixing: the previous code only checked
    // expandedIds.has(session.id), so a cold session expanded with Enter
    // (which sets `__expanded-session-<id>`) returned only hot/warm +
    // sentinel — the cold sub-agents that the renderer was showing
    // were missing from the navigable flat list.
    const subs = [
      baseSubAgent("a", "hot"),
      baseSubAgent("b", "cold"),
      baseSubAgent("c", "cold"),
    ];
    const session = sessionWith("s1", "cold", subs);
    const result: SessionNode[] = [];
    appendSubAgentRows(result, session, new Set(["__expanded-session-s1"]));
    expect(result.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("alive session default shows only running sub-agents + a sub-summary sentinel for the rest", () => {
    const session = sessionWith("s1", "warm", [
      baseSubAgent("a", "hot"),
      baseSubAgent("b", "warm"),
      baseSubAgent("c", "cold"),
    ]);
    const result: SessionNode[] = [];
    appendSubAgentRows(result, session, new Set());
    // Only the running (hot) sub-agent shows; warm + cold fold into the summary.
    expect(result.map((n) => n.id)).toEqual(["a", "__sub-s1__"]);
  });

  it("alive session with session.id in expandedIds appends ALL sub-agents", () => {
    const session = sessionWith("s1", "warm", [
      baseSubAgent("a", "hot"),
      baseSubAgent("b", "cold"),
    ]);
    const result: SessionNode[] = [];
    appendSubAgentRows(result, session, new Set(["s1"]));
    expect(result.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("alive session with sessionCollapsedKey appends nothing", () => {
    const session = sessionWith("s1", "warm", [
      baseSubAgent("a", "hot"),
      baseSubAgent("b", "cold"),
    ]);
    const result: SessionNode[] = [];
    appendSubAgentRows(result, session, new Set(["__collapsed-session-s1"]));
    expect(result).toEqual([]);
  });

  it("shows only running (hot) sub-agents individually; groups warm under the summary", () => {
    const session = sessionWith("s1", "hot", [
      baseSubAgent("run", "hot"),
      baseSubAgent("done", "warm"),
      baseSubAgent("old", "cool"),
    ]);
    const result: SessionNode[] = [];
    appendSubAgentRows(result, session, new Set());
    const ids = result.map((n) => n.id);
    expect(ids).toContain("run"); // running shown individually
    expect(ids).not.toContain("done"); // finished (warm) now grouped
    expect(ids).toContain("__sub-s1__"); // summary present
  });

  it("keeps a live (working) sub-agent individual even when its status is warm", () => {
    const live = baseSubAgent("livewarm", "warm");
    live.liveState = "working";
    const session = sessionWith("s2", "hot", [
      live,
      baseSubAgent("done", "warm"),
    ]);
    const result: SessionNode[] = [];
    appendSubAgentRows(result, session, new Set());
    const ids = result.map((n) => n.id);
    expect(ids).toContain("livewarm"); // live → shown despite warm
    expect(ids).not.toContain("done"); // non-live warm → grouped
    expect(ids).toContain("__sub-s2__");
  });
});

describe("collapseTargetForChild", () => {
  const node = (
    id: string,
    status: SessionNode["status"],
    subAgents: SessionNode[] = [],
  ): SessionNode => ({
    id,
    hideKey: `p/${id}`,
    filePath: `/tmp/${id}.jsonl`,
    projectPath: "/tmp/p",
    projectName: "p",
    lastModifiedMs: 0,
    status,
    modelName: null,
    subAgents,
    nonInteractive: false,
    firstUserPrompt: null,
    liveState: null,
  });
  const treeWith = (
    activeSessions: SessionNode[],
    coldSessions: SessionNode[],
  ): SessionTree => ({
    projects: activeSessions.length
      ? [
          {
            name: "p",
            projectPath: "/tmp/p",
            sessions: activeSessions,
            hotness: "hot",
          },
        ]
      : [],
    coldProjects: coldSessions.length
      ? [
          {
            name: "cp",
            projectPath: "/tmp/cp",
            sessions: coldSessions,
            hotness: "cold",
          },
        ]
      : [],
    totalCount: activeSessions.length + coldSessions.length,
    timestamp: new Date().toISOString(),
    hiddenStats: { total: 0, active: 0 },
  });

  it("collapses a cold session's `__expanded-session-` reveal from a child sub-agent", () => {
    const parent = node("p1", "cold", [node("a", "cold")]);
    const tree = treeWith([], [parent]);
    const result = collapseTargetForChild(
      "a",
      tree,
      new Set(["__expanded-session-p1"]),
    );
    expect(result).not.toBeNull();
    expect(result?.parentId).toBe("p1");
    expect(result?.nextExpandedIds.has("__expanded-session-p1")).toBe(false);
  });

  it("collapses an alive session's cool/cold reveal (bare id key) from a child", () => {
    const parent = node("p2", "hot", [node("b", "cool")]);
    const tree = treeWith([parent], []);
    const result = collapseTargetForChild("b", tree, new Set(["p2"]));
    expect(result?.parentId).toBe("p2");
    expect(result?.nextExpandedIds.has("p2")).toBe(false);
  });

  it("returns null when the parent is not expanded (nothing extra to hide)", () => {
    const parent = node("p3", "cold", [node("c", "cold")]);
    const tree = treeWith([], [parent]);
    expect(collapseTargetForChild("c", tree, new Set())).toBeNull();
  });

  it("returns null when the selected row is not a sub-agent", () => {
    const parent = node("p4", "cold", [node("d", "cold")]);
    const tree = treeWith([], [parent]);
    expect(
      collapseTargetForChild("p4", tree, new Set(["__expanded-session-p4"])),
    ).toBeNull();
  });
});

describe("seededDetailSearch", () => {
  const act = (over: Partial<ActivityEntry>): ActivityEntry => ({
    timestamp: new Date(),
    type: "tool",
    icon: "○",
    label: "Tool",
    detail: "",
    ...over,
  });

  it("seeds a committed detail search when the body (detail) contains the query", () => {
    // user/thinking-style entry: no detailBody, detail = full text
    const a = act({
      type: "thinking",
      label: "Thinking",
      detail: "first line\n...lean on the AskUserQuestion tool to surface...",
    });
    const seed = seededDetailSearch(a, "AskUserQuestion");
    expect(seed).toEqual({
      surface: "detail",
      query: "AskUserQuestion",
      index: 0,
      committed: true,
    });
  });

  it("uses detailBody as the body when present", () => {
    const a = act({
      detail: "npm test",
      detailBody: "line 1\nFAIL auth.test.ts\nline 3",
    });
    expect(seededDetailSearch(a, "FAIL")?.surface).toBe("detail");
  });

  it("returns null when the body lacks the query (matched only the one-line detail)", () => {
    // Viewer matched the one-line `detail`, but the Detail body is detailBody
    // which doesn't contain it → don't seed an empty search.
    const a = act({ detail: "run modal", detailBody: "alpha\nbeta\ngamma" });
    expect(seededDetailSearch(a, "modal")).toBeNull();
  });

  it("returns null for an empty query", () => {
    expect(seededDetailSearch(act({ detail: "x" }), "")).toBeNull();
  });
});

describe("findParentTarget", () => {
  const sub = (id: string): SessionNode => ({
    id,
    hideKey: "",
    filePath: "",
    projectPath: "",
    projectName: "",
    lastModifiedMs: 0,
    status: "cold",
    modelName: null,
    subAgents: [],
    nonInteractive: false,
    firstUserPrompt: null,
    liveState: null,
  });

  const session = (id: string, subs: SessionNode[] = []): SessionNode => ({
    id,
    hideKey: `p/${id}`,
    filePath: `/tmp/p/${id}.jsonl`,
    projectPath: "/tmp/p",
    projectName: "p",
    lastModifiedMs: 0,
    status: "warm",
    modelName: null,
    subAgents: subs,
    nonInteractive: false,
    firstUserPrompt: null,
    liveState: null,
  });

  const project = (name: string, sessions: SessionNode[]): ProjectNode => ({
    name,
    projectPath: `/tmp/${name}`,
    sessions,
    hotness: sessions[0]?.status ?? "cold",
  });

  it("sub-agent row → containing session id", () => {
    const sa = sub("a1");
    const s = session("s1", [sa]);
    const tree: SessionTree = {
      projects: [project("p1", [s])],
      coldProjects: [],
      totalCount: 1,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    expect(findParentTarget("a1", tree, [])).toBe("s1");
  });

  it("sub-summary sentinel → encoded parent session id", () => {
    const tree: SessionTree = {
      projects: [],
      coldProjects: [],
      totalCount: 0,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    expect(findParentTarget("__sub-s1__", tree, [])).toBe("s1");
  });

  it("session row → containing project sentinel", () => {
    const s = session("s1");
    const tree: SessionTree = {
      projects: [project("myproj", [s])],
      coldProjects: [],
      totalCount: 1,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    expect(findParentTarget("s1", tree, [])).toBe("__proj-myproj__");
  });

  it("project sentinel → previous row in the flat list", () => {
    const s1 = session("s1");
    const s2 = session("s2");
    const tree: SessionTree = {
      projects: [project("alpha", [s1]), project("beta", [s2])],
      coldProjects: [],
      totalCount: 2,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    const flat: SessionNode[] = [
      // Skip the synthetic sentinel struct details — only id is used.
      { ...s1, id: "__proj-alpha__" } as SessionNode,
      s1,
      { ...s2, id: "__proj-beta__" } as SessionNode,
      s2,
    ];
    expect(findParentTarget("__proj-beta__", tree, flat)).toBe("s1");
  });

  it("topmost project sentinel falls back to itself (no phantom id)", () => {
    const s1 = session("s1");
    const tree: SessionTree = {
      projects: [project("alpha", [s1])],
      coldProjects: [],
      totalCount: 1,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    const flat: SessionNode[] = [
      { ...s1, id: "__proj-alpha__" } as SessionNode,
      s1,
    ];
    expect(findParentTarget("__proj-alpha__", tree, flat)).toBe(
      "__proj-alpha__",
    );
  });

  it("cold-projects sentinel → previous row", () => {
    const s1 = session("s1");
    const tree: SessionTree = {
      projects: [project("alpha", [s1])],
      coldProjects: [project("oldproj", [session("old1")])],
      totalCount: 2,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    const flat: SessionNode[] = [
      { ...s1, id: "__proj-alpha__" } as SessionNode,
      s1,
      { ...s1, id: "__cold__" } as SessionNode,
    ];
    expect(findParentTarget("__cold__", tree, flat)).toBe("s1");
  });
});

describe("filterTreeByHidden", () => {
  // Helper to build a minimal SessionNode for tree shape tests.
  const sn = (id: string, hidden = false): SessionNode => ({
    id,
    hideKey: `proj/${id}`,
    filePath: "",
    projectPath: "/path/proj",
    projectName: "proj",
    lastModifiedMs: 1,
    status: "hot",
    modelName: null,
    subAgents: [],
    nonInteractive: false,
    firstUserPrompt: null,
    liveState: null,
    hidden,
  });

  it("strips sessions marked hidden", () => {
    const tree: SessionTree = {
      projects: [
        {
          name: "proj",
          projectPath: "/path/proj",
          sessions: [sn("a"), sn("b", true), sn("c")],
          hotness: "hot",
        },
      ],
      coldProjects: [],
      totalCount: 3,
      timestamp: "",
      hiddenStats: { total: 1, active: 1 },
    };
    const out = filterTreeByHidden(tree);
    expect(out.projects[0].sessions.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("strips entire projects marked hidden", () => {
    const tree: SessionTree = {
      projects: [
        {
          name: "visible",
          projectPath: "/v",
          sessions: [sn("a")],
          hotness: "hot",
        },
        {
          name: "secret",
          projectPath: "/s",
          sessions: [sn("b"), sn("c")],
          hotness: "hot",
          hidden: true,
        },
      ],
      coldProjects: [],
      totalCount: 3,
      timestamp: "",
      hiddenStats: { total: 2, active: 2 },
    };
    const out = filterTreeByHidden(tree);
    expect(out.projects.map((p) => p.name)).toEqual(["visible"]);
  });

  it("strips hidden sub-agents from kept sessions", () => {
    const parent: SessionNode = {
      ...sn("p"),
      subAgents: [sn("s1"), sn("s2", true)],
    };
    const tree: SessionTree = {
      projects: [
        {
          name: "proj",
          projectPath: "/p",
          sessions: [parent],
          hotness: "hot",
        },
      ],
      coldProjects: [],
      totalCount: 3,
      timestamp: "",
      hiddenStats: { total: 1, active: 1 },
    };
    const out = filterTreeByHidden(tree);
    expect(out.projects[0].sessions[0].subAgents.map((s) => s.id)).toEqual([
      "s1",
    ]);
  });

  it("preserves hiddenStats so the status bar still reflects them", () => {
    const tree: SessionTree = {
      projects: [],
      coldProjects: [],
      totalCount: 0,
      timestamp: "",
      hiddenStats: { total: 5, active: 2 },
    };
    expect(filterTreeByHidden(tree).hiddenStats).toEqual({
      total: 5,
      active: 2,
    });
  });
});

describe("computeCensus", () => {
  // Compact helper to build a SessionNode for census tests.
  const node = (
    id: string,
    status: SessionNode["status"] = "hot",
    hidden = false,
    subAgents: SessionNode[] = [],
  ): SessionNode => ({
    id,
    hideKey: `proj/${id}`,
    filePath: "",
    projectPath: "/path/proj",
    projectName: "proj",
    lastModifiedMs: 1,
    status,
    modelName: null,
    subAgents,
    nonInteractive: false,
    firstUserPrompt: null,
    liveState: null,
    hidden,
  });

  it("counts per level: projects, sessions, sub-agents", () => {
    const tree: SessionTree = {
      projects: [
        {
          name: "p1",
          projectPath: "/p1",
          sessions: [node("s1", "hot", false, [node("sa1", "hot")])],
          hotness: "hot",
        },
        {
          name: "p2",
          projectPath: "/p2",
          sessions: [node("s2", "cold")],
          hotness: "cold",
        },
      ],
      coldProjects: [],
      totalCount: 3,
      timestamp: "",
      hiddenStats: { total: 0, active: 0 },
    };
    const c = computeCensus(tree);
    expect(c.projects).toEqual({ total: 2, active: 1 });
    expect(c.sessions).toEqual({ total: 2, active: 1 });
    expect(c.subAgents).toEqual({ total: 1, active: 1 });
    expect(c.hidden).toEqual({ total: 0, active: 0 });
  });

  it("hidden sessions count toward hidden, not visible active", () => {
    const tree: SessionTree = {
      projects: [
        {
          name: "p1",
          projectPath: "/p1",
          sessions: [
            node("visible", "hot"),
            node("hidden-hot", "hot", true),
            node("hidden-cold", "cold", true),
          ],
          hotness: "hot",
        },
      ],
      coldProjects: [],
      totalCount: 3,
      timestamp: "",
      hiddenStats: { total: 2, active: 1 },
    };
    const c = computeCensus(tree);
    expect(c.sessions.total).toBe(3);
    expect(c.sessions.active).toBe(1); // only the visible hot one
    expect(c.hidden.total).toBe(2); // both hidden sessions
    expect(c.hidden.active).toBe(1); // only the hidden hot
  });

  it("sessions under a hidden project all count as hidden", () => {
    const tree: SessionTree = {
      projects: [],
      coldProjects: [
        {
          name: "secret",
          projectPath: "/secret",
          sessions: [node("a", "hot"), node("b", "warm"), node("c", "cold")],
          hotness: "hot",
          hidden: true,
        },
      ],
      totalCount: 3,
      timestamp: "",
      hiddenStats: { total: 3, active: 2 },
    };
    const c = computeCensus(tree);
    expect(c.projects).toEqual({ total: 1, active: 0 });
    expect(c.sessions).toEqual({ total: 3, active: 0 });
    expect(c.hidden).toEqual({ total: 3, active: 2 });
  });

  it("sub-agents inherit hidden state from their parent session", () => {
    const tree: SessionTree = {
      projects: [
        {
          name: "p1",
          projectPath: "/p1",
          sessions: [
            node("visible-parent", "hot", false, [
              node("visible-sa", "hot"),
              node("hidden-sa", "hot", true),
            ]),
            node("hidden-parent", "warm", true, [node("under-hidden", "hot")]),
          ],
          hotness: "hot",
        },
      ],
      coldProjects: [],
      totalCount: 5,
      timestamp: "",
      hiddenStats: { total: 1, active: 1 },
    };
    const c = computeCensus(tree);
    expect(c.subAgents.total).toBe(3);
    // Only "visible-sa" is visible+active. "hidden-sa" is marked,
    // "under-hidden" is under a hidden parent session.
    expect(c.subAgents.active).toBe(1);
    expect(c.hidden.total).toBe(3); // hidden-sa, hidden-parent, under-hidden
    expect(c.hidden.active).toBe(3); // all three are hot/warm
  });

  it("empty tree returns zeros", () => {
    const tree: SessionTree = {
      projects: [],
      coldProjects: [],
      totalCount: 0,
      timestamp: "",
      hiddenStats: { total: 0, active: 0 },
    };
    expect(computeCensus(tree)).toEqual({
      projects: { total: 0, active: 0 },
      sessions: { total: 0, active: 0 },
      subAgents: { total: 0, active: 0 },
      hidden: { total: 0, active: 0 },
      perProject: new Map(),
    });
  });

  it("populates perProject so tree totals equal the sum of per-row counts", () => {
    const tree: SessionTree = {
      projects: [
        {
          name: "alpha",
          projectPath: "/p/alpha",
          hotness: "hot",
          sessions: [
            {
              ...sessionStub("a-hot"),
              status: "hot",
              subAgents: [{ ...sessionStub("sa-warm"), status: "warm" }],
            },
            {
              ...sessionStub("a-cold"),
              status: "cold",
              subAgents: [],
            },
          ],
        },
        {
          name: "beta",
          projectPath: "/p/beta",
          hotness: "cool",
          sessions: [
            {
              ...sessionStub("b-cool"),
              status: "cool",
              subAgents: [{ ...sessionStub("sb-hot"), status: "hot" }],
            },
          ],
        },
      ],
      coldProjects: [],
      totalCount: 5,
      timestamp: "",
      hiddenStats: { total: 0, active: 0 },
    };
    const census = computeCensus(tree);

    expect(census.sessions.active).toBe(1); // a-hot
    expect(census.subAgents.active).toBe(2); // sa-warm + sb-hot

    // Sum of per-project counts must match the top-level totals.
    let sessActiveSum = 0;
    let subAgentActiveSum = 0;
    for (const e of census.perProject.values()) {
      sessActiveSum += e.sessions.active;
      subAgentActiveSum += e.subAgents.active;
    }
    expect(sessActiveSum).toBe(census.sessions.active);
    expect(subAgentActiveSum).toBe(census.subAgents.active);

    // Per-project entries reflect the visible counts a ProjectRow renders.
    expect(census.perProject.get("/p/alpha")).toEqual({
      sessions: { total: 2, active: 1 },
      subAgents: { total: 1, active: 1 },
    });
    expect(census.perProject.get("/p/beta")).toEqual({
      sessions: { total: 1, active: 0 },
      subAgents: { total: 1, active: 1 },
    });
  });
});

function sessionStub(id: string) {
  return {
    id,
    hideKey: id,
    filePath: "",
    projectPath: "",
    projectName: "",
    lastModifiedMs: 0,
    status: "cool" as const,
    modelName: null,
    subAgents: [],
    nonInteractive: false,
    firstUserPrompt: null,
    liveState: null,
  };
}

describe("tree search → Enter keeps search alive", () => {
  const tick = () => new Promise((r) => setTimeout(r, 50));
  const ESC = String.fromCharCode(27);
  const DOWN = ESC + "[B";

  const twoMatchingSessions = (): SessionTree => ({
    projects: [
      {
        name: "proj",
        projectPath: "/tmp/proj",
        hotness: "hot",
        sessions: [
          {
            id: "s1",
            hideKey: "proj/s1",
            filePath: "/tmp/proj/s1.jsonl",
            projectPath: "/tmp/proj",
            projectName: "proj",
            lastModifiedMs: Date.now(),
            status: "hot",
            modelName: null,
            subAgents: [],
            nonInteractive: false,
            firstUserPrompt: "auth login",
            liveState: null,
          },
          {
            id: "s2",
            hideKey: "proj/s2",
            filePath: "/tmp/proj/s2.jsonl",
            projectPath: "/tmp/proj",
            projectName: "proj",
            lastModifiedMs: Date.now(),
            status: "hot",
            modelName: null,
            subAgents: [],
            nonInteractive: false,
            firstUserPrompt: "auth logout",
            liveState: null,
          },
        ],
      },
    ],
    coldProjects: [],
    totalCount: 2,
    timestamp: new Date().toISOString(),
    hiddenStats: { total: 0, active: 0 },
  });

  it("bare Enter filter-confirms without closing the tree search", async () => {
    mockTree = twoMatchingSessions();
    mockActivities = [];

    const { stdin, lastFrame } = render(<App mode="watch" />);
    // Tree is focused at boot ("↵: expand" footer); open tree search directly.
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("↵: expand"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("/");
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("0/0"), {
      timeout: 3000,
      interval: 25,
    });
    for (const ch of "auth") {
      stdin.write(ch);
      await tick();
    }
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1/2"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("\r"); // bare Enter

    // Search stays open (count still rendered), not torn down.
    await tick();
    await tick();
    expect(lastFrame() ?? "").toContain("1/2");
  });

  it("↓ then Enter selects the navigated node and keeps the search open", async () => {
    mockTree = twoMatchingSessions();
    mockActivities = [];

    const { stdin, lastFrame } = render(<App mode="watch" />);
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("↵: expand"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("/");
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("0/0"), {
      timeout: 3000,
      interval: 25,
    });
    for (const ch of "auth") {
      stdin.write(ch);
      await tick();
    }
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1/2"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write(DOWN); // ↓ navigate
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("2/2"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("\r"); // Enter → select node

    // Search remains open after the selection (count still at the navigated 2/2).
    await tick();
    await tick();
    expect(lastFrame() ?? "").toContain("2/2");
  });
});

describe("viewer search → Enter opens Detail View", () => {
  const tick = () => new Promise((r) => setTimeout(r, 50));
  const ESC = String.fromCharCode(27);
  const DOWN = `${ESC}[B`;

  it("opens the matched activity's detail on Enter (not just select+exit)", async () => {
    mockTree = {
      projects: [
        {
          name: "proj",
          projectPath: "/tmp/proj",
          hotness: "hot",
          sessions: [
            {
              id: "s1",
              hideKey: "proj/s1",
              filePath: "/tmp/proj/s1.jsonl",
              projectPath: "/tmp/proj",
              projectName: "proj",
              lastModifiedMs: Date.now(),
              status: "hot",
              modelName: null,
              subAgents: [],
              nonInteractive: false,
              firstUserPrompt: "do auth",
              liveState: null,
            },
          ],
        },
      ],
      coldProjects: [],
      totalCount: 1,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    // Two activities both matching "auth", distinct timestamps so the second
    // (carrying DETAIL_BODY_MARKER) is index 1. Navigating ↓ to it makes the
    // count change 1/2 → 2/2, which is observable — so the test can wait for the
    // navigation to commit before pressing Enter (a single match would leave the
    // count at 1/1, giving nothing to wait on and racing the navigated flag).
    mockActivities = [
      {
        timestamp: new Date(2026, 0, 1, 9, 0, 0),
        type: "tool",
        icon: "○",
        label: "Read",
        detail: "auth.ts",
        detailBody: "FIRST_MARKER",
        detailKind: "code",
      },
      {
        timestamp: new Date(2026, 0, 1, 9, 0, 1),
        type: "tool",
        icon: "○",
        label: "Read",
        detail: "auth.test.ts",
        detailBody: "DETAIL_BODY_MARKER",
        detailKind: "code",
      },
    ];

    const { stdin, lastFrame } = render(<App mode="watch" />);
    // Activities load asynchronously; wait for the viewer to render them before
    // interacting. A fixed tick is race-prone under CI load (the search would
    // have nothing to match, so Enter closes search without opening detail).
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("auth.ts"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("\t"); // focus tree → viewer
    // The `/` handler reads the CURRENT focus to decide the search surface
    // (tree vs viewer). A fixed tick is race-prone: under CI load the focus
    // switch from Tab may not have committed, so `/` opens a TREE search whose
    // Enter only selects a node — it never opens the activity Detail View.
    // Wait for the viewer footer ("↵: detail") to confirm focus is on the
    // viewer before opening search. ("↵: expand" is the tree-focus footer.)
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("↵: detail"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("/"); // open viewer search
    // Wait for the search prompt (empty query renders "0/0") so typed
    // characters are routed to the search input, not the viewer hotkeys.
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("0/0"), {
      timeout: 3000,
      interval: 25,
    });
    for (const ch of "auth") {
      stdin.write(ch); // type char-by-char (ink delivers each as length-1 input)
      await tick();
    }
    // Wait until both matches are computed (`/auth   1/2`) before navigating.
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1/2"), {
      timeout: 3000,
      interval: 25,
    });
    // Navigating the selection (↓) makes Enter a row action; a bare Enter would
    // now filter-confirm instead of opening the Detail View. Wait for the count
    // to advance to 2/2 so the navigated flag is committed before Enter.
    stdin.write(DOWN); // ↓ → second match (carries DETAIL_BODY_MARKER)
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("2/2"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("\r"); // Enter → open the navigated match's Detail View

    // The Detail View renders the matched activity's body — the bug was that
    // Enter only positioned the cursor + closed search without opening detail.
    // waitFor polls so the assertion is robust to render-flush timing.
    await vi.waitFor(
      () => expect(lastFrame() ?? "").toContain("DETAIL_BODY_MARKER"),
      { timeout: 3000, interval: 25 },
    );
  });

  it("restores the viewer search and the matched row after Esc out of Detail", async () => {
    mockTree = {
      projects: [
        {
          name: "proj",
          projectPath: "/tmp/proj",
          hotness: "hot",
          sessions: [
            {
              id: "s1",
              hideKey: "proj/s1",
              filePath: "/tmp/proj/s1.jsonl",
              projectPath: "/tmp/proj",
              projectName: "proj",
              lastModifiedMs: Date.now(),
              status: "hot",
              modelName: null,
              subAgents: [],
              nonInteractive: false,
              firstUserPrompt: "do auth",
              liveState: null,
            },
          ],
        },
      ],
      coldProjects: [],
      totalCount: 1,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    mockActivities = [
      {
        timestamp: new Date(2026, 0, 1, 9, 0, 0),
        type: "tool",
        icon: "○",
        label: "Read",
        detail: "auth.ts",
        detailBody: "READ_MARKER",
        detailKind: "code",
      },
      {
        timestamp: new Date(2026, 0, 1, 9, 0, 1),
        type: "tool",
        icon: "○",
        label: "Write",
        detail: "auth.test.ts",
        detailBody: "WRITE_MARKER",
        detailKind: "code",
      },
    ];

    const { stdin, lastFrame } = render(<App mode="watch" />);
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("auth.ts"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("\t");
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("↵: detail"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("/");
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("0/0"), {
      timeout: 3000,
      interval: 25,
    });
    for (const ch of "auth") {
      stdin.write(ch);
      await tick();
    }
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1/2"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write(DOWN); // ↓ → navigate to 2nd match (Write / auth.test.ts)
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("2/2"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("\r"); // Enter → open that match's Detail
    await vi.waitFor(
      () => expect(lastFrame() ?? "").toContain("WRITE_MARKER"),
      {
        timeout: 3000,
        interval: 25,
      },
    );
    stdin.write(ESC); // Esc → close Detail, back to viewer

    // Viewer search restored at the navigated selection (2/2), Detail closed.
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("2/2"), {
      timeout: 3000,
      interval: 25,
    });
    expect(lastFrame() ?? "").not.toContain("WRITE_MARKER");
  });

  it("bare Enter (no arrow) filter-confirms: search stays open, no detail", async () => {
    mockTree = {
      projects: [
        {
          name: "proj",
          projectPath: "/tmp/proj",
          hotness: "hot",
          sessions: [
            {
              id: "s1",
              hideKey: "proj/s1",
              filePath: "/tmp/proj/s1.jsonl",
              projectPath: "/tmp/proj",
              projectName: "proj",
              lastModifiedMs: Date.now(),
              status: "hot",
              modelName: null,
              subAgents: [],
              nonInteractive: false,
              firstUserPrompt: "do auth",
              liveState: null,
            },
          ],
        },
      ],
      coldProjects: [],
      totalCount: 1,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    mockActivities = [
      {
        timestamp: new Date(2026, 0, 1, 9, 0, 0),
        type: "tool",
        icon: "○",
        label: "Read",
        detail: "auth.ts",
        detailBody: "READ_MARKER",
        detailKind: "code",
      },
      {
        timestamp: new Date(2026, 0, 1, 9, 0, 1),
        type: "tool",
        icon: "○",
        label: "Write",
        detail: "auth.test.ts",
        detailBody: "WRITE_MARKER",
        detailKind: "code",
      },
    ];

    const { stdin, lastFrame } = render(<App mode="watch" />);
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("auth.ts"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("\t");
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("↵: detail"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("/");
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("0/0"), {
      timeout: 3000,
      interval: 25,
    });
    for (const ch of "auth") {
      stdin.write(ch);
      await tick();
    }
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1/2"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("\r"); // bare Enter — no arrow navigation

    // Filter-confirm: search stays open (count still shown), no Detail opened.
    await tick();
    await tick();
    expect(lastFrame() ?? "").toContain("1/2");
    expect(lastFrame() ?? "").not.toContain("READ_MARKER");
    expect(lastFrame() ?? "").not.toContain("WRITE_MARKER");
  });

  it("navigated Enter seeds the Detail body search with the query (jumps to the match)", async () => {
    mockTree = {
      projects: [
        {
          name: "proj",
          projectPath: "/tmp/proj",
          hotness: "hot",
          sessions: [
            {
              id: "s1",
              hideKey: "proj/s1",
              filePath: "/tmp/proj/s1.jsonl",
              projectPath: "/tmp/proj",
              projectName: "proj",
              lastModifiedMs: Date.now(),
              status: "hot",
              modelName: null,
              subAgents: [],
              nonInteractive: false,
              firstUserPrompt: "do auth",
              liveState: null,
            },
          ],
        },
      ],
      coldProjects: [],
      totalCount: 1,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    // Two activities both matching "config" in the one-line detail, so ↓
    // advances the count 1/2 → 2/2 (observable — lets the test wait for the
    // navigated flag to commit before Enter; a single match leaves it 1/1 and
    // races, exactly the #209 trap). The 2nd carries "config" in its body so
    // opening it seeds a committed body search.
    mockActivities = [
      {
        timestamp: new Date(2026, 0, 1, 9, 0, 0),
        type: "tool",
        icon: "○",
        label: "Read",
        detail: "config one",
        detailBody: "irrelevant body",
        detailKind: "code",
      },
      {
        timestamp: new Date(2026, 0, 1, 9, 0, 1),
        type: "tool",
        icon: "○",
        label: "Read",
        detail: "config two",
        detailBody: "line A\nuse config here SEED_MARKER\nline C",
        detailKind: "code",
      },
    ];

    const { stdin, lastFrame } = render(<App mode="watch" />);
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("config two"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("\t");
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("↵: detail"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("/");
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("0/0"), {
      timeout: 3000,
      interval: 25,
    });
    for (const ch of "config") {
      stdin.write(ch);
      await tick();
    }
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1/2"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write(DOWN); // ↓ → 2nd match; wait for the count to commit
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("2/2"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("\r"); // Enter → open the 2nd match's Detail, seeded with "config"

    // Detail open, the matched line jumped into view, and the seeded body
    // search is active (the `/config` prompt with its own count is shown).
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("SEED_MARKER"), {
      timeout: 3000,
      interval: 25,
    });
    expect(lastFrame() ?? "").toContain("/config");
  });

  it("Detail's own search resets on Esc without losing the saved viewer search", async () => {
    mockTree = {
      projects: [
        {
          name: "proj",
          projectPath: "/tmp/proj",
          hotness: "hot",
          sessions: [
            {
              id: "s1",
              hideKey: "proj/s1",
              filePath: "/tmp/proj/s1.jsonl",
              projectPath: "/tmp/proj",
              projectName: "proj",
              lastModifiedMs: Date.now(),
              status: "hot",
              modelName: null,
              subAgents: [],
              nonInteractive: false,
              firstUserPrompt: "do auth",
              liveState: null,
            },
          ],
        },
      ],
      coldProjects: [],
      totalCount: 1,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    mockActivities = [
      {
        timestamp: new Date(2026, 0, 1, 9, 0, 0),
        type: "tool",
        icon: "○",
        label: "Read",
        detail: "auth.ts",
        detailBody: "alpha beta gamma",
        detailKind: "code",
      },
      {
        timestamp: new Date(2026, 0, 1, 9, 0, 1),
        type: "tool",
        icon: "○",
        label: "Write",
        detail: "auth.test.ts",
        detailBody: "alpha beta gamma",
        detailKind: "code",
      },
    ];

    const { stdin, lastFrame } = render(<App mode="watch" />);
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("auth.ts"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("\t");
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("↵: detail"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("/");
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("0/0"), {
      timeout: 3000,
      interval: 25,
    });
    for (const ch of "auth") {
      stdin.write(ch);
      await tick();
    }
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1/2"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write(DOWN); // ↓ navigate to 2nd match
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("2/2"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write("\r"); // open Detail
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("alpha"), {
      timeout: 3000,
      interval: 25,
    });

    // Detail's own body search, then Esc to reset it (stay in Detail).
    // Condition-wait each transition: a fixed tick is race-prone under CI load,
    // and if the search-reset has not committed when the second Esc arrives, that
    // Esc is routed back into the (still-open) detail search instead of closing
    // the Detail — so the viewer search is never restored.
    stdin.write("/");
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("0/0"), {
      timeout: 3000,
      interval: 25,
    });
    for (const ch of "beta") {
      stdin.write(ch);
      await tick();
    }
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1/1"), {
      timeout: 3000,
      interval: 25,
    });
    stdin.write(ESC); // Esc → reset Detail search only (still in Detail)
    // Detail search cleared but still in Detail: the detail footer ("↵/Esc:
    // close") only renders when detailMode is on AND no search is active, so it
    // confirms the reset committed before we send the next Esc.
    await vi.waitFor(
      () => expect(lastFrame() ?? "").toContain("↵/Esc: close"),
      {
        timeout: 3000,
        interval: 25,
      },
    );
    expect(lastFrame() ?? "").toContain("alpha"); // still in Detail body

    // Esc again → close Detail → viewer search restored.
    stdin.write(ESC);
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("2/2"), {
      timeout: 3000,
      interval: 25,
    });
  });
});

describe("App — sub-agent viewer summary header", () => {
  const tick = () => new Promise((r) => setTimeout(r, 50));
  const DOWN = String.fromCharCode(27) + "[B"; // ESC prefix REQUIRED (see prior CI fixes)

  it("shows the intent header when a sub-agent row is selected", async () => {
    mockTree = {
      projects: [
        {
          name: "proj",
          projectPath: "/tmp/proj",
          hotness: "hot",
          sessions: [
            {
              id: "s1",
              hideKey: "proj/s1",
              filePath: "/tmp/proj/s1.jsonl",
              projectPath: "/tmp/proj",
              projectName: "proj",
              lastModifiedMs: Date.now(),
              status: "hot",
              modelName: "sonnet-4.6",
              nonInteractive: false,
              firstUserPrompt: "parent",
              liveState: null,
              subAgents: [
                {
                  id: "a1",
                  hideKey: "proj/a1",
                  filePath: "/tmp/proj/a1.jsonl",
                  projectPath: "/tmp/proj",
                  projectName: "",
                  lastModifiedMs: Date.now(),
                  status: "hot",
                  modelName: "sonnet-4.6",
                  subAgents: [],
                  nonInteractive: false,
                  firstUserPrompt: null,
                  liveState: "working",
                  agentId: "agent-abc123",
                  taskDescription: "DO_THE_THING",
                },
              ],
            },
          ],
        },
      ],
      coldProjects: [],
      totalCount: 1,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    mockActivities = [
      {
        timestamp: new Date(2026, 0, 1, 9, 0, 0),
        type: "tool",
        icon: "○",
        label: "Read",
        detail: "x.ts",
      },
      {
        timestamp: new Date(2026, 0, 1, 9, 0, 2),
        type: "response",
        icon: "✦",
        label: "Response",
        detail: "RESULT_TEXT",
      },
    ];

    const { stdin, lastFrame } = render(<App mode="watch" />);
    // Tree is focused at boot; selection starts on the project sentinel.
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("↵: expand"), {
      timeout: 3000,
      interval: 25,
    });
    // Navigate down to the sub-agent (the LAST nav row: sentinel → session →
    // sub-agent). Press ↓ repeatedly until the header appears, NOT a fixed
    // count: on slow CI a render can take longer than one tick to commit the
    // new selectedIndex, so a burst of ↓ stalls at the session row. Re-pressing
    // is safe (↓ clamps at the bottom), and selecting the sub-agent scrolls its
    // otherwise-folded row into view. `1 steps` is the header-only chip (the
    // true discriminator — `taskDescription` also shows in the tree row).
    for (let i = 0; i < 60; i++) {
      if ((lastFrame() ?? "").includes("1 steps")) break;
      stdin.write(DOWN);
      await tick();
    }
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1 steps"), {
      timeout: 5000,
      interval: 25,
    });
    expect(lastFrame() ?? "").toContain("DO_THE_THING"); // intent in header
  });
});
