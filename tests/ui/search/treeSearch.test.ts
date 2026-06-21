import { describe, expect, it } from "vitest";
import type {
  ProjectNode,
  SessionNode,
  SessionTree,
} from "../../../src/types/index.js";
import {
  filterTreeBySearch,
  treeSearchHits,
} from "../../../src/ui/search/treeSearch.js";

const sess = (
  id: string,
  prompt: string,
  subs: SessionNode[] = [],
): SessionNode => ({
  id,
  hideKey: id,
  filePath: `/x/${id}.jsonl`,
  projectPath: "/x",
  projectName: "x",
  lastModifiedMs: 0,
  status: "cold",
  modelName: null,
  subAgents: subs,
  nonInteractive: false,
  firstUserPrompt: prompt,
  liveState: null,
});
const proj = (name: string, sessions: SessionNode[]): ProjectNode => ({
  name,
  projectPath: `/${name}`,
  sessions,
  hotness: "cold",
});
const tree = (projects: ProjectNode[]): SessionTree => ({
  projects,
  coldProjects: [],
  totalCount: 0,
  timestamp: new Date().toISOString(),
  hiddenStats: { total: 0, active: 0 },
});

describe("filterTreeBySearch", () => {
  it("keeps a matching session and its parent project; drops the rest", () => {
    const t = tree([
      proj("alpha", [sess("s1", "add auth flow"), sess("s2", "fix css")]),
      proj("beta", [sess("s3", "refactor db")]),
    ]);
    const out = filterTreeBySearch(t, "auth");
    expect(out.projects.map((p) => p.name)).toEqual(["alpha"]);
    expect(out.projects[0].sessions.map((s) => s.id)).toEqual(["s1"]);
  });
  it("matches on project name (keeps the project, all its sessions)", () => {
    const t = tree([proj("beta", [sess("s3", "refactor db")])]);
    expect(filterTreeBySearch(t, "beta").projects).toHaveLength(1);
  });
  it("matches a sub-agent → keeps its parent session + project", () => {
    const t = tree([
      proj("alpha", [sess("s1", "top", [sess("sa1", "run auth tests")])]),
    ]);
    const out = filterTreeBySearch(t, "auth");
    expect(out.projects[0].sessions[0].subAgents.map((s) => s.id)).toEqual([
      "sa1",
    ]);
  });
  it("empty query → tree unchanged", () => {
    const t = tree([proj("alpha", [sess("s1", "x")])]);
    expect(filterTreeBySearch(t, "")).toEqual(t);
  });
});

describe("treeSearchHits", () => {
  it("returns matching node ids in display order", () => {
    const t = tree([
      proj("alpha", [sess("s1", "add auth"), sess("s2", "auth bug")]),
    ]);
    expect(treeSearchHits(t, "auth")).toEqual(["s1", "s2"]);
  });
});
