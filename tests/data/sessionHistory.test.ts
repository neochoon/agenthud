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
});
