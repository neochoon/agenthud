import { describe, expect, it } from "vitest";
import {
  parseModelName,
  parseActivitiesFromLines,
  getToolDetail,
} from "../../src/data/activityParser.js";

describe("parseModelName", () => {
  it("parses sonnet model ID", () => {
    expect(parseModelName("claude-sonnet-4-20250514")).toBe("sonnet-4");
  });

  it("parses opus model ID", () => {
    expect(parseModelName("claude-opus-4-5-20251101")).toBe("opus-4.5");
  });

  it("parses haiku model ID", () => {
    expect(parseModelName("claude-3-5-haiku-20241022")).toBe("haiku-3.5");
  });

  it("strips date suffix as fallback", () => {
    expect(parseModelName("claude-unknown-20250101")).toBe("claude-unknown");
  });
});

describe("getToolDetail", () => {
  it("returns command for Bash", () => {
    expect(getToolDetail("Bash", { command: "npm test" })).toBe("npm test");
  });

  it("returns basename for file_path", () => {
    expect(getToolDetail("Read", { file_path: "/src/auth.ts" })).toBe("auth.ts");
  });

  it("returns empty string when no input", () => {
    expect(getToolDetail("Task", undefined)).toBe("");
  });
});

describe("parseActivitiesFromLines", () => {
  const lines = [
    JSON.stringify({
      type: "system",
      subtype: "init",
      timestamp: "2025-01-15T10:00:00.000Z",
    }),
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "Fix the bug" },
      timestamp: "2025-01-15T10:00:01.000Z",
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-sonnet-4-20250514",
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "/src/auth.ts" } },
        ],
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      timestamp: "2025-01-15T10:00:02.000Z",
    }),
  ];

  it("parses user message", () => {
    const result = parseActivitiesFromLines(lines);
    const userActivity = result.activities.find((a) => a.type === "user");
    expect(userActivity?.detail).toBe("Fix the bug");
  });

  it("parses tool use", () => {
    const result = parseActivitiesFromLines(lines);
    const toolActivity = result.activities.find((a) => a.label === "Read");
    expect(toolActivity?.detail).toBe("auth.ts");
  });

  it("accumulates token count", () => {
    const result = parseActivitiesFromLines(lines);
    expect(result.tokenCount).toBe(120);
  });

  it("extracts model name", () => {
    const result = parseActivitiesFromLines(lines);
    expect(result.modelName).toBe("sonnet-4");
  });

  it("skips TodoWrite activities", () => {
    const todoLines = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "TodoWrite", input: {} }],
        },
        timestamp: "2025-01-15T10:00:00.000Z",
      }),
    ];
    const result = parseActivitiesFromLines(todoLines);
    expect(result.activities.filter((a) => a.label === "TodoWrite")).toHaveLength(0);
  });
});
