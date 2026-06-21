import { describe, expect, it } from "vitest";
import { readSessionCwd } from "../../../src/data/providers/claude.js";

describe("readSessionCwd", () => {
  it("returns the cwd from the first entry that carries one", () => {
    const lines = [
      JSON.stringify({ type: "summary" }), // no cwd
      JSON.stringify({ type: "user", cwd: "/Users/neo/proj" }),
    ];
    expect(readSessionCwd(lines)).toBe("/Users/neo/proj");
  });

  it("preserves a hyphen in the real directory name (the #204 bug)", () => {
    // The folder-name encoding would decode this to .../meta/claude; the
    // authoritative cwd keeps `meta-claude` intact.
    const lines = [
      JSON.stringify({
        type: "user",
        cwd: "/Users/neo/WestbrookAI/meta-claude",
      }),
    ];
    expect(readSessionCwd(lines)).toBe("/Users/neo/WestbrookAI/meta-claude");
  });

  it("returns undefined when no entry has a cwd, or on non-JSON", () => {
    expect(
      readSessionCwd([JSON.stringify({ type: "summary" })]),
    ).toBeUndefined();
    expect(readSessionCwd(["not json"])).toBeUndefined();
    expect(readSessionCwd([])).toBeUndefined();
  });
});
