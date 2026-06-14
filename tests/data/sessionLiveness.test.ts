import { describe, expect, it } from "vitest";
import { detectLiveState } from "../../src/data/sessionLiveness.js";

const NOW = 1_700_000_000_000;
const RECENT = NOW - 10_000;
const STALE = NOW - 31 * 60 * 1000;

const j = (obj: unknown): string => JSON.stringify(obj);

describe("detectLiveState", () => {
  it("returns 'waiting' when the last assistant entry ends with text", () => {
    const lines = [
      j({ type: "user", message: { role: "user", content: "Fix the bug" } }),
      j({
        type: "assistant",
        message: { content: [{ type: "text", text: "All done — fixed it." }] },
      }),
    ];
    expect(detectLiveState(lines, RECENT, NOW)).toBe("waiting");
  });

  it("returns 'working' for a pending non-question tool_use", () => {
    const lines = [
      j({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Bash", input: { command: "npm test" } },
          ],
        },
      }),
    ];
    expect(detectLiveState(lines, RECENT, NOW)).toBe("working");
  });

  it("returns 'working' when assistant emits text then a pending tool_use", () => {
    const lines = [
      j({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me check." },
            { type: "tool_use", name: "Read", input: { file_path: "/a.ts" } },
          ],
        },
      }),
    ];
    expect(detectLiveState(lines, RECENT, NOW)).toBe("working");
  });

  it("returns 'waiting' when the pending tool_use is AskUserQuestion", () => {
    const lines = [
      j({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "AskUserQuestion",
              input: { questions: [] },
            },
          ],
        },
      }),
    ];
    expect(detectLiveState(lines, RECENT, NOW)).toBe("waiting");
  });

  it("returns 'working' when the last entry is a user prompt", () => {
    const lines = [
      j({
        type: "assistant",
        message: { content: [{ type: "text", text: "Done." }] },
      }),
      j({ type: "user", message: { role: "user", content: "Now add tests" } }),
    ];
    expect(detectLiveState(lines, RECENT, NOW)).toBe("working");
  });

  it("returns 'working' when the last entry is a user tool_result", () => {
    const lines = [
      j({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Bash", input: { command: "ls" } },
          ],
        },
      }),
      j({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "file.ts" },
          ],
        },
      }),
    ];
    expect(detectLiveState(lines, RECENT, NOW)).toBe("working");
  });

  it("skips trailing system and unparseable lines to find the last meaningful entry", () => {
    const lines = [
      j({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Bash", input: { command: "npm test" } },
          ],
        },
      }),
      j({ type: "system", subtype: "info" }),
      "not valid json{",
    ];
    expect(detectLiveState(lines, RECENT, NOW)).toBe("working");
  });

  it("returns null for empty input", () => {
    expect(detectLiveState([], RECENT, NOW)).toBeNull();
  });

  it("returns null when all lines are unparseable", () => {
    expect(detectLiveState(["garbage", "{nope"], RECENT, NOW)).toBeNull();
  });

  it("returns null when mtime is older than 30 minutes, even with a live tail", () => {
    const lines = [
      j({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Bash", input: { command: "npm test" } },
          ],
        },
      }),
    ];
    expect(detectLiveState(lines, STALE, NOW)).toBeNull();
  });

  // Sub-agents are one-shot: they produce a result and terminate, never
  // pausing for user input. So a yielded turn (text-only assistant, or an
  // AskUserQuestion it can't actually get answered) means DONE, not
  // "waiting". `isSubAgent` suppresses the waiting verdict; a pending
  // tool_use still reads as working (the sub-agent is mid-task).
  describe("isSubAgent", () => {
    it("a finished sub-agent (text-only end_turn) is null, not 'waiting'", () => {
      const lines = [
        j({ type: "user", message: { role: "user", content: "Explore X" } }),
        j({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Here is the result." }],
            stop_reason: "end_turn",
          },
        }),
      ];
      expect(detectLiveState(lines, RECENT, NOW)).toBe("waiting");
      expect(detectLiveState(lines, RECENT, NOW, true)).toBeNull();
    });

    it("a sub-agent with a pending tool_use still reads as 'working'", () => {
      const lines = [
        j({
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", name: "Grep", input: { pattern: "foo" } },
            ],
          },
        }),
      ];
      expect(detectLiveState(lines, RECENT, NOW, true)).toBe("working");
    });
  });
});
