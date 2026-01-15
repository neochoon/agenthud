import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";
import {
  getClaudeSessionPath,
  findActiveSession,
  parseSessionState,
  getClaudeData,
  setFsMock,
  resetFsMock,
  type ClaudeSessionState,
  type ClaudeData,
} from "../src/data/claude.js";
import { ICONS } from "../src/types/index.js";

describe("claude data module", () => {
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

  describe("getClaudeSessionPath", () => {
    it("converts project path to Claude session directory", () => {
      const projectPath = "/Users/neochoon/agenthud";
      const result = getClaudeSessionPath(projectPath);
      // Check path contains expected components (platform-independent)
      expect(result).toContain(".claude");
      expect(result).toContain("projects");
      expect(result).toContain("-Users-neochoon-agenthud");
    });

    it("handles paths with multiple slashes", () => {
      const projectPath = "/home/user/projects/my-app";
      const result = getClaudeSessionPath(projectPath);
      expect(result).toContain(".claude");
      expect(result).toContain("projects");
      expect(result).toContain("-home-user-projects-my-app");
    });

    it("handles root path", () => {
      const projectPath = "/";
      const result = getClaudeSessionPath(projectPath);
      expect(result).toContain(".claude");
      expect(result).toContain("projects");
      // Encoded path ends with just "-"
      expect(result.endsWith("-")).toBe(true);
    });
  });

  describe("findActiveSession", () => {
    const ONE_HOUR_MS = 60 * 60 * 1000;

    it("returns null when session directory does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = findActiveSession("/fake/session/dir", ONE_HOUR_MS);

      expect(result).toBeNull();
    });

    it("returns null when directory has no jsonl files", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(["readme.txt", "config.json"]);

      const result = findActiveSession("/fake/session/dir", ONE_HOUR_MS);

      expect(result).toBeNull();
    });

    it("returns most recently modified jsonl file", () => {
      const sessionDir = join("/fake", "session", "dir");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(["old.jsonl", "new.jsonl"]);
      mockFs.statSync.mockImplementation((path: string) => {
        if (path.includes("old.jsonl")) {
          return { mtimeMs: Date.now() - 60000 }; // 1 minute ago
        }
        return { mtimeMs: Date.now() - 1000 }; // 1 second ago
      });

      const result = findActiveSession(sessionDir, ONE_HOUR_MS);

      expect(result).toBe(join(sessionDir, "new.jsonl"));
    });

    it("returns null when most recent file is older than timeout", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(["old.jsonl"]);
      mockFs.statSync.mockReturnValue({
        mtimeMs: Date.now() - 61 * 60 * 1000, // 61 minutes ago
      });

      const result = findActiveSession("/fake/session/dir", ONE_HOUR_MS);

      expect(result).toBeNull();
    });

    it("returns file when modified within timeout", () => {
      const sessionDir = join("/fake", "session", "dir");
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(["recent.jsonl"]);
      mockFs.statSync.mockReturnValue({
        mtimeMs: Date.now() - 59 * 60 * 1000, // 59 minutes ago
      });

      const result = findActiveSession(sessionDir, ONE_HOUR_MS);

      expect(result).toBe(join(sessionDir, "recent.jsonl"));
    });
  });

  describe("parseSessionState", () => {
    it("returns none status when file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.status).toBe("none");
      expect(result.activities).toEqual([]);
    });

    it("parses user message into activity", () => {
      const jsonl = JSON.stringify({
        type: "user",
        message: { role: "user", content: "Show me the project structure" },
        timestamp: new Date().toISOString(),
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(jsonl);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.activities.length).toBe(1);
      expect(result.activities[0].type).toBe("user");
      expect(result.activities[0].label).toBe("User");
      expect(result.activities[0].detail).toContain("Show me the project");
    });

    it("parses user message from array content with text block", () => {
      const jsonl = JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "123", content: "some output" },
            { type: "text", text: "Now fix the bug" },
          ],
        },
        timestamp: new Date().toISOString(),
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(jsonl);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.activities.length).toBe(1);
      expect(result.activities[0].detail).toContain("Now fix the bug");
    });

    it("skips user message when array content has only tool_result", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "Initial message" },
          timestamp: new Date(now.getTime() - 10000).toISOString(),
        }),
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "123", content: "output" },
            ],
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      // Should only have the first message since second has no text
      expect(result.activities.length).toBe(1);
      expect(result.activities[0].detail).toContain("Initial message");
    });

    it("detects running status for tool_use within 30 seconds", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "Run the build" },
          timestamp: new Date(now.getTime() - 10000).toISOString(),
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Bash",
                input: { command: "npm run build" },
              },
            ],
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.status).toBe("running");
      // Most recent activity should be the Bash tool
      expect(result.activities[0].label).toBe("Bash");
      expect(result.activities[0].detail).toContain("npm run build");
    });

    it("detects completed status for text response within 30 seconds", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "Explain this code" },
          timestamp: new Date(now.getTime() - 5000).toISOString(),
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "This code does something very important and interesting." }],
            usage: { output_tokens: 150 },
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.status).toBe("completed");
      expect(result.tokenCount).toBe(150);
    });

    it("detects completed status after stop_hook_summary", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "Do something" },
          timestamp: new Date(now.getTime() - 5000).toISOString(),
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Done with the task successfully" }] },
          timestamp: new Date(now.getTime() - 2000).toISOString(),
        }),
        JSON.stringify({
          type: "system",
          subtype: "stop_hook_summary",
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.status).toBe("completed");
    });

    it("detects completed status when last activity is older than 30 seconds", () => {
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      const lines = [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "Old message" },
          timestamp: sixMinutesAgo.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.status).toBe("completed");
    });

    it("accumulates token counts from multiple assistant messages", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "First response with some content" }],
            usage: { output_tokens: 100 },
          },
          timestamp: new Date(now.getTime() - 3000).toISOString(),
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Second response with more content" }],
            usage: { output_tokens: 200 },
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.tokenCount).toBe(300);
    });

    it("accumulates all token types: input, cache_read, and output", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "First response" }],
            usage: {
              input_tokens: 100,
              cache_read_input_tokens: 5000,
              output_tokens: 200,
            },
          },
          timestamp: new Date(now.getTime() - 3000).toISOString(),
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Second response" }],
            usage: {
              input_tokens: 50,
              cache_read_input_tokens: 5100,
              output_tokens: 150,
            },
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      // (100 + 5000 + 200) + (50 + 5100 + 150) = 5300 + 5300 = 10600
      expect(result.tokenCount).toBe(10600);
    });

    it("handles missing token fields gracefully", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Response" }],
            usage: {
              input_tokens: 100,
              // cache_read_input_tokens is missing
              output_tokens: 200,
            },
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      // 100 + 0 + 200 = 300
      expect(result.tokenCount).toBe(300);
    });

    it("includes subagent tokens when subagents folder exists", () => {
      const now = new Date();
      const mainSessionLines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Main response" }],
            usage: { input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 },
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      const subagentLines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Subagent response" }],
            usage: { input_tokens: 50, cache_read_input_tokens: 500, output_tokens: 25 },
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockImplementation((path: string) => {
        if (path === "/fake/session.jsonl") return true;
        if (path === "/fake/session/subagents") return true;
        return false;
      });
      mockFs.readFileSync.mockImplementation((path: string) => {
        if (path === "/fake/session.jsonl") return mainSessionLines;
        if (path === "/fake/session/subagents/agent-abc123.jsonl") return subagentLines;
        return "";
      });
      mockFs.readdirSync.mockImplementation((path: string) => {
        if (path === "/fake/session/subagents") return ["agent-abc123.jsonl"];
        return [];
      });

      const result = parseSessionState("/fake/session.jsonl");

      // Main: 100 + 1000 + 50 = 1150
      // Subagent: 50 + 500 + 25 = 575
      // Total: 1725
      expect(result.tokenCount).toBe(1725);
    });

    it("handles multiple subagent files", () => {
      const now = new Date();
      const mainSessionLines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Main" }],
            usage: { output_tokens: 100 },
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      const subagent1Lines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Sub1" }],
            usage: { output_tokens: 200 },
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      const subagent2Lines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Sub2" }],
            usage: { output_tokens: 300 },
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockImplementation((path: string) => {
        if (path === "/fake/session.jsonl") return true;
        if (path === "/fake/session/subagents") return true;
        return false;
      });
      mockFs.readFileSync.mockImplementation((path: string) => {
        if (path === "/fake/session.jsonl") return mainSessionLines;
        if (path === "/fake/session/subagents/agent-1.jsonl") return subagent1Lines;
        if (path === "/fake/session/subagents/agent-2.jsonl") return subagent2Lines;
        return "";
      });
      mockFs.readdirSync.mockImplementation((path: string) => {
        if (path === "/fake/session/subagents") return ["agent-1.jsonl", "agent-2.jsonl"];
        return [];
      });

      const result = parseSessionState("/fake/session.jsonl");

      // Main: 100, Sub1: 200, Sub2: 300 = 600
      expect(result.tokenCount).toBe(600);
    });

    it("works normally when subagents folder does not exist", () => {
      const now = new Date();
      const mainSessionLines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Main" }],
            usage: { output_tokens: 100 },
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockImplementation((path: string) => {
        if (path === "/fake/session.jsonl") return true;
        return false; // subagents folder doesn't exist
      });
      mockFs.readFileSync.mockReturnValue(mainSessionLines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.tokenCount).toBe(100);
    });

    it("extracts tool name and input for file operations", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Read",
                input: { file_path: "/Users/test/src/index.ts" },
              },
            ],
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.activities[0].label).toBe("Read");
      expect(result.activities[0].detail).toBe("index.ts");
    });

    it("uses correct icons for different tools", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Edit", input: { file_path: "/test.ts" } },
            ],
          },
          timestamp: new Date(now.getTime() - 3000).toISOString(),
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Bash", input: { command: "npm test" } },
            ],
          },
          timestamp: new Date(now.getTime() - 2000).toISOString(),
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Grep", input: { pattern: "function" } },
            ],
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      // Activities are in reverse order (most recent first)
      expect(result.activities[0].icon).toBe(ICONS.Grep);
      expect(result.activities[1].icon).toBe(ICONS.Bash);
      expect(result.activities[2].icon).toBe(ICONS.Edit);
    });

    it("handles empty file gracefully", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("");

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.status).toBe("none");
      expect(result.activities).toEqual([]);
    });

    it("skips invalid JSON lines", () => {
      const now = new Date();
      const lines = [
        "invalid json line",
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "Valid message" },
          timestamp: now.toISOString(),
        }),
        "{ also invalid }",
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.activities.length).toBe(1);
      expect(result.activities[0].detail).toContain("Valid message");
    });

    it("limits activities to 10 most recent", () => {
      const now = new Date();
      const lines: string[] = [];

      // Add 20 tool uses
      for (let i = 0; i < 20; i++) {
        lines.push(
          JSON.stringify({
            type: "assistant",
            message: {
              content: [
                { type: "tool_use", name: "Read", input: { file_path: `/file${i}.ts` } },
              ],
            },
            timestamp: new Date(now.getTime() - (20 - i) * 1000).toISOString(),
          })
        );
      }

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines.join("\n"));

      const result = parseSessionState("/fake/session.jsonl");

      // Should only have 10 activities (default)
      expect(result.activities.length).toBe(10);
      // Most recent should be first
      expect(result.activities[0].detail).toBe("file19.ts");
    });

    it("respects maxActivities parameter", () => {
      const now = new Date();
      const lines: string[] = [];

      // Create 20 Read activities
      for (let i = 0; i < 20; i++) {
        lines.push(
          JSON.stringify({
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  name: "Read",
                  input: { file_path: `file${i}.ts` },
                },
              ],
            },
            timestamp: new Date(now.getTime() - (20 - i) * 1000).toISOString(),
          })
        );
      }

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines.join("\n"));

      const result = parseSessionState("/fake/session.jsonl", 5);

      // Should only have 5 activities
      expect(result.activities.length).toBe(5);
      // Most recent should be first
      expect(result.activities[0].detail).toBe("file19.ts");
    });

    it("extracts sessionStartTime from first entry with timestamp", () => {
      const sessionStart = new Date("2024-01-15T10:30:00Z");
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "First message" },
          timestamp: sessionStart.toISOString(),
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Response to the first message" }] },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.sessionStartTime).not.toBeNull();
      expect(result.sessionStartTime?.toISOString()).toBe(sessionStart.toISOString());
    });

    it("returns null sessionStartTime when no entries have timestamps", () => {
      const lines = [
        JSON.stringify({ type: "system", subtype: "init" }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.sessionStartTime).toBeNull();
    });

    it("returns null sessionStartTime for empty file", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("");

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.sessionStartTime).toBeNull();
    });

    it("extracts description for Task tool", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Task",
                input: {
                  description: "Re-check PR eligibility",
                  prompt: "Check if PR is still open...",
                  subagent_type: "general-purpose",
                },
              },
            ],
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.activities[0].label).toBe("Task");
      expect(result.activities[0].detail).toBe("Re-check PR eligibility");
    });

    it("returns empty detail for Task tool without description", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Task",
                input: {
                  prompt: "Some prompt without description",
                  subagent_type: "general-purpose",
                },
              },
            ],
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.activities[0].label).toBe("Task");
      expect(result.activities[0].detail).toBe("");
    });

    it("prioritizes command over description for tools with both", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Bash",
                input: {
                  command: "npm test",
                  description: "Run tests",
                },
              },
            ],
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.activities[0].label).toBe("Bash");
      expect(result.activities[0].detail).toBe("npm test");
    });

    it("parses todos from toolUseResult in user entry", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "123", content: "Todos modified" },
            ],
          },
          toolUseResult: {
            newTodos: [
              { content: "Create issue", status: "completed", activeForm: "Creating issue" },
              { content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
              { content: "Implement feature", status: "pending", activeForm: "Implementing" },
            ],
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.todos).toBeDefined();
      expect(result.todos).toHaveLength(3);
      expect(result.todos![0].content).toBe("Create issue");
      expect(result.todos![0].status).toBe("completed");
      expect(result.todos![1].status).toBe("in_progress");
      expect(result.todos![2].status).toBe("pending");
    });

    it("uses latest todos when multiple toolUseResult entries exist", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "" }] },
          toolUseResult: {
            newTodos: [
              { content: "Task A", status: "in_progress", activeForm: "A" },
            ],
          },
          timestamp: new Date(now.getTime() - 5000).toISOString(),
        }),
        JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: "2", content: "" }] },
          toolUseResult: {
            newTodos: [
              { content: "Task A", status: "completed", activeForm: "A" },
              { content: "Task B", status: "in_progress", activeForm: "B" },
            ],
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.todos).toHaveLength(2);
      expect(result.todos![0].status).toBe("completed");
      expect(result.todos![1].status).toBe("in_progress");
    });

    it("returns null todos when no toolUseResult exists", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "Hello" },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.todos).toBeNull();
    });

    it("skips TodoWrite tool from activities", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Edit", input: { file_path: "/test.ts" } },
            ],
          },
          timestamp: new Date(now.getTime() - 2000).toISOString(),
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "TodoWrite", input: {} },
            ],
          },
          timestamp: new Date(now.getTime() - 1000).toISOString(),
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Bash", input: { command: "npm test" } },
            ],
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      // Should only have Edit and Bash, not TodoWrite
      expect(result.activities.length).toBe(2);
      expect(result.activities.map((a) => a.label)).toEqual(["Bash", "Edit"]);
    });

    it("aggregates consecutive same tool operations with count", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Edit", input: { file_path: "/test.ts" } },
            ],
          },
          timestamp: new Date(now.getTime() - 4000).toISOString(),
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Edit", input: { file_path: "/test.ts" } },
            ],
          },
          timestamp: new Date(now.getTime() - 3000).toISOString(),
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Edit", input: { file_path: "/test.ts" } },
            ],
          },
          timestamp: new Date(now.getTime() - 2000).toISOString(),
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Bash", input: { command: "npm test" } },
            ],
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      // Should aggregate 3 Edit operations into 1 with count=3
      expect(result.activities.length).toBe(2);
      expect(result.activities[1].label).toBe("Edit");
      expect(result.activities[1].count).toBe(3);
      expect(result.activities[0].label).toBe("Bash");
      expect(result.activities[0].count).toBeUndefined();
    });

    it("does not aggregate different file edits", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Edit", input: { file_path: "/file1.ts" } },
            ],
          },
          timestamp: new Date(now.getTime() - 2000).toISOString(),
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Edit", input: { file_path: "/file2.ts" } },
            ],
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      // Should have 2 separate entries
      expect(result.activities.length).toBe(2);
      expect(result.activities[0].detail).toBe("file2.ts");
      expect(result.activities[1].detail).toBe("file1.ts");
      expect(result.activities[0].count).toBeUndefined();
      expect(result.activities[1].count).toBeUndefined();
    });
  });

  describe("getClaudeData", () => {
    it("returns none status and hasSession false when session directory does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = getClaudeData("/Users/test/project");

      expect(result.state.status).toBe("none");
      expect(result.hasSession).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("returns hasSession true when session directory exists but no active session", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(["old.jsonl"]);
      mockFs.statSync.mockReturnValue({ mtimeMs: Date.now() - 61 * 60 * 1000 }); // 61 minutes ago (beyond default 60 min timeout)

      const result = getClaudeData("/Users/test/project");

      expect(result.state.status).toBe("none");
      expect(result.hasSession).toBe(true);
    });

    it("returns session state when active session exists", () => {
      const now = new Date();

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(["session.jsonl"]);
      mockFs.statSync.mockReturnValue({ mtimeMs: Date.now() - 1000 });
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "Test message" },
          timestamp: now.toISOString(),
        })
      );

      const result = getClaudeData("/Users/test/project");

      expect(result.state.activities.length).toBe(1);
      expect(result.state.activities[0].detail).toContain("Test message");
      expect(result.hasSession).toBe(true);
      expect(result.timestamp).toBeDefined();
    });

    it("returns error when file read fails", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = getClaudeData("/Users/test/project");

      expect(result.error).toBe("Permission denied");
      expect(result.state.status).toBe("none");
      expect(result.hasSession).toBe(false);
    });
  });
});
