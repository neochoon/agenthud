import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getAllProjects,
  getOtherSessionsData,
  parseLastAssistantMessage,
  formatRelativeTime,
  setFsMock,
  resetFsMock,
  type OtherSessionsData,
} from "../src/data/otherSessions.js";

describe("otherSessions data module", () => {
  let mockFs: {
    existsSync: ReturnType<typeof vi.fn>;
    readFileSync: ReturnType<typeof vi.fn>;
    readdirSync: ReturnType<typeof vi.fn>;
    statSync: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockFs = {
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      readdirSync: vi.fn(),
      statSync: vi.fn(),
    };
    setFsMock(mockFs);
  });

  afterEach(() => {
    resetFsMock();
  });

  describe("getAllProjects", () => {
    it("returns empty array when projects directory does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = getAllProjects();

      expect(result).toEqual([]);
    });

    it("returns all project directories", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        "-Users-test-project1",
        "-Users-test-project2",
        "-Users-test-project3",
      ]);
      mockFs.statSync.mockReturnValue({ isDirectory: () => true });

      const result = getAllProjects();

      expect(result).toHaveLength(3);
      expect(result[0].encodedPath).toBe("-Users-test-project1");
      expect(result[0].decodedPath).toBe("/Users/test/project1");
    });

    it("filters out non-directory entries", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        "-Users-test-project1",
        "some-file.txt",
      ]);
      mockFs.statSync.mockImplementation((path: string) => ({
        isDirectory: () => !path.includes("some-file.txt"),
      }));

      const result = getAllProjects();

      expect(result).toHaveLength(1);
      expect(result[0].encodedPath).toBe("-Users-test-project1");
    });

    it("decodes project path correctly", () => {
      mockFs.existsSync.mockReturnValue(true);
      // Note: path encoding is ambiguous for paths with hyphens
      // "-Users-test-myproject" could be "/Users/test/myproject" or "/Users-test-myproject"
      mockFs.readdirSync.mockReturnValue(["-Users-test-myproject"]);
      mockFs.statSync.mockReturnValue({ isDirectory: () => true });

      const result = getAllProjects();

      // The decode replaces all "-" with "/", so we get segments
      expect(result[0].decodedPath).toBe("/Users/test/myproject");
    });
  });

  describe("parseLastAssistantMessage", () => {
    it("returns null for empty file", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("");

      const result = parseLastAssistantMessage("/fake/session.jsonl");

      expect(result).toBeNull();
    });

    it("returns null when no assistant messages exist", () => {
      const lines = [
        JSON.stringify({ type: "user", message: { content: "Hello" } }),
        JSON.stringify({ type: "system", subtype: "init" }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

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

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

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

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

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

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

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

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

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
      mockFs.existsSync.mockReturnValue(false);

      const result = getOtherSessionsData("/current/project");

      expect(result.totalProjects).toBe(0);
      expect(result.activeCount).toBe(0);
      expect(result.recentSession).toBeNull();
    });

    it("excludes current project from results", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((path: string) => {
        // Projects directory returns list of project folders
        if (path.endsWith("projects")) {
          return ["-Users-test-current", "-Users-test-other"];
        }
        // Project folders return session files
        return ["session.jsonl"];
      });
      mockFs.statSync.mockImplementation((path: string) => {
        if (path.endsWith(".jsonl")) {
          return { mtimeMs: Date.now() - 1000, isDirectory: () => false };
        }
        return { isDirectory: () => true };
      });
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Hello" }] },
        })
      );

      const result = getOtherSessionsData("/Users/test/current");

      // Total should include all projects (2), but active/recent should exclude current
      expect(result.totalProjects).toBe(2);
      // Only "other" project should be considered
      expect(result.recentSession?.projectPath).toBe("/Users/test/other");
    });

    it("counts active sessions correctly", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((path: string) => {
        if (path.endsWith("projects")) {
          return ["-Users-test-project1", "-Users-test-project2", "-Users-test-project3"];
        }
        return ["session.jsonl"];
      });
      mockFs.statSync.mockImplementation((path: string) => {
        if (path.endsWith(".jsonl")) {
          // project1: active (1 minute ago)
          // project2: active (3 minutes ago)
          // project3: inactive (10 minutes ago)
          if (path.includes("project1")) {
            return { mtimeMs: Date.now() - 1 * 60 * 1000, isDirectory: () => false };
          }
          if (path.includes("project2")) {
            return { mtimeMs: Date.now() - 3 * 60 * 1000, isDirectory: () => false };
          }
          return { mtimeMs: Date.now() - 10 * 60 * 1000, isDirectory: () => false };
        }
        return { isDirectory: () => true };
      });
      mockFs.readFileSync.mockReturnValue(
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
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((path: string) => {
        if (path.endsWith("projects")) {
          return ["-Users-test-older", "-Users-test-newer"];
        }
        return ["session.jsonl"];
      });
      mockFs.statSync.mockImplementation((path: string) => {
        if (path.endsWith(".jsonl")) {
          if (path.includes("newer")) {
            return { mtimeMs: Date.now() - 30 * 1000, isDirectory: () => false }; // 30s ago
          }
          return { mtimeMs: Date.now() - 5 * 60 * 1000, isDirectory: () => false }; // 5m ago
        }
        return { isDirectory: () => true };
      });
      mockFs.readFileSync.mockImplementation((path: string) => {
        if (path.includes("newer")) {
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

      const result = getOtherSessionsData("/some/other/path");

      expect(result.recentSession).not.toBeNull();
      expect(result.recentSession?.projectPath).toBe("/Users/test/newer");
      expect(result.recentSession?.projectName).toBe("newer");
      expect(result.recentSession?.lastMessage).toBe("Recent message");
      expect(result.recentSession?.isActive).toBe(true);
    });

    it("extracts project name from path", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((path: string) => {
        if (path.endsWith("projects")) {
          return ["-Users-test-myproject"];
        }
        return ["session.jsonl"];
      });
      mockFs.statSync.mockImplementation((path: string) => {
        if (path.endsWith(".jsonl")) {
          return { mtimeMs: Date.now() - 1000, isDirectory: () => false };
        }
        return { isDirectory: () => true };
      });
      mockFs.readFileSync.mockReturnValue(
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
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((path: string) => {
        if (path.endsWith("projects")) {
          return ["-Users-test-emptyproject"];
        }
        return []; // No session files
      });
      mockFs.statSync.mockReturnValue({ isDirectory: () => true });

      const result = getOtherSessionsData("/other/path");

      expect(result.totalProjects).toBe(1);
      expect(result.activeCount).toBe(0);
      expect(result.recentSession).toBeNull();
    });

    it("respects activeThreshold option", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation((path: string) => {
        if (path.endsWith("projects")) {
          return ["-Users-test-project"];
        }
        return ["session.jsonl"];
      });
      mockFs.statSync.mockImplementation((path: string) => {
        if (path.endsWith(".jsonl")) {
          // 3 minutes ago - active with 5m threshold, inactive with 2m threshold
          return { mtimeMs: Date.now() - 3 * 60 * 1000, isDirectory: () => false };
        }
        return { isDirectory: () => true };
      });
      mockFs.readFileSync.mockReturnValue(
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
});
