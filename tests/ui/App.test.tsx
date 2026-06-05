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
};

vi.mock("../../src/data/sessions.js", () => ({
  discoverSessions: () => mockTree,
  getProjectsDir: () => "/tmp/nonexistent-projects-dir",
}));

vi.mock("../../src/data/sessionHistory.js", () => ({
  parseSessionHistory: () => [],
}));

const { App, initialSelectedId, initialExpandedIds } = await import(
  "../../src/ui/App.js"
);

const emptyTree = (): SessionTree => ({
  projects: [],
  coldProjects: [],
  totalCount: 0,
  timestamp: new Date().toISOString(),
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
    };
    expect(initialSelectedId(tree)).toBe("__proj-hot1__");
  });

  it("falls back to __cold__ when only cold projects exist", () => {
    const tree: SessionTree = {
      projects: [],
      coldProjects: [makeColdProject("cold1"), makeColdProject("cold2")],
      totalCount: 2,
      timestamp: new Date().toISOString(),
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
    };
    expect(initialExpandedIds(tree).has("__cold__")).toBe(true);
  });

  it("leaves __cold__ collapsed when hot projects exist", () => {
    const tree: SessionTree = {
      projects: [makeColdProject("hot1")],
      coldProjects: [makeColdProject("cold1")],
      totalCount: 2,
      timestamp: new Date().toISOString(),
    };
    expect(initialExpandedIds(tree).has("__cold__")).toBe(false);
  });

  it("returns an empty set when there are no projects at all", () => {
    expect(initialExpandedIds(emptyTree()).size).toBe(0);
  });
});
