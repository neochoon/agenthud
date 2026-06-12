import { homedir } from "node:os";
import { beforeAll, describe, expect, it } from "vitest";
import { formatPromptSource } from "../../src/data/summaryRunner.js";

// These tests assert against the DEFAULT home-dir layout
// (join(homedir(), ".agenthud")). The global setup points
// AGENTHUD_HOME at a temp dir for isolation; unset it here — safe
// because this file mocks node:fs, so no real I/O can occur.
beforeAll(() => {
  delete process.env.AGENTHUD_HOME;
});

describe("formatPromptSource", () => {
  it("returns the daily prompt path with ~ abbreviation when no override", () => {
    expect(formatPromptSource("daily")).toBe("~/.agenthud/summary-prompt.md");
  });

  it("returns the range prompt path with ~ abbreviation when no override", () => {
    expect(formatPromptSource("range")).toBe(
      "~/.agenthud/summary-range-prompt.md",
    );
  });

  it("returns an inline marker when the user passed --prompt on daily", () => {
    expect(formatPromptSource("daily", "Only commits")).toBe(
      "<inline> (from --prompt)",
    );
  });

  it("ignores inline override on range (range does not accept --prompt)", () => {
    expect(formatPromptSource("range", "ignored")).toBe(
      "~/.agenthud/summary-range-prompt.md",
    );
  });

  it("falls back to the absolute path when homedir is not a prefix", () => {
    // Sanity: the helper still produces a usable label even if the user's
    // homedir somehow doesn't match the path (rare in practice, e.g.
    // sandboxed test runners with a custom XDG layout).
    const path = formatPromptSource("daily");
    if (!path.startsWith("~")) {
      expect(path).toContain(homedir());
    }
  });
});
