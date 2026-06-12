import { join } from "node:path";
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
    //
    // Platform note: both provider roots are injected via their env
    // overrides (CLAUDE_PROJECTS_DIR / KIRO_SESSIONS_DIR) and every
    // expected path is built with join() — comparisons must match
    // what the providers construct, which uses the OS separator.
    // Setting process.env.HOME doesn't work on Windows (homedir()
    // reads USERPROFILE), which is why the env overrides exist.
    const claudeProjects = join("/home", "u", ".claude", "projects");
    const claudeProj = join(claudeProjects, "-shared-proj");
    const claudeSess = join(claudeProj, "claude-id.jsonl");
    const kiroDir = join("/home", "u", ".kiro", "sessions", "cli");
    const kiroId = "kiro-id";
    const kiroJson = join(kiroDir, `${kiroId}.json`);
    const kiroJsonl = join(kiroDir, `${kiroId}.jsonl`);

    process.env.CLAUDE_PROJECTS_DIR = claudeProjects;
    process.env.KIRO_SESSIONS_DIR = kiroDir;

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      // Both providers' directories exist.
      return (
        path === claudeProjects ||
        path === claudeProj ||
        path === claudeSess ||
        path === kiroDir ||
        path === kiroJson ||
        path === kiroJsonl
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
      // Claude session is OLDER (2h → cool), Kiro session is fresh
      // (60s → hot). Exercises the post-merge re-sort: the hot Kiro
      // session must come first inside the merged project even
      // though the Claude provider ran first.
      const isClaudeSession = path.endsWith("claude-id.jsonl");
      return {
        isDirectory: () => isDir,
        mtimeMs: isClaudeSession ? NOW - 2 * 60 * 60 * 1000 : NOW - 60_000,
        size: 100,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith(`${kiroId}.json`)) {
        return JSON.stringify({
          session_id: kiroId,
          // cwd must decode to the same projectPath the Claude
          // provider derives from the encoded directory name.
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
    // Post-merge re-sort: hot (kiro, 60s) before cool (claude, 2h)
    // regardless of provider registration order.
    expect(tree.projects[0].sessions[0].id).toBe(kiroId);
    expect(tree.projects[0].sessions[1].id).toBe("claude-id");

    delete process.env.CLAUDE_PROJECTS_DIR;
    delete process.env.KIRO_SESSIONS_DIR;
  });
});
