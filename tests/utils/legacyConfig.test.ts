import { describe, expect, it } from "vitest";
import { isLegacyProjectConfig } from "../../src/utils/legacyConfig.js";

describe("isLegacyProjectConfig", () => {
  it("returns true when cwd is a real project directory (cwd != home)", () => {
    expect(isLegacyProjectConfig("/Users/me/work/myproject", "/Users/me")).toBe(
      true,
    );
  });

  it("returns false when cwd is the user's home directory", () => {
    // This is the bug fix: ~/.agenthud/config.yaml is the GLOBAL config, not a
    // legacy project file. Offering to delete it would wipe user settings.
    expect(isLegacyProjectConfig("/Users/me", "/Users/me")).toBe(false);
  });

  it("returns false when cwd resolves to home with trailing slash", () => {
    expect(isLegacyProjectConfig("/Users/me/", "/Users/me")).toBe(false);
  });

  it("treats relative-to-same-target paths as equal", () => {
    expect(isLegacyProjectConfig("/Users/me/./", "/Users/me")).toBe(false);
  });
});
