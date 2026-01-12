import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
      expect(result).toMatch(/.claude\/projects\/-Users-neochoon-agenthud$/);
    });

    it("handles paths with multiple slashes", () => {
      const projectPath = "/home/user/projects/my-app";
      const result = getClaudeSessionPath(projectPath);
      expect(result).toMatch(/.claude\/projects\/-home-user-projects-my-app$/);
    });

    it("handles root path", () => {
      const projectPath = "/";
      const result = getClaudeSessionPath(projectPath);
      expect(result).toMatch(/.claude\/projects\/-$/);
    });
  });

  describe("findActiveSession", () => {
    it("returns null when session directory does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = findActiveSession("/fake/session/dir");

      expect(result).toBeNull();
    });

    it("returns null when directory has no jsonl files", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(["readme.txt", "config.json"]);

      const result = findActiveSession("/fake/session/dir");

      expect(result).toBeNull();
    });

    it("returns most recently modified jsonl file", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(["old.jsonl", "new.jsonl"]);
      mockFs.statSync.mockImplementation((path: string) => {
        if (path.includes("old.jsonl")) {
          return { mtimeMs: Date.now() - 60000 }; // 1 minute ago
        }
        return { mtimeMs: Date.now() - 1000 }; // 1 second ago
      });

      const result = findActiveSession("/fake/session/dir");

      expect(result).toBe("/fake/session/dir/new.jsonl");
    });

    it("returns null when most recent file is older than 5 minutes", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(["old.jsonl"]);
      mockFs.statSync.mockReturnValue({
        mtimeMs: Date.now() - 6 * 60 * 1000, // 6 minutes ago
      });

      const result = findActiveSession("/fake/session/dir");

      expect(result).toBeNull();
    });

    it("returns file when modified within 5 minutes", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(["recent.jsonl"]);
      mockFs.statSync.mockReturnValue({
        mtimeMs: Date.now() - 4 * 60 * 1000, // 4 minutes ago
      });

      const result = findActiveSession("/fake/session/dir");

      expect(result).toBe("/fake/session/dir/recent.jsonl");
    });
  });

  describe("parseSessionState", () => {
    it("returns none status when file does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.status).toBe("none");
      expect(result.lastUserMessage).toBeNull();
      expect(result.currentAction).toBeNull();
    });

    it("parses user message from jsonl", () => {
      const jsonl = JSON.stringify({
        type: "user",
        message: { role: "user", content: "Show me the project structure" },
        timestamp: new Date().toISOString(),
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(jsonl);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.lastUserMessage).toBe("Show me the project structure");
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

      expect(result.lastUserMessage).toBe("Now fix the bug");
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

      // Should keep the previous string message since array has no text
      expect(result.lastUserMessage).toBe("Initial message");
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
      expect(result.currentAction).toContain("Bash");
      expect(result.currentAction).toContain("npm run build");
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
            content: [{ type: "text", text: "This code does..." }],
          },
          usage: { output_tokens: 150 },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.status).toBe("completed");
      expect(result.currentAction).toBeNull();
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
          message: { content: [{ type: "text", text: "Done" }] },
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

    it("detects idle status when last activity is older than 5 minutes", () => {
      const fiveMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      const lines = [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "Old message" },
          timestamp: fiveMinutesAgo.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.status).toBe("idle");
    });

    it("accumulates token counts from multiple assistant messages", () => {
      const now = new Date();
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "First" }] },
          usage: { output_tokens: 100 },
          timestamp: new Date(now.getTime() - 3000).toISOString(),
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Second" }] },
          usage: { output_tokens: 200 },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.tokenCount).toBe(300);
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

      expect(result.currentAction).toContain("Read");
      expect(result.currentAction).toContain("/Users/test/src/index.ts");
    });

    it("truncates long tool inputs", () => {
      const now = new Date();
      const longCommand = "a".repeat(100);
      const lines = [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Bash",
                input: { command: longCommand },
              },
            ],
          },
          timestamp: now.toISOString(),
        }),
      ].join("\n");

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines);

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.currentAction!.length).toBeLessThan(100);
      expect(result.currentAction).toContain("...");
    });

    it("handles empty file gracefully", () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("");

      const result = parseSessionState("/fake/session.jsonl");

      expect(result.status).toBe("none");
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

      expect(result.lastUserMessage).toBe("Valid message");
    });

    it("only parses last 50 lines for performance", () => {
      const now = new Date();
      const lines: string[] = [];

      // Add 100 lines with user messages
      for (let i = 0; i < 100; i++) {
        lines.push(
          JSON.stringify({
            type: "user",
            message: { role: "user", content: `Message ${i}` },
            timestamp: new Date(now.getTime() - (100 - i) * 1000).toISOString(),
          })
        );
      }

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(lines.join("\n"));

      const result = parseSessionState("/fake/session.jsonl");

      // Should get the last message from the last 50 lines
      expect(result.lastUserMessage).toBe("Message 99");
    });
  });

  describe("getClaudeData", () => {
    it("returns none status when session directory does not exist", () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = getClaudeData("/Users/test/project");

      expect(result.state.status).toBe("none");
      expect(result.error).toBeUndefined();
    });

    it("returns session state when active session exists", () => {
      const now = new Date();
      const sessionDir = expect.stringMatching(/.claude\/projects\/-Users-test-project$/);

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

      expect(result.state.lastUserMessage).toBe("Test message");
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
    });
  });
});
