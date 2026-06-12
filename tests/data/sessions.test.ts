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
const { discoverSessions, findContainingProject } = await import(
  "../../src/data/sessions.js"
);
const { clearClaudeFileCaches } = await import(
  "../../src/data/providers/claude.js"
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
  delete process.env.CLAUDE_PROJECTS_DIR;
  // The provider caches per-file derived data by (path, mtime).
  // Fixtures reuse paths + the fixed NOW mtime across cases, so drop
  // the cache between tests to avoid a stale hit from a prior fixture.
  clearClaudeFileCaches();
});

describe("discoverSessions", () => {
  it("returns empty tree when ~/.claude/projects does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const tree = discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(0);
    expect(tree.coldProjects).toHaveLength(0);
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
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].sessions).toHaveLength(1);
    expect(tree.projects[0].sessions[0].id).toBe("abc123");
    expect(tree.projects[0].sessions[0].hideKey).toBe("myproject/abc123");
    expect(tree.projects[0].sessions[0].subAgents).toHaveLength(0);
    expect(tree.projects[0].sessions[0].modelName).toBe("sonnet-4");
  });

  it("derives contextUsage from the last assistant usage (200K window)", () => {
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
        return ["ctx1.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      const isDir = !path.endsWith(".jsonl");
      return {
        isDirectory: () => isDir,
        mtimeMs: NOW - 10_000,
        size: 100,
      } as ReturnType<typeof statSync>;
    });
    // 100K used on a 200K window → 50%
    vi.mocked(readFileSync).mockReturnValue(
      `${JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-sonnet-4-20250514",
          content: [],
          usage: {
            input_tokens: 1,
            cache_creation_input_tokens: 999,
            cache_read_input_tokens: 99_000,
            output_tokens: 50,
          },
        },
        timestamp: new Date(NOW - 10_000).toISOString(),
      })}\n`,
    );
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    const ctx = tree.projects[0].sessions[0].contextUsage;
    expect(ctx).toBeDefined();
    expect(ctx?.used).toBe(100_000);
    expect(ctx?.total).toBe(200_000);
    expect(ctx?.percent).toBe(50);
  });

  it("infers a 1M window when usage exceeds 200K (long-context session)", () => {
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
        return ["ctx2.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      const isDir = !path.endsWith(".jsonl");
      return {
        isDirectory: () => isDir,
        mtimeMs: NOW - 10_000,
        size: 100,
      } as ReturnType<typeof statSync>;
    });
    // 541.6K used — impossible on a 200K window, must be 1M → 54%
    vi.mocked(readFileSync).mockReturnValue(
      `${JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-opus-4-7",
          content: [],
          usage: {
            input_tokens: 1,
            cache_creation_input_tokens: 601,
            cache_read_input_tokens: 540_998,
            output_tokens: 200,
          },
        },
        timestamp: new Date(NOW - 10_000).toISOString(),
      })}\n`,
    );
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    const ctx = tree.projects[0].sessions[0].contextUsage;
    expect(ctx).toBeDefined();
    expect(ctx?.used).toBe(541_600);
    expect(ctx?.total).toBe(1_000_000);
    expect(ctx?.percent).toBe(54);
  });

  it("leaves contextUsage undefined when no assistant entry carries usage", () => {
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
        return ["ctx3.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      const isDir = !path.endsWith(".jsonl");
      return {
        isDirectory: () => isDir,
        mtimeMs: NOW - 10_000,
        size: 100,
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
    expect(tree.projects[0].sessions[0].contextUsage).toBeUndefined();
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
    expect(tree.projects[0].sessions[0].status).toBe("hot");
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
    expect(tree.projects[0].sessions[0].status).toBe("warm");
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
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].sessions).toHaveLength(1);
    expect(tree.projects[0].sessions[0].id).toBe("parent-id");
    expect(tree.projects[0].sessions[0].hideKey).toBe("proj/parent-id");
    expect(tree.projects[0].sessions[0].subAgents).toHaveLength(1);
    expect(tree.projects[0].sessions[0].subAgents[0].id).toBe("child-id");
    expect(tree.projects[0].sessions[0].subAgents[0].hideKey).toBe(
      "proj/child-id",
    );
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
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].sessions).toHaveLength(1);
    // NOW-2h is same UTC day as NOW, so status is cool (calendar-based).
    expect(tree.projects[0].sessions[0].status).toBe("cool");
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
    // The session is now KEPT in the tree with `hidden: true` rather
    // than filtered out — the App.tsx render layer decides whether
    // to display it based on the `showHidden` toggle. The tree
    // counts it; only the renderer filters.
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].sessions).toHaveLength(1);
    expect(tree.projects[0].sessions[0].hidden).toBe(true);
    expect(tree.totalCount).toBe(1);
    // Hidden session was hot (mtime 5s ago) — counts toward both
    // total and active so the status bar can flag it.
    expect(tree.hiddenStats).toEqual({ total: 1, active: 1 });
  });

  it("hiddenStats: cool/cold hidden sessions count total but not active", () => {
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
        return ["cool.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      return {
        isDirectory: () => !path.endsWith(".jsonl"),
        // 2 hours ago → cool (within the same day but past warm window)
        mtimeMs: NOW - 2 * 60 * 60 * 1000,
        size: 100,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockReturnValue("");
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions({
      ...mockConfig,
      hiddenSessions: ["myproject/cool"],
    });
    expect(tree.hiddenStats).toEqual({ total: 1, active: 0 });
  });

  it("hiddenStats: zero when nothing is hidden", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    vi.mocked(existsSync).mockImplementation((p) => String(p) === projectsDir);
    vi.mocked(readdirSync).mockReturnValue(
      [] as unknown as ReturnType<typeof readdirSync>,
    );
    vi.mocked(readFileSync).mockReturnValue("");
    const tree = discoverSessions(mockConfig);
    expect(tree.hiddenStats).toEqual({ total: 0, active: 0 });
  });

  it("hiddenStats: hidden project's sessions all count toward total", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-launcher");
    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return path === projectsDir || path.includes("launcher");
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-launcher"] as unknown as ReturnType<
          typeof readdirSync
        >;
      if (path === projectDir)
        return ["s1.jsonl", "s2.jsonl"] as unknown as ReturnType<
          typeof readdirSync
        >;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      return {
        isDirectory: () => !path.endsWith(".jsonl"),
        mtimeMs: NOW - 5_000, // both hot
        size: 100,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockReturnValue("");
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions({
      ...mockConfig,
      hiddenProjects: ["launcher"],
    });
    // Both sessions in the hidden project count.
    expect(tree.hiddenStats).toEqual({ total: 2, active: 2 });
    // The project is kept in the tree, marked hidden — the renderer
    // filters it based on `showHidden`.
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].hidden).toBe(true);
    expect(tree.projects[0].sessions).toHaveLength(2);
    expect(tree.projects[0].sessions[0].hidden).toBe(true);
  });

  it("marks session non-interactive when entrypoint is sdk-cli", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-myproject");
    const sessionFile = join(projectDir, "ndi123.jsonl");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir || path === projectDir || path === sessionFile)
        return true;
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
        return ["ndi123.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation(
      (p) =>
        ({
          isDirectory: () => String(p) === projectDir,
          mtimeMs: NOW - 10_000,
          size: 1000,
        }) as ReturnType<typeof statSync>,
    );
    vi.mocked(readFileSync).mockReturnValue(
      `${JSON.stringify({
        entrypoint: "sdk-cli",
        type: "assistant",
        message: { model: "<synthetic>", content: [] },
        timestamp: new Date(NOW - 10_000).toISOString(),
      })}\n`,
    );
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.projects[0].sessions[0].nonInteractive).toBe(true);
  });

  it("uses CLAUDE_PROJECTS_DIR env var when set", () => {
    const customDir = "/custom/projects";
    process.env.CLAUDE_PROJECTS_DIR = customDir;

    vi.mocked(existsSync).mockReturnValue(false);

    const tree = discoverSessions(mockConfig);
    expect(vi.mocked(existsSync)).toHaveBeenCalledWith(customDir);
    expect(tree.projects).toHaveLength(0);
    expect(tree.coldProjects).toHaveLength(0);
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
      expect(tree.projects[0].sessions[0].status).toBe("cool");
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
      expect(tree.projects).toHaveLength(0);
      expect(tree.coldProjects).toHaveLength(1);
      expect(tree.coldProjects[0].sessions[0].status).toBe("cold");
    });
  });

  it("groups multiple sessions of the same project under one ProjectNode", () => {
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
        return ["-Users-neo-proj"] as unknown as ReturnType<typeof readdirSync>;
      if (path === projectDir)
        return ["s1.jsonl", "s2.jsonl"] as unknown as ReturnType<
          typeof readdirSync
        >;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation(
      (p) =>
        ({
          isDirectory: () => !String(p).endsWith(".jsonl"),
          mtimeMs: NOW - 10_000,
          size: 100,
        }) as ReturnType<typeof statSync>,
    );
    vi.mocked(readFileSync).mockReturnValue("");
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].name).toBe("proj");
    expect(tree.projects[0].sessions).toHaveLength(2);
  });

  it("places projects where all sessions are cold into coldProjects", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-old");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return path === projectsDir || path.includes("-neo-old");
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-old"] as unknown as ReturnType<typeof readdirSync>;
      if (path === projectDir)
        return ["o1.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation(
      (p) =>
        ({
          isDirectory: () => !String(p).endsWith(".jsonl"),
          mtimeMs: NOW - 72 * 60 * 60 * 1000,
          size: 100,
        }) as ReturnType<typeof statSync>,
    );
    vi.mocked(readFileSync).mockReturnValue("");
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(0);
    expect(tree.coldProjects).toHaveLength(1);
    expect(tree.coldProjects[0].sessions).toHaveLength(1);
  });

  it("marks hidden sub-agents but keeps them in the tree (for show-hidden + unhide)", () => {
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
        return [
          "hidden-child.jsonl",
          "visible-child.jsonl",
        ] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      const isDir = !path.endsWith(".jsonl");
      return {
        isDirectory: () => isDir,
        mtimeMs: NOW - 60_000, // hot
        size: 500,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockReturnValue("");
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const configHidden = {
      ...mockConfig,
      hiddenSubAgents: ["proj/hidden-child"],
    };
    const tree = discoverSessions(configHidden);

    // Both sub-agents are kept in the tree so `H` (unhide) can find them.
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].sessions).toHaveLength(1);
    const subs = tree.projects[0].sessions[0].subAgents;
    expect(subs).toHaveLength(2);

    const hidden = subs.find((s) => s.id === "hidden-child");
    const visible = subs.find((s) => s.id === "visible-child");
    expect(hidden?.hidden).toBe(true);
    expect(visible?.hidden).toBeUndefined();

    // Hidden hot sub-agent counts toward both totals so the alarm
    // ("M active in N hidden") fires in the panel title.
    expect(tree.hiddenStats.total).toBe(1);
    expect(tree.hiddenStats.active).toBe(1);
  });

  it("marks hidden projects but keeps them in the tree (renderer filters)", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-secret");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return path === projectsDir || path.includes("-neo-secret");
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-secret"] as unknown as ReturnType<
          typeof readdirSync
        >;
      if (path === projectDir)
        return ["a.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation(
      (p) =>
        ({
          isDirectory: () => !String(p).endsWith(".jsonl"),
          mtimeMs: NOW - 10_000,
          size: 100,
        }) as ReturnType<typeof statSync>,
    );
    vi.mocked(readFileSync).mockReturnValue("");
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const configWithHidden = { ...mockConfig, hiddenProjects: ["secret"] };
    const tree = discoverSessions(configWithHidden);
    // mtime 10s ago → hot → goes to projects (not coldProjects),
    // marked hidden=true. The render layer decides whether to show.
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].hidden).toBe(true);
    expect(tree.coldProjects).toHaveLength(0);
  });

  it("extracts first natural-language user message as firstUserPrompt", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-fp");
    const sessionFile = join(projectDir, "fp1.jsonl");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return (
        path === projectsDir || path === projectDir || path === sessionFile
      );
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-fp"] as unknown as ReturnType<typeof readdirSync>;
      if (path === projectDir)
        return ["fp1.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation(
      (p) =>
        ({
          isDirectory: () => !String(p).endsWith(".jsonl"),
          mtimeMs: NOW - 10_000,
          size: 100,
        }) as ReturnType<typeof statSync>,
    );

    // First user entry is a system reminder (should be skipped); second is the real prompt
    const lines = [
      JSON.stringify({
        type: "user",
        message: {
          content: "<system-reminder>some reminder</system-reminder>",
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-6", content: [] },
      }),
      JSON.stringify({
        type: "user",
        message: { content: "Fix the auth bug in login flow" },
      }),
    ].join("\n");
    vi.mocked(readFileSync).mockReturnValue(lines);
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.projects[0].sessions[0].firstUserPrompt).toBe(
      "Fix the auth bug in login flow",
    );
  });

  it("shows the latest user message regardless of length (slash commands skipped)", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-fp");
    const sessionFile = join(projectDir, "fp2.jsonl");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return (
        path === projectsDir || path === projectDir || path === sessionFile
      );
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-fp"] as unknown as ReturnType<typeof readdirSync>;
      if (path === projectDir)
        return ["fp2.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation(
      (p) =>
        ({
          isDirectory: () => !String(p).endsWith(".jsonl"),
          mtimeMs: NOW - 10_000,
          size: 100,
        }) as ReturnType<typeof statSync>,
    );

    const lines = [
      JSON.stringify({
        type: "user",
        message: { content: "Look at the brainstorm doc" },
      }),
      JSON.stringify({
        type: "user",
        message: { content: "Implement the OAuth2 callback handler" },
      }),
      JSON.stringify({
        type: "user",
        message: { content: "/compact" }, // slash command, must NOT win
      }),
      JSON.stringify({
        type: "user",
        message: { content: "yes" }, // short but real — WINS (no length filter)
      }),
    ].join("\n");
    vi.mocked(readFileSync).mockReturnValue(lines);
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.projects[0].sessions[0].firstUserPrompt).toBe("yes");
  });

  it("falls back to first prompt when all later messages are slash commands", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-fp");
    const sessionFile = join(projectDir, "fp3.jsonl");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return (
        path === projectsDir || path === projectDir || path === sessionFile
      );
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-fp"] as unknown as ReturnType<typeof readdirSync>;
      if (path === projectDir)
        return ["fp3.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation(
      (p) =>
        ({
          isDirectory: () => !String(p).endsWith(".jsonl"),
          mtimeMs: NOW - 10_000,
          size: 100,
        }) as ReturnType<typeof statSync>,
    );

    const lines = [
      JSON.stringify({
        type: "user",
        message: { content: "Fix the auth bug in login flow" },
      }),
      JSON.stringify({
        type: "user",
        message: { content: "/clear" },
      }),
      JSON.stringify({
        type: "user",
        message: { content: "/compact" },
      }),
    ].join("\n");
    vi.mocked(readFileSync).mockReturnValue(lines);
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.projects[0].sessions[0].firstUserPrompt).toBe(
      "Fix the auth bug in login flow",
    );
  });

  it("returns null firstUserPrompt for sessions with no real user message", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-empty");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return path === projectsDir || path.includes("-neo-empty");
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-empty"] as unknown as ReturnType<
          typeof readdirSync
        >;
      if (path === projectDir)
        return ["e1.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation(
      (p) =>
        ({
          isDirectory: () => !String(p).endsWith(".jsonl"),
          mtimeMs: NOW - 10_000,
          size: 100,
        }) as ReturnType<typeof statSync>,
    );
    vi.mocked(readFileSync).mockReturnValue(
      `${JSON.stringify({ type: "user", message: { content: "<system-reminder>only system</system-reminder>" } })}\n`,
    );
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.projects[0].sessions[0].firstUserPrompt).toBeNull();
  });

  it("sorts sessions within a project: interactive before non-interactive", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-mix");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return path === projectsDir || path.includes("-neo-mix");
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-mix"] as unknown as ReturnType<typeof readdirSync>;
      if (path === projectDir)
        return ["sdk.jsonl", "cli.jsonl"] as unknown as ReturnType<
          typeof readdirSync
        >;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation(
      (p) =>
        ({
          isDirectory: () => !String(p).endsWith(".jsonl"),
          mtimeMs: NOW - 10_000,
          size: 100,
        }) as ReturnType<typeof statSync>,
    );
    vi.mocked(readFileSync).mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("sdk.jsonl")) {
        return `${JSON.stringify({ entrypoint: "sdk-cli", type: "assistant", message: { model: "<synthetic>", content: [] }, timestamp: new Date(NOW - 10_000).toISOString() })}\n`;
      }
      return `${JSON.stringify({ entrypoint: "cli", type: "assistant", message: { model: "claude-sonnet-4-6", content: [] }, timestamp: new Date(NOW - 10_000).toISOString() })}\n`;
    });
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(1);
    const sessions = tree.projects[0].sessions;
    expect(sessions[0].nonInteractive).toBe(false);
    expect(sessions[1].nonInteractive).toBe(true);
  });

  it("populates liveState 'working' when the tail ends in a pending tool_use", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-myproject");
    const sessionFile = join(projectDir, "work123.jsonl");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir || path === projectDir || path === sessionFile)
        return true;
      return false;
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-myproject"] as unknown as ReturnType<
          typeof readdirSync
        >;
      if (path === projectDir)
        return ["work123.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      return {
        isDirectory: () => path === projectDir,
        mtimeMs: NOW - 10_000,
        size: 1000,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockReturnValue(
      `${JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-sonnet-4-20250514",
          content: [
            { type: "tool_use", name: "Bash", input: { command: "npm test" } },
          ],
        },
        timestamp: new Date(NOW - 10_000).toISOString(),
      })}\n`,
    );
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.projects[0].sessions[0].liveState).toBe("working");
  });

  it("populates liveState on sub-agent nodes", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-liveproj");
    const subagentsDir = join(projectDir, "parent-live", "subagents");
    const parentFile = join(projectDir, "parent-live.jsonl");
    const childFile = join(subagentsDir, "child-live.jsonl");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return [
        projectsDir,
        projectDir,
        subagentsDir,
        parentFile,
        childFile,
      ].includes(path);
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-liveproj"] as unknown as ReturnType<
          typeof readdirSync
        >;
      if (path === projectDir)
        return ["parent-live.jsonl", "parent-live"] as unknown as ReturnType<
          typeof readdirSync
        >;
      if (path === subagentsDir)
        return ["child-live.jsonl"] as unknown as ReturnType<
          typeof readdirSync
        >;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      const isDir = !path.endsWith(".jsonl");
      return {
        isDirectory: () => isDir,
        mtimeMs: NOW - 10_000,
        size: 500,
      } as ReturnType<typeof statSync>;
    });

    const workingTail = `${JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-sonnet-4-20250514",
        content: [
          { type: "tool_use", name: "Bash", input: { command: "npm test" } },
        ],
      },
      timestamp: new Date(NOW - 10_000).toISOString(),
    })}\n`;

    vi.mocked(readFileSync).mockImplementation((p) => {
      // Both parent and child get the same working-tail content; what matters
      // is that the child's liveState is populated.
      const path = String(p);
      if (path === parentFile || path === childFile) return workingTail;
      return "";
    });
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].sessions[0].subAgents).toHaveLength(1);
    expect(tree.projects[0].sessions[0].subAgents[0].id).toBe("child-live");
    expect(tree.projects[0].sessions[0].subAgents[0].liveState).toBe("working");
  });

  it("suppresses liveState (null) for non-interactive sessions", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-myproject");
    const sessionFile = join(projectDir, "sdk123.jsonl");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir || path === projectDir || path === sessionFile)
        return true;
      return false;
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-myproject"] as unknown as ReturnType<
          typeof readdirSync
        >;
      if (path === projectDir)
        return ["sdk123.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      return {
        isDirectory: () => path === projectDir,
        mtimeMs: NOW - 10_000,
        size: 1000,
      } as ReturnType<typeof statSync>;
    });
    // First line carries entrypoint "sdk-cli" → non-interactive; tail looks "working".
    vi.mocked(readFileSync).mockReturnValue(
      `${JSON.stringify({
        type: "assistant",
        entrypoint: "sdk-cli",
        message: {
          model: "claude-sonnet-4-20250514",
          content: [
            { type: "tool_use", name: "Bash", input: { command: "npm test" } },
          ],
        },
        timestamp: new Date(NOW - 10_000).toISOString(),
      })}\n`,
    );
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    const all = [...tree.projects, ...tree.coldProjects].flatMap(
      (p) => p.sessions,
    );
    expect(all[0].nonInteractive).toBe(true);
    expect(all[0].liveState).toBeNull();
  });
});

