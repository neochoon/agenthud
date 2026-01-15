import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sep } from "path";

// Mock fs module
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
  };
});

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import {
  getAllProjects,
  getOtherSessionsData,
  parseLastAssistantMessage,
  formatRelativeTime,
  type OtherSessionsData,
} from "../../src/data/otherSessions.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockStatSync = vi.mocked(statSync);

describe("otherSessions data module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getAllProjects", () => {
    it("returns empty array when projects directory does not exist", () => {
      mockExistsSync.mockReturnValue(false);

      const result = getAllProjects();

      expect(result).toEqual([]);
    });

    it("returns all project directories", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        "-Users-test-project1",
        "-Users-test-project2",
        "-Users-test-project3",
      ] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

      const result = getAllProjects();

      expect(result).toHaveLength(3);
      expect(result[0].encodedPath).toBe("-Users-test-project1");
      // Decoded path uses platform-specific separator
      expect(result[0].decodedPath).toBe(`${sep}Users${sep}test${sep}project1`);
    });

    it("filters out non-directory entries", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        "-Users-test-project1",
        "some-file.txt",
      ] as any);
      mockStatSync.mockImplementation((path: any) => ({
        isDirectory: () => !String(path).includes("some-file.txt"),
      } as any));

      const result = getAllProjects();

      expect(result).toHaveLength(1);
      expect(result[0].encodedPath).toBe("-Users-test-project1");
    });

    it("decodes project path correctly", () => {
      mockExistsSync.mockReturnValue(true);
      // Note: path encoding is ambiguous for paths with hyphens
      // "-Users-test-myproject" could be "/Users/test/myproject" or "/Users-test-myproject"
      mockReaddirSync.mockReturnValue(["-Users-test-myproject"] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

      const result = getAllProjects();

      // The decode replaces all "-" with platform separator
      expect(result[0].decodedPath).toBe(`${sep}Users${sep}test${sep}myproject`);
    });
  });

  describe("parseLastAssistantMessage", () => {
    it("returns null for empty file", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("");

      const result = parseLastAssistantMessage("/fake/session.jsonl");

      expect(result).toBeNull();
    });

    it("returns null when no assistant messages exist", () => {
      const lines = [
        JSON.stringify({ type: "user", message: { content: "Hello" } }),
        JSON.stringify({ type: "system", subtype: "init" }),
      ].join("\n");

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(lines);

      const result = parseLastAssistantMessage("/fake/session.jsonl");

      expect(result).toBeNull();
    });

    it("extracts text from last assistant message", () => {
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "First response" }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Last response here" }] },
        }),
      ].join("\n");

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(lines);

      const result = parseLastAssistantMessage("/fake/session.jsonl");

      expect(result).toBe("Last response here");
    });

    it("handles assistant message with tool_use only (no text)", () => {
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Earlier message" }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }],
          },
        }),
      ].join("\n");

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(lines);

      const result = parseLastAssistantMessage("/fake/session.jsonl");

      // Should return the earlier message with text, not the tool_use one
      expect(result).toBe("Earlier message");
    });

    it("removes newlines from message", () => {
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Line one\nLine two\nLine three" }] },
        }),
      ].join("\n");

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(lines);

      const result = parseLastAssistantMessage("/fake/session.jsonl");

      expect(result).toBe("Line one Line two Line three");
    });

    it("skips invalid JSON lines", () => {
      const lines = [
        "invalid json",
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Valid message" }] },
        }),
        "{ also invalid }",
      ].join("\n");

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(lines);

      const result = parseLastAssistantMessage("/fake/session.jsonl");

      expect(result).toBe("Valid message");
    });
  });

  describe("formatRelativeTime", () => {
    it("formats seconds ago", () => {
      const date = new Date(Date.now() - 30 * 1000);
      expect(formatRelativeTime(date)).toBe("30s ago");
    });

    it("formats minutes ago", () => {
      const date = new Date(Date.now() - 5 * 60 * 1000);
      expect(formatRelativeTime(date)).toBe("5m ago");
    });

    it("formats hours ago", () => {
      const date = new Date(Date.now() - 2 * 60 * 60 * 1000);
      expect(formatRelativeTime(date)).toBe("2h ago");
    });

    it("formats days ago", () => {
      const date = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      expect(formatRelativeTime(date)).toBe("3d ago");
    });

    it("shows 'just now' for very recent times", () => {
      const date = new Date(Date.now() - 500); // 0.5 seconds ago
      expect(formatRelativeTime(date)).toBe("just now");
    });
  });

  describe("getOtherSessionsData", () => {
    it("returns empty data when projects directory does not exist", () => {
      mockExistsSync.mockReturnValue(false);

      const result = getOtherSessionsData("/current/project");

      expect(result.totalProjects).toBe(0);
      expect(result.activeCount).toBe(0);
      expect(result.recentSession).toBeNull();
    });

    it("excludes current project from results", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((path: any) => {
        // Projects directory returns list of project folders
        if (String(path).endsWith("projects")) {
          return ["-Users-test-current", "-Users-test-other"] as any;
        }
        // Project folders return session files
        return ["session.jsonl"] as any;
      });
      mockStatSync.mockImplementation((path: any) => {
        if (String(path).endsWith(".jsonl")) {
          return { mtimeMs: Date.now() - 1000, isDirectory: () => false } as any;
        }
        return { isDirectory: () => true } as any;
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello" }] },
        })
      );

      const result = getOtherSessionsData(`${sep}Users${sep}test${sep}current`);

      // Total should include all projects (2), but active/recent should exclude current
      expect(result.totalProjects).toBe(2);
      // Only "other" project should be considered
      expect(result.recentSession?.projectPath).toBe(`${sep}Users${sep}test${sep}other`);
    });

    it("counts active sessions correctly", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((path: any) => {
        if (String(path).endsWith("projects")) {
          return ["-Users-test-project1", "-Users-test-project2", "-Users-test-project3"] as any;
        }
        return ["session.jsonl"] as any;
      });
      mockStatSync.mockImplementation((path: any) => {
        if (String(path).endsWith(".jsonl")) {
          // project1: active (1 minute ago)
          // project2: active (3 minutes ago)
          // project3: inactive (10 minutes ago)
          if (String(path).includes("project1")) {
            return { mtimeMs: Date.now() - 1 * 60 * 1000, isDirectory: () => false } as any;
          }
          if (String(path).includes("project2")) {
            return { mtimeMs: Date.now() - 3 * 60 * 1000, isDirectory: () => false } as any;
          }
          return { mtimeMs: Date.now() - 10 * 60 * 1000, isDirectory: () => false } as any;
        }
        return { isDirectory: () => true } as any;
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello" }] },
        })
      );

      const result = getOtherSessionsData("/some/other/path");

      expect(result.totalProjects).toBe(3);
      expect(result.activeCount).toBe(2); // project1 and project2
    });

    it("returns most recent session info", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((path: any) => {
        if (String(path).endsWith("projects")) {
          return ["-Users-test-older", "-Users-test-newer"] as any;
        }
        return ["session.jsonl"] as any;
      });
      mockStatSync.mockImplementation((path: any) => {
        if (String(path).endsWith(".jsonl")) {
          if (String(path).includes("newer")) {
            return { mtimeMs: Date.now() - 30 * 1000, isDirectory: () => false } as any; // 30s ago
          }
          return { mtimeMs: Date.now() - 5 * 60 * 1000, isDirectory: () => false } as any; // 5m ago
        }
        return { isDirectory: () => true } as any;
      });
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path).includes("newer")) {
          return JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "Recent message" }] },
          });
        }
        return JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Old message" }] },
        });
      });

      const result = getOtherSessionsData(`${sep}some${sep}other${sep}path`);

      expect(result.recentSession).not.toBeNull();
      expect(result.recentSession?.projectPath).toBe(`${sep}Users${sep}test${sep}newer`);
      expect(result.recentSession?.projectName).toBe("newer");
      expect(result.recentSession?.lastMessage).toBe("Recent message");
      expect(result.recentSession?.isActive).toBe(true);
    });

    it("extracts project name from path", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((path: any) => {
        if (String(path).endsWith("projects")) {
          return ["-Users-test-myproject"] as any;
        }
        return ["session.jsonl"] as any;
      });
      mockStatSync.mockImplementation((path: any) => {
        if (String(path).endsWith(".jsonl")) {
          return { mtimeMs: Date.now() - 1000, isDirectory: () => false } as any;
        }
        return { isDirectory: () => true } as any;
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello" }] },
        })
      );

      const result = getOtherSessionsData("/other/path");

      // Project name is the last segment of the decoded path
      expect(result.recentSession?.projectName).toBe("myproject");
    });

    it("handles project with no session files", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((path: any) => {
        if (String(path).endsWith("projects")) {
          return ["-Users-test-emptyproject"] as any;
        }
        return [] as any; // No session files
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

      const result = getOtherSessionsData("/other/path");

      expect(result.totalProjects).toBe(1);
      expect(result.activeCount).toBe(0);
      expect(result.recentSession).toBeNull();
    });

    it("respects activeThreshold option", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((path: any) => {
        if (String(path).endsWith("projects")) {
          return ["-Users-test-project"] as any;
        }
        return ["session.jsonl"] as any;
      });
      mockStatSync.mockImplementation((path: any) => {
        if (String(path).endsWith(".jsonl")) {
          // 3 minutes ago - active with 5m threshold, inactive with 2m threshold
          return { mtimeMs: Date.now() - 3 * 60 * 1000, isDirectory: () => false } as any;
        }
        return { isDirectory: () => true } as any;
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello" }] },
        })
      );

      // With 5 minute threshold (default)
      const result1 = getOtherSessionsData("/other/path");
      expect(result1.activeCount).toBe(1);
      expect(result1.recentSession?.isActive).toBe(true);

      // With 2 minute threshold
      const result2 = getOtherSessionsData("/other/path", { activeThresholdMs: 2 * 60 * 1000 });
      expect(result2.activeCount).toBe(0);
      expect(result2.recentSession?.isActive).toBe(false);
    });
  });

  describe("projectNames", () => {
    it("returns project names sorted by most recent first", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((path: any) => {
        if (String(path).endsWith("projects")) {
          return ["-Users-test-alpha", "-Users-test-beta", "-Users-test-gamma"] as any;
        }
        return ["session.jsonl"] as any;
      });
      mockStatSync.mockImplementation((path: any) => {
        if (String(path).endsWith(".jsonl")) {
          // gamma: most recent, alpha: oldest, beta: middle
          if (String(path).includes("gamma")) {
            return { mtimeMs: Date.now() - 1 * 60 * 1000, isDirectory: () => false } as any;
          }
          if (String(path).includes("beta")) {
            return { mtimeMs: Date.now() - 5 * 60 * 1000, isDirectory: () => false } as any;
          }
          return { mtimeMs: Date.now() - 10 * 60 * 1000, isDirectory: () => false } as any;
        }
        return { isDirectory: () => true } as any;
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello" }] },
        })
      );

      const result = getOtherSessionsData("/other/path");

      expect(result.projectNames).toEqual(["gamma", "beta", "alpha"]);
    });

    it("excludes current project from projectNames", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((path: any) => {
        if (String(path).endsWith("projects")) {
          return ["-Users-test-current", "-Users-test-other"] as any;
        }
        return ["session.jsonl"] as any;
      });
      mockStatSync.mockImplementation((path: any) => {
        if (String(path).endsWith(".jsonl")) {
          return { mtimeMs: Date.now() - 1000, isDirectory: () => false } as any;
        }
        return { isDirectory: () => true } as any;
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello" }] },
        })
      );

      const result = getOtherSessionsData(`${sep}Users${sep}test${sep}current`);

      expect(result.projectNames).toEqual(["other"]);
      expect(result.projectNames).not.toContain("current");
    });

    it("returns empty array when no projects exist", () => {
      mockExistsSync.mockReturnValue(false);

      const result = getOtherSessionsData(`${sep}current${sep}project`);

      expect(result.projectNames).toEqual([]);
    });

    it("returns empty array when no other sessions have files", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((path: any) => {
        if (String(path).endsWith("projects")) {
          return ["-Users-test-emptyproject"] as any;
        }
        return [] as any; // No session files
      });
      mockStatSync.mockReturnValue({ isDirectory: () => true } as any);

      const result = getOtherSessionsData("/other/path");

      expect(result.projectNames).toEqual([]);
    });

    it("deduplicates project names with same basename", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation((path: any) => {
        if (String(path).endsWith("projects")) {
          // Two different paths with same basename "dotfiles"
          return ["-Users-alice-dotfiles", "-Users-bob-dotfiles", "-Users-test-other"] as any;
        }
        return ["session.jsonl"] as any;
      });
      mockStatSync.mockImplementation((path: any) => {
        if (String(path).endsWith(".jsonl")) {
          if (String(path).includes("alice")) {
            return { mtimeMs: Date.now() - 1 * 60 * 1000, isDirectory: () => false } as any;
          }
          if (String(path).includes("bob")) {
            return { mtimeMs: Date.now() - 2 * 60 * 1000, isDirectory: () => false } as any;
          }
          return { mtimeMs: Date.now() - 3 * 60 * 1000, isDirectory: () => false } as any;
        }
        return { isDirectory: () => true } as any;
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello" }] },
        })
      );

      const result = getOtherSessionsData("/other/path");

      // Should only have unique names, "dotfiles" appears once
      expect(result.projectNames).toEqual(["dotfiles", "other"]);
    });
  });
});
