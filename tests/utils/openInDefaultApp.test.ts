import { describe, expect, it } from "vitest";
import {
  buildOpenCommand,
  commandExists,
} from "../../src/utils/openInDefaultApp.js";

describe("buildOpenCommand", () => {
  it("uses `open <path>` on macOS", () => {
    expect(buildOpenCommand("darwin", "/tmp/foo.md")).toEqual({
      command: "open",
      args: ["/tmp/foo.md"],
    });
  });

  it("uses `xdg-open <path>` on Linux by default", () => {
    expect(buildOpenCommand("linux", "/tmp/foo.md")).toEqual({
      command: "xdg-open",
      args: ["/tmp/foo.md"],
    });
  });

  it("prefers `wslview` on Linux when the wslView opt is set", () => {
    // On WSL, openInDefaultApp passes wslView=true after a sync
    // check that wslview is on PATH; this lets the host's default app
    // handle the file (browser, VS Code, …) instead of an X server.
    expect(
      buildOpenCommand("linux", "/mnt/c/Users/me/foo.md", { wslView: true }),
    ).toEqual({ command: "wslview", args: ["/mnt/c/Users/me/foo.md"] });
  });

  it("uses `cmd /c start \"\" <path>` on Windows", () => {
    // The empty-string first arg to `start` is the window title — required
    // because Windows treats the first quoted argument as the title.
    expect(buildOpenCommand("win32", "C:/tmp/foo.md")).toEqual({
      command: "cmd",
      args: ["/c", "start", "", "C:/tmp/foo.md"],
    });
  });

  it("returns null for an unsupported platform so the caller can warn", () => {
    expect(buildOpenCommand("aix", "/tmp/foo.md")).toBeNull();
  });

  it("preserves paths containing spaces verbatim (spawn handles quoting)", () => {
    const result = buildOpenCommand(
      "darwin",
      "/Users/me/Library/Application Support/agenthud/summary.md",
    );
    expect(result).toEqual({
      command: "open",
      args: ["/Users/me/Library/Application Support/agenthud/summary.md"],
    });
  });
});

describe("commandExists", () => {
  it("returns true for a command on the test runner's PATH", () => {
    // `node` runs vitest, so it's guaranteed to be on PATH everywhere
    // this test could plausibly execute (CI, dev machines, WSL).
    expect(commandExists("node")).toBe(true);
  });

  it("returns false for a command that does not exist", () => {
    expect(commandExists("definitely-not-a-real-command-xyz-12345")).toBe(
      false,
    );
  });
});
