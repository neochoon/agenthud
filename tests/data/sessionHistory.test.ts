import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const { existsSync, readFileSync } = await import("node:fs");
const { parseSessionHistory } = await import(
  "../../src/data/sessionHistory.js"
);

afterEach(() => vi.resetAllMocks());

const makeLines = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Read",
            input: { file_path: `/src/file${i}.ts` },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
    }),
  ).join("\n");

describe("parseSessionHistory", () => {
  it("returns empty array when file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(parseSessionHistory("/nonexistent.jsonl")).toHaveLength(0);
  });

  it("parses all entries without truncation (300 lines)", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(makeLines(300));
    const result = parseSessionHistory("/session.jsonl");
    expect(result.length).toBe(300);
  });

  it("returns entries in chronological order (oldest first)", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(makeLines(5));
    const result = parseSessionHistory("/session.jsonl");
    for (let i = 1; i < result.length; i++) {
      expect(result[i].timestamp.getTime()).toBeGreaterThanOrEqual(
        result[i - 1].timestamp.getTime(),
      );
    }
  });

  it("routes Kiro paths to the Kiro parser (not the Claude one)", () => {
    // A line in Kiro shape (`kind: "Prompt"`) — the Claude parser
    // would silently produce zero activities for this; the Kiro
    // parser maps it to a user activity.
    const kiroLine = JSON.stringify({
      version: "v1",
      kind: "Prompt",
      data: {
        message_id: "p1",
        content: [{ kind: "text", data: "Hello Kiro" }],
        meta: { timestamp: 1781220419 },
      },
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(kiroLine);
    const result = parseSessionHistory("/Users/x/.kiro/sessions/cli/aaa.jsonl");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("user");
    expect(result[0].detail).toBe("Hello Kiro");
  });

  it("routes non-Kiro paths to the Claude parser (default)", () => {
    // Claude parser ignores Kiro-shaped records, so a Kiro line
    // fed through a non-Kiro path yields zero activities.
    const kiroLine = JSON.stringify({
      version: "v1",
      kind: "Prompt",
      data: {
        message_id: "p1",
        content: [{ kind: "text", data: "Hello" }],
        meta: { timestamp: 1781220419 },
      },
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(kiroLine);
    const result = parseSessionHistory(
      "/Users/x/.claude/projects/-foo/bar.jsonl",
    );
    expect(result).toHaveLength(0);
  });
});
