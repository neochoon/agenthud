import { describe, expect, it } from "vitest";
import type {
  ProjectNode,
  SessionNode,
  SessionTree,
} from "../../src/types/index.js";
import { reconcileSelectedId } from "../../src/ui/App.js";

const node = (id: string, subAgents: SessionNode[] = []): SessionNode => ({
  id,
  hideKey: "",
  filePath: `/tmp/${id}.jsonl`,
  projectPath: "/p",
  projectName: "p",
  lastModifiedMs: 0,
  status: "cold",
  modelName: null,
  subAgents,
  nonInteractive: false,
  firstUserPrompt: null,
  liveState: null,
});

const project = (name: string, sessions: SessionNode[]): ProjectNode => ({
  name,
  projectPath: `/${name}`,
  sessions,
  hotness: "warm",
});

const tree = (
  projects: ProjectNode[],
  coldProjects: ProjectNode[] = [],
): SessionTree => ({
  projects,
  coldProjects,
  totalCount: 0,
  timestamp: "",
  hiddenStats: { total: 0, active: 0 },
});

// A flattened "visible rows" list — reconcile only checks id membership.
const flatOf = (...ids: string[]): SessionNode[] => ids.map((id) => node(id));

describe("reconcileSelectedId", () => {
  it("keeps a selection that is still visible", () => {
    const t = tree([project("agenthud", [node("s1")])]);
    const flat = flatOf("__proj-agenthud__", "s1");
    expect(reconcileSelectedId("s1", flat, t)).toBe("s1");
  });

  it("falls back to the project header when the selected session cooled out of view", () => {
    // s1 still exists in the tree but folded under "... N cold"; its
    // project header is still visible.
    const t = tree([project("agenthud", [node("s1")])]);
    const flat = flatOf("__proj-agenthud__", "__cold-sessions-agenthud__");
    expect(reconcileSelectedId("s1", flat, t)).toBe("__proj-agenthud__");
  });

  it("falls back to the parent session when a sub-agent disappears", () => {
    const s = node("s1", [node("a1")]);
    const t = tree([project("p", [s])]);
    const flat = flatOf("__proj-p__", "s1"); // sub-agent row gone
    expect(reconcileSelectedId("a1", flat, t)).toBe("s1");
  });

  it("walks up to the project when both the sub-agent and its session are hidden", () => {
    const s = node("s1", [node("a1")]);
    const t = tree([project("p", [s])]);
    const flat = flatOf("__proj-p__", "__cold-sessions-p__");
    expect(reconcileSelectedId("a1", flat, t)).toBe("__proj-p__");
  });

  it("falls back to the first visible row when the whole branch is gone", () => {
    // project "p" went fully cold and collapsed under "__cold__".
    const t = tree([project("active", [node("x")])], [project("p", [node("s1")])]);
    const flat = flatOf("__proj-active__", "x", "__cold__");
    expect(reconcileSelectedId("s1", flat, t)).toBe("__proj-active__");
  });

  it("returns null when the tree is empty", () => {
    expect(reconcileSelectedId("s1", [], tree([]))).toBeNull();
  });

  it("leaves a null selection null when nothing is visible", () => {
    expect(reconcileSelectedId(null, [], tree([]))).toBeNull();
  });
});
