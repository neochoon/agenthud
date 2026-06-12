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
const { kiroProvider } = await import(
  "../../../src/data/providers/kiro.js"
);

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

describe("kiroProvider.isAvailable", () => {
  it("returns false when ~/.kiro/sessions/cli does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(kiroProvider.isAvailable()).toBe(false);
  });

  it("returns true when the directory exists", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    expect(kiroProvider.isAvailable()).toBe(true);
  });
});

describe("kiroProvider.discoverSessions", () => {
  it("returns empty tree when ~/.kiro/sessions/cli does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const tree = kiroProvider.discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(0);
    expect(tree.coldProjects).toHaveLength(0);
    expect(tree.totalCount).toBe(0);
  });

  it("discovers a top-level session and groups by cwd", () => {
    const sessionsDir = join(
      process.env.HOME ?? "/home/user",
      ".kiro",
      "sessions",
      "cli",
    );
    const sessionId = "aaa11111-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const jsonFile = join(sessionsDir, `${sessionId}.json`);
    const jsonlFile = join(sessionsDir, `${sessionId}.jsonl`);

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return path === sessionsDir || path === jsonFile || path === jsonlFile;
    });
    vi.mocked(readdirSync).mockReturnValue([
      `${sessionId}.json`,
      `${sessionId}.jsonl`,
    ] as unknown as ReturnType<typeof readdirSync>);
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      return {
        isDirectory: () => false,
        mtimeMs: path.endsWith(".jsonl") ? NOW - 10_000 : NOW - 60_000,
        size: 1000,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith(".json")) {
        return JSON.stringify({
          session_id: sessionId,
          cwd: "/Users/neo/myproject",
          created_at: "2026-06-12T00:00:00Z",
          updated_at: "2026-06-12T00:01:00Z",
          title: "Hello world prompt",
          parent_session_id: null,
        });
      }
      return "";
    });
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = kiroProvider.discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].name).toBe("myproject");
    expect(tree.projects[0].projectPath).toBe("/Users/neo/myproject");
    expect(tree.projects[0].sessions).toHaveLength(1);
    expect(tree.projects[0].sessions[0].id).toBe(sessionId);
    expect(tree.projects[0].sessions[0].hideKey).toBe(
      `myproject/${sessionId}`,
    );
    expect(tree.projects[0].sessions[0].firstUserPrompt).toBe(
      "Hello world prompt",
    );
    // .jsonl mtime drives the session age (more recent than .json)
    expect(tree.projects[0].sessions[0].lastModifiedMs).toBe(NOW - 10_000);
    expect(tree.projects[0].sessions[0].subAgents).toHaveLength(0);
  });

  it("links sub-agents to their parent via parent_session_id", () => {
    const sessionsDir = join(
      process.env.HOME ?? "/home/user",
      ".kiro",
      "sessions",
      "cli",
    );
    const parentId = "bbb22222-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const childId = "ccc33333-cccc-cccc-cccc-cccccccccccc";

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      `${parentId}.json`,
      `${parentId}.jsonl`,
      `${childId}.json`,
      `${childId}.jsonl`,
    ] as unknown as ReturnType<typeof readdirSync>);
    vi.mocked(statSync).mockImplementation(
      () =>
        ({
          isDirectory: () => false,
          mtimeMs: NOW - 60_000,
          size: 100,
        }) as ReturnType<typeof statSync>,
    );
    vi.mocked(readFileSync).mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith(`${parentId}.json`)) {
        return JSON.stringify({
          session_id: parentId,
          cwd: "/Users/neo/myproject",
          title: "Run the suite",
          parent_session_id: null,
        });
      }
      if (path.endsWith(`${childId}.json`)) {
        return JSON.stringify({
          session_id: childId,
          cwd: "/Users/neo/myproject",
          title: "test runner sub-task",
          parent_session_id: parentId,
        });
      }
      return "";
    });
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = kiroProvider.discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].sessions).toHaveLength(1);
    expect(tree.projects[0].sessions[0].id).toBe(parentId);
    expect(tree.projects[0].sessions[0].subAgents).toHaveLength(1);
    expect(tree.projects[0].sessions[0].subAgents[0].id).toBe(childId);
    expect(tree.projects[0].sessions[0].subAgents[0].taskDescription).toBe(
      "test runner sub-task",
    );
    // Total = parent + sub-agent
    expect(tree.totalCount).toBe(2);
  });

  it("sets liveState=waiting when a .lock file is present", () => {
    const sessionsDir = join(
      process.env.HOME ?? "/home/user",
      ".kiro",
      "sessions",
      "cli",
    );
    const id = "ddd44444-dddd-dddd-dddd-dddddddddddd";
    const lockFile = join(sessionsDir, `${id}.lock`);

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      // Lock file present
      return path === sessionsDir || path === lockFile || true;
    });
    vi.mocked(readdirSync).mockReturnValue([
      `${id}.json`,
      `${id}.jsonl`,
      `${id}.lock`,
    ] as unknown as ReturnType<typeof readdirSync>);
    vi.mocked(statSync).mockImplementation(
      () =>
        ({
          isDirectory: () => false,
          mtimeMs: NOW - 60_000,
          size: 100,
        }) as ReturnType<typeof statSync>,
    );
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith(".json")) {
        return JSON.stringify({
          session_id: id,
          cwd: "/Users/neo/p",
          title: "running",
          parent_session_id: null,
        });
      }
      return "";
    });
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = kiroProvider.discoverSessions(mockConfig);
    expect(tree.projects[0].sessions[0].liveState).toBe("waiting");
  });

  it("respects hiddenSessions config (marks but keeps in tree)", () => {
    const sessionsDir = join(
      process.env.HOME ?? "/home/user",
      ".kiro",
      "sessions",
      "cli",
    );
    const id = "eee55555-eeee-eeee-eeee-eeeeeeeeeeee";

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([
      `${id}.json`,
      `${id}.jsonl`,
    ] as unknown as ReturnType<typeof readdirSync>);
    vi.mocked(statSync).mockImplementation(
      () =>
        ({
          isDirectory: () => false,
          mtimeMs: NOW - 60_000,
          size: 100,
        }) as ReturnType<typeof statSync>,
    );
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).endsWith(".json")) {
        return JSON.stringify({
          session_id: id,
          cwd: "/Users/neo/secret",
          title: "secret work",
          parent_session_id: null,
        });
      }
      return "";
    });
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = kiroProvider.discoverSessions({
      ...mockConfig,
      hiddenSessions: [`secret/${id}`],
    });
    expect(tree.projects[0].sessions[0].hidden).toBe(true);
    expect(tree.hiddenStats.total).toBe(1);
    expect(tree.hiddenStats.active).toBe(1);
  });
});
