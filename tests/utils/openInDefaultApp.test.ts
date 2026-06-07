import { describe, expect, it } from "vitest";
import { buildOpenCommand } from "../../src/utils/openInDefaultApp.js";

describe("buildOpenCommand", () => {
  it("uses `open <path>` on macOS", () => {
    expect(buildOpenCommand("darwin", "/tmp/foo.md")).toEqual({
      command: "open",
      args: ["/tmp/foo.md"],
    });
  });

  it("uses `xdg-open <path>` on Linux", () => {
    expect(buildOpenCommand("linux", "/tmp/foo.md")).toEqual({
      command: "xdg-open",
      args: ["/tmp/foo.md"],
    });
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
