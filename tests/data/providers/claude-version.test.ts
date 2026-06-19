import { describe, expect, it } from "vitest";
import { readClaudeVersion } from "../../../src/data/providers/claude.js";

describe("readClaudeVersion", () => {
  it("returns the version of the most recent entry that carries one", () => {
    const lines = [
      JSON.stringify({ type: "user", version: "2.1.100" }),
      JSON.stringify({ type: "assistant", version: "2.1.148", message: {} }),
    ];
    expect(readClaudeVersion(lines)).toBe("2.1.148");
  });
  it("skips entries without a version and falls back to an earlier one", () => {
    const lines = [
      JSON.stringify({ type: "user", version: "2.1.100" }),
      JSON.stringify({ type: "summary" }), // no version
    ];
    expect(readClaudeVersion(lines)).toBe("2.1.100");
  });
  it("returns undefined when no entry has a version", () => {
    expect(
      readClaudeVersion([JSON.stringify({ type: "summary" })]),
    ).toBeUndefined();
    expect(readClaudeVersion(["not json"])).toBeUndefined();
  });
});