describe("findContainingProject", () => {
  it("returns the project path when cwd exactly equals a project path", () => {
    const result = findContainingProject("/Users/me/proj/agenthud", [
      "/Users/me/proj/agenthud",
      "/Users/me/proj/other",
    ]);
    expect(result).toBe("/Users/me/proj/agenthud");
  });

  it("returns the project path when cwd is a subdirectory of a project", () => {
    const result = findContainingProject("/Users/me/proj/agenthud/src/data", [
      "/Users/me/proj/agenthud",
      "/Users/me/proj/other",
    ]);
    expect(result).toBe("/Users/me/proj/agenthud");
  });

  it("returns null when no project contains cwd", () => {
    const result = findContainingProject("/tmp/random", [
      "/Users/me/proj/agenthud",
      "/Users/me/proj/other",
    ]);
    expect(result).toBeNull();
  });

  it("returns the nearest (longest-prefix) project when several ancestors exist", () => {
    // Both /Users/me and /Users/me/proj/agenthud are registered;
    // cwd inside agenthud should resolve to the deeper one.
    const result = findContainingProject("/Users/me/proj/agenthud/src", [
      "/Users/me",
      "/Users/me/proj/agenthud",
    ]);
    expect(result).toBe("/Users/me/proj/agenthud");
  });

  it("does not match on string prefix without a path-separator boundary", () => {
    // /Users/me/proj/agent is NOT an ancestor of /Users/me/proj/agenthud/src
    const result = findContainingProject("/Users/me/proj/agenthud/src", [
      "/Users/me/proj/agent",
    ]);
    expect(result).toBeNull();
  });

  it("returns null for an empty project list", () => {
    expect(findContainingProject("/anywhere", [])).toBeNull();
  });

  it("accepts Windows-style backslash separators as boundary", () => {
    const result = findContainingProject("C:\\Users\\me\\proj\\agenthud\\src", [
      "C:\\Users\\me\\proj\\agenthud",
      "C:\\Users\\me\\proj\\other",
    ]);
    expect(result).toBe("C:\\Users\\me\\proj\\agenthud");
  });

  it("normalizes both sides via the injected realpath", () => {
    // Both cwd and the registered project go through realpath. After
    // resolution they share the same real path, so the project matches.
    const realpath = (p: string) =>
      p.replace("/sym/cwd", "/real/proj").replace("/sym/proj", "/real/proj");
    const result = findContainingProject("/sym/cwd/src", ["/sym/proj"], {
      realpath,
    });
    expect(result).toBe("/sym/proj");
  });
});

