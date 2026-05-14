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
  logDir: "/tmp/logs",
  hiddenSessions: [] as string[],
  hiddenSubAgents: [] as string[],
};

afterEach(() => {
  vi.resetAllMocks();
  delete process.env.CLAUDE_PROJECTS_DIR;
});

describe("discoverSessions", () => {
  it("returns empty tree when ~/.claude/projects does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const tree = discoverSessions(mockConfig);
    expect(tree.sessions).toHaveLength(0);
    expect(tree.totalCount).toBe(0);
  });

  it("discovers a top-level session with no sub-agents", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-myproject");
    const sessionFile = join(projectDir, "abc123.jsonl");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir) return true;
      if (path === projectDir) return true;
      if (path === sessionFile) return true;
      if (path.includes("subagents")) return false;
      return false;
    });

    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-myproject"] as unknown as ReturnType<
          typeof readdirSync
        >;
      if (path === projectDir)
        return ["abc123.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });

    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      const isDir = path === projectDir;
      return {
        isDirectory: () => isDir,
        mtimeMs: NOW - 10_000,
        size: 1000,
      } as ReturnType<typeof statSync>;
    });

    vi.mocked(readFileSync).mockReturnValue(
      `${JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-20250514", content: [] },
        timestamp: new Date(NOW - 10_000).toISOString(),
      })}\n`,
    );

    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.sessions).toHaveLength(1);
    expect(tree.sessions[0].id).toBe("abc123");
    expect(tree.sessions[0].hideKey).toBe("myproject/abc123");
    expect(tree.sessions[0].subAgents).toHaveLength(0);
    expect(tree.sessions[0].modelName).toBe("sonnet-4");
  });

  it("marks session as hot when mtime is within 30m", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-myproject");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return path === projectsDir || path.includes("myproject");
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-myproject"] as unknown as ReturnType<
          typeof readdirSync
        >;
      if (path === projectDir)
        return ["sess1.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      const isDir = !path.endsWith(".jsonl");
      return {
        isDirectory: () => isDir,
        mtimeMs: NOW - 5_000,
        size: 100,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockReturnValue("");
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.sessions[0].status).toBe("hot");
  });

  it("marks session as warm when mtime is between 30m and 1h ago", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-myproject");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return path === projectsDir || path.includes("myproject");
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-myproject"] as unknown as ReturnType<
          typeof readdirSync
        >;
      if (path === projectDir)
        return ["sess1.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      const isDir = !path.endsWith(".jsonl");
      return {
        isDirectory: () => isDir,
        mtimeMs: NOW - 45 * 60 * 1000,
        size: 100,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockReturnValue("");
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.sessions[0].status).toBe("warm");
  });

  it("nests sub-agents under their parent", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-proj");
    const subagentsDir = join(projectDir, "parent-id", "subagents");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return (
        [projectsDir, projectDir, subagentsDir].includes(path) ||
        path.endsWith(".jsonl")
      );
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-proj"] as unknown as ReturnType<typeof readdirSync>;
      if (path === projectDir)
        return ["parent-id.jsonl", "parent-id"] as unknown as ReturnType<
          typeof readdirSync
        >;
      if (path === subagentsDir)
        return ["child-id.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      const isDir = !path.endsWith(".jsonl");
      return {
        isDirectory: () => isDir,
        mtimeMs: NOW - 60_000,
        size: 500,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockReturnValue("");

    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.sessions).toHaveLength(1);
    expect(tree.sessions[0].id).toBe("parent-id");
    expect(tree.sessions[0].hideKey).toBe("proj/parent-id");
    expect(tree.sessions[0].subAgents).toHaveLength(1);
    expect(tree.sessions[0].subAgents[0].id).toBe("child-id");
    expect(tree.sessions[0].subAgents[0].hideKey).toBe("proj/child-id");
    expect(tree.totalCount).toBe(2);
  });

  it("includes sessions older than 1 hour (no longer excluded by timeout)", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-oldproject");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return path === projectsDir || path.includes("oldproject");
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-oldproject"] as unknown as ReturnType<
          typeof readdirSync
        >;
      if (path === projectDir)
        return ["old-sess.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      const isDir = !path.endsWith(".jsonl");
      return {
        isDirectory: () => isDir,
        mtimeMs: NOW - 2 * 60 * 60 * 1000,
        size: 100,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockReturnValue("");
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.sessions).toHaveLength(1);
    // NOW-2h is same UTC day as NOW, so status is cool (calendar-based).
    expect(tree.sessions[0].status).toBe("cool");
  });

  it("excludes sessions in hiddenSessions config", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-myproject");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return path === projectsDir || path.includes("myproject");
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-myproject"] as unknown as ReturnType<
          typeof readdirSync
        >;
      if (path === projectDir)
        return ["abc123.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      return {
        isDirectory: () => !path.endsWith(".jsonl"),
        mtimeMs: NOW - 5_000,
        size: 100,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockReturnValue("");
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const configWithHidden = {
      ...mockConfig,
      hiddenSessions: ["myproject/abc123"],
    };

    const tree = discoverSessions(configWithHidden);
    expect(tree.sessions).toHaveLength(0);
    expect(tree.totalCount).toBe(0);
  });

  it("uses CLAUDE_PROJECTS_DIR env var when set", () => {
    const customDir = "/custom/projects";
    process.env.CLAUDE_PROJECTS_DIR = customDir;

    vi.mocked(existsSync).mockReturnValue(false);

    const tree = discoverSessions(mockConfig);
    expect(vi.mocked(existsSync)).toHaveBeenCalledWith(customDir);
    expect(tree.sessions).toHaveLength(0);
  });

  describe("session status calendar logic", () => {
    it("marks session as cool when mtime is today (UTC) but older than 1 hour", () => {
      const projectsDir = join(
        process.env.HOME ?? "/home/user",
        ".claude",
        "projects",
      );
      const projectDir = join(projectsDir, "-Users-neo-proj");

      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        return path === projectsDir || path.includes("-neo-proj");
      });
      vi.mocked(readdirSync).mockImplementation((p) => {
        const path = String(p);
        if (path === projectsDir)
          return ["-Users-neo-proj"] as unknown as ReturnType<
            typeof readdirSync
          >;
        if (path === projectDir)
          return ["sess.jsonl"] as unknown as ReturnType<typeof readdirSync>;
        return [] as unknown as ReturnType<typeof readdirSync>;
      });
      // NOW = 2023-11-14 22:13 UTC. 2 hours earlier = 20:13 UTC same day.
      vi.mocked(statSync).mockImplementation((p) => {
        const path = String(p);
        return {
          isDirectory: () => !path.endsWith(".jsonl"),
          mtimeMs: NOW - 2 * 60 * 60 * 1000,
          size: 100,
        } as ReturnType<typeof statSync>;
      });
      vi.mocked(readFileSync).mockReturnValue("");
      vi.spyOn(Date, "now").mockReturnValue(NOW);

      const tree = discoverSessions(mockConfig);
      expect(tree.sessions[0].status).toBe("cool");
    });

    it("marks session as cold when mtime is a previous UTC day", () => {
      const projectsDir = join(
        process.env.HOME ?? "/home/user",
        ".claude",
        "projects",
      );
      const projectDir = join(projectsDir, "-Users-neo-proj");

      vi.mocked(existsSync).mockImplementation((p) => {
        const path = String(p);
        return path === projectsDir || path.includes("-neo-proj");
      });
      vi.mocked(readdirSync).mockImplementation((p) => {
        const path = String(p);
        if (path === projectsDir)
          return ["-Users-neo-proj"] as unknown as ReturnType<
            typeof readdirSync
          >;
        if (path === projectDir)
          return ["sess.jsonl"] as unknown as ReturnType<typeof readdirSync>;
        return [] as unknown as ReturnType<typeof readdirSync>;
      });
      // 72 hours ago is always a previous UTC day regardless of timezone.
      vi.mocked(statSync).mockImplementation((p) => {
        const path = String(p);
        return {
          isDirectory: () => !path.endsWith(".jsonl"),
          mtimeMs: NOW - 72 * 60 * 60 * 1000,
          size: 100,
        } as ReturnType<typeof statSync>;
      });
      vi.mocked(readFileSync).mockReturnValue("");
      vi.spyOn(Date, "now").mockReturnValue(NOW);

      const tree = discoverSessions(mockConfig);
      expect(tree.sessions[0].status).toBe("cold");
    });
  });
});
