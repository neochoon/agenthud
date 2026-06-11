// tests/ui/App.test.tsx
import { render } from "ink-testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
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

vi.mock("../../src/data/sessionHistory.js", () => ({
  parseSessionHistory: () => [],
}));

const {
  App,
  appendSubAgentRows,
  findParentTarget,
  initialSelectedId,
  initialExpandedIds,
} = await import("../../src/ui/App.js");

const emptyTree = (): SessionTree => ({
  projects: [],
  coldProjects: [],
  totalCount: 0,
  timestamp: new Date().toISOString(),
  hiddenStats: { total: 0, active: 0 },
});

const makeColdSession = (
  projectName: string,
  id: string,
): SessionNode => ({
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
    appendSubAgentRows(
      result,
      session,
      new Set(["__expanded-session-s1"]),
    );
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
    appendSubAgentRows(
      result,
      session,
      new Set(["__collapsed-session-s1"]),
    );
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

  const project = (
    name: string,
    sessions: SessionNode[],
  ): ProjectNode => ({
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