describe("discoverSessions with scopeToProject", () => {
  const projectsDir = join(
    process.env.HOME ?? "/home/user",
    ".claude",
    "projects",
  );
  const targetEncoded = "-Users-me-target";
  const otherEncoded = "-Users-me-other";
  const targetDir = join(projectsDir, targetEncoded);
  const otherDir = join(projectsDir, otherEncoded);

  function wireMocksForTwoProjects() {
    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir) return true;
      if (path === targetDir || path === otherDir) return true;
      if (path.endsWith(".jsonl")) return true;
      return false;
    });

    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return [targetEncoded, otherEncoded] as unknown as ReturnType<
          typeof readdirSync
        >;
      if (path === targetDir)
        return ["a.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      if (path === otherDir)
        return ["b.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });

    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      const isDir = path === targetDir || path === otherDir;
      return {
        isDirectory: () => isDir,
        mtimeMs: NOW - 10_000,
        size: 100,
      } as ReturnType<typeof statSync>;
    });

    vi.mocked(readFileSync).mockReturnValue("");
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  }

  it("returns only the scoped project, dropping the others", () => {
    wireMocksForTwoProjects();
    const tree = discoverSessions(mockConfig, {
      scopeToProject: "/Users/me/target",
    });
    const all = [...tree.projects, ...tree.coldProjects];
    expect(all).toHaveLength(1);
    expect(all[0].projectPath).toBe("/Users/me/target");
  });

  it("returns an empty tree when scopeToProject matches no registered project", () => {
    wireMocksForTwoProjects();
    const tree = discoverSessions(mockConfig, {
      scopeToProject: "/Users/me/nothing-here",
    });
    expect(tree.projects).toHaveLength(0);
    expect(tree.coldProjects).toHaveLength(0);
    expect(tree.totalCount).toBe(0);
  });

  it("keeps the unfiltered behaviour when scopeToProject is omitted", () => {
    wireMocksForTwoProjects();
    const tree = discoverSessions(mockConfig);
    const all = [...tree.projects, ...tree.coldProjects];
    expect(all).toHaveLength(2);
  });
});
