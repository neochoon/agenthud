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
    expect(tree.projects).toHaveLength(0);
    expect(tree.coldProjects).toHaveLength(0);
    expect(tree.totalCount).toBe(0);
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

  it("filters out hidden projects entirely", () => {
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
    expect(tree.projects).toHaveLength(0);
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
    const result = findContainingProject(
      "C:\\Users\\me\\proj\\agenthud\\src",
      ["C:\\Users\\me\\proj\\agenthud", "C:\\Users\\me\\proj\\other"],
    );
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
