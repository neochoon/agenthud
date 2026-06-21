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

const {
  App,
  appendSubAgentRows,
  findParentTarget,
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

  it("alive session default appends hot/warm sub-agents plus a sub-summary sentinel for the rest", () => {
    const session = sessionWith("s1", "warm", [
      baseSubAgent("a", "hot"),
      baseSubAgent("b", "warm"),
      baseSubAgent("c", "cold"),
    ]);
    const result: SessionNode[] = [];
    appendSubAgentRows(result, session, new Set());
    expect(result.map((n) => n.id)).toEqual(["a", "b", "__sub-s1__"]);
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

describe("viewer search → Enter opens Detail View", () => {
  const tick = () => new Promise((r) => setTimeout(r, 50));

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
    mockActivities = [
      {
        timestamp: new Date(),
        type: "tool",
        icon: "○",
        label: "Read",
        detail: "auth.ts",
        detailBody: "DETAIL_BODY_MARKER",
        detailKind: "code",
      },
      {
        timestamp: new Date(),
        type: "tool",
        icon: "$",
        label: "Bash",
        detail: "npm test",
      },
    ];

    const { stdin, lastFrame } = render(<App mode="watch" />);
    await tick();
    stdin.write("\t"); // focus tree → viewer
    await tick();
    stdin.write("/"); // open viewer search
    await tick();
    for (const ch of "auth") {
      stdin.write(ch); // type char-by-char (ink delivers each as length-1 input)
      await tick();
    }
    stdin.write("\r"); // Enter → open the matched activity's Detail View

    // The Detail View renders the matched activity's body — the bug was that
    // Enter only positioned the cursor + closed search without opening detail.
    // waitFor polls so the assertion is robust to render-flush timing.
    await vi.waitFor(
      () => expect(lastFrame() ?? "").toContain("DETAIL_BODY_MARKER"),
      { timeout: 3000, interval: 25 },
    );
  });
});
