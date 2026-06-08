import { describe, expect, it } from "vitest";
import { isLegacyProjectConfig } from "../../src/utils/legacyConfig.js";

describe("isLegacyProjectConfig — native (non-WSL)", () => {
  // The runtime is the macOS dev box; isWSL detector returns false
  // for these tests automatically. Explicitly injecting `isWSL: false`
  // keeps the intent in the test names.
  const opts = { isWSL: false };

  it("returns true when cwd is a real project directory (cwd != home)", () => {
    expect(
      isLegacyProjectConfig("/Users/me/work/myproject", "/Users/me", opts),
    ).toBe(true);
  });

  it("returns false when cwd is the user's home directory", () => {
    expect(isLegacyProjectConfig("/Users/me", "/Users/me", opts)).toBe(false);
  });

  it("returns false when cwd resolves to home with trailing slash", () => {
    expect(isLegacyProjectConfig("/Users/me/", "/Users/me", opts)).toBe(false);
  });

  it("treats relative-to-same-target paths as equal", () => {
    expect(isLegacyProjectConfig("/Users/me/./", "/Users/me", opts)).toBe(
      false,
    );
  });

  it("does NOT special-case Windows-mount paths when not on WSL", () => {
    // `/mnt/c/Users/X` on a real Linux box is a normal path; nothing
    // about it implies "Windows global config". The cross-OS heuristic
    // only kicks in inside WSL.
    expect(
      isLegacyProjectConfig("/mnt/c/Users/someone", "/home/me", opts),
    ).toBe(true);
  });
});

describe("isLegacyProjectConfig — inside WSL", () => {
  // WSL is the only environment where `homedir()` lies about the
  // user's effective home for the .agenthud/config.yaml lookup.
  const opts = { isWSL: true };

  it("returns false for /mnt/<drive>/Users/<name> (Windows-side user home)", () => {
    expect(
      isLegacyProjectConfig("/mnt/c/Users/neoch", "/home/neochoon", opts),
    ).toBe(false);
  });

  it("handles uppercase mount drive letters", () => {
    expect(
      isLegacyProjectConfig("/mnt/D/Users/neoch", "/home/neochoon", opts),
    ).toBe(false);
  });

  it("trailing slash still matches", () => {
    expect(
      isLegacyProjectConfig("/mnt/c/Users/neoch/", "/home/neochoon", opts),
    ).toBe(false);
  });

  it("still returns true for a nested project under a Windows user home", () => {
    // `/mnt/c/Users/neoch/projects/foo` is a real working dir, not a
    // home — the prompt should fire for any `.agenthud/config.yaml`
    // there.
    expect(
      isLegacyProjectConfig(
        "/mnt/c/Users/neoch/projects/foo",
        "/home/neochoon",
        opts,
      ),
    ).toBe(true);
  });

  it("still returns false when cwd is the Linux home (same as native)", () => {
    expect(
      isLegacyProjectConfig("/home/neochoon", "/home/neochoon", opts),
    ).toBe(false);
  });

  it("returns true for an unrelated dir that's neither home nor a Windows mount", () => {
    expect(
      isLegacyProjectConfig("/etc/something", "/home/neochoon", opts),
    ).toBe(true);
  });
});
