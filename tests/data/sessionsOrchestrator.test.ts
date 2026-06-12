import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const { existsSync, readdirSync, statSync, readFileSync } = await import(
  "node:fs"
);
const { discoverSessions } = await import("../../src/data/sessions.js");

const NOW = 1_700_000_000_000;

const mockConfig = {
  refreshIntervalMs: 2000,
  hiddenSessions: [] as string[],
  hiddenSubAgents: [] as string[],
  filterPresets: [[]] as string[][],
  hiddenProjects: [] as string[],
};

afterEach(() => {
  vi.resetAllMocks();
});

describe("discoverSessions orchestrator", () => {
  it("returns empty tree when neither provider has data", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const tree = discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(0);
    expect(tree.coldProjects).toHaveLength(0);
    expect(tree.totalCount).toBe(0);
  });

  it("merges projects with the same projectPath across providers", () => {
    // Set up: Claude has one session in /shared/proj, Kiro has one
    // session in the SAME /shared/proj. Merge must produce ONE
    // ProjectNode with both sessions, not two.
    const claudeProjects = "/home/u/.claude/projects";
    const claudeProj = `${claudeProjects}/-shared-proj`;
    const claudeSess = `${claudeProj}/claude-id.jsonl`;
    const kiroDir = "/home/u/.kiro/sessions/cli";
    const kiroId = "kiro-id";

    process.env.HOME = "/home/u";
    process.env.CLAUDE_PROJECTS_DIR = claudeProjects;

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      // Both providers' directories exist.
      return (
        path === claudeProjects ||
        path === claudeProj ||
        path === claudeSess ||
        path === kiroDir ||
        path === `${kiroDir}/${kiroId}.json` ||
        path === `${kiroDir}/${kiroId}.jsonl`
      );
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === claudeProjects) {
        return ["-shared-proj"] as unknown as ReturnType<typeof readdirSync>;
      }
      if (path === claudeProj) {
        return ["claude-id.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      }
      if (path === kiroDir) {
        return [`${kiroId}.json`, `${kiroId}.jsonl`] as unknown as ReturnType<
          typeof readdirSync
        >;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      const isDir = !path.endsWith(".jsonl") && !path.endsWith(".json");
      return {
        isDirectory: () => isDir,
        mtimeMs: NOW - 60_000,
        size: 100,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith(`${kiroId}.json`)) {
        return JSON.stringify({
          session_id: kiroId,
          cwd: "/shared/proj",
          title: "kiro work",
          parent_session_id: null,
        });
      }
      return "";
    });
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);

    // Project list should have EXACTLY one /shared/proj entry,
    // with both Claude and Kiro sessions on it.
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].projectPath).toBe("/shared/proj");
    expect(tree.projects[0].sessions).toHaveLength(2);

    delete process.env.CLAUDE_PROJECTS_DIR;
  });
});
