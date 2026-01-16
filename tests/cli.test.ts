import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearScreen, getHelp, getVersion, parseArgs } from "../src/cli.js";

describe("CLI argument parsing", () => {
  describe("parseArgs", () => {
    it("returns watch mode by default", () => {
      const result = parseArgs([]);

      expect(result.mode).toBe("watch");
      expect(result.command).toBeUndefined();
    });

    it("returns watch mode with --watch flag", () => {
      const result = parseArgs(["--watch"]);

      expect(result.mode).toBe("watch");
    });

    it("returns watch mode with -w flag", () => {
      const result = parseArgs(["-w"]);

      expect(result.mode).toBe("watch");
    });

    it("returns once mode with --once flag", () => {
      const result = parseArgs(["--once"]);

      expect(result.mode).toBe("once");
    });

    it("once flag takes precedence over watch", () => {
      const result = parseArgs(["--watch", "--once"]);

      expect(result.mode).toBe("once");
    });

    it("returns init command when first arg is 'init'", () => {
      const result = parseArgs(["init"]);

      expect(result.command).toBe("init");
    });

    it("ignores init if not first argument", () => {
      const result = parseArgs(["--once", "init"]);

      expect(result.command).toBeUndefined();
      expect(result.mode).toBe("once");
    });

    it("returns version command with --version flag", () => {
      const result = parseArgs(["--version"]);

      expect(result.command).toBe("version");
    });

    it("returns version command with -V flag", () => {
      const result = parseArgs(["-V"]);

      expect(result.command).toBe("version");
    });

    it("returns help command with --help flag", () => {
      const result = parseArgs(["--help"]);

      expect(result.command).toBe("help");
    });

    it("returns help command with -h flag", () => {
      const result = parseArgs(["-h"]);

      expect(result.command).toBe("help");
    });
  });

  describe("getVersion", () => {
    it("returns version string from package.json", () => {
      const version = getVersion();

      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("getHelp", () => {
    it("returns help text with usage info", () => {
      const help = getHelp();

      expect(help).toContain("Usage:");
      expect(help).toContain("agenthud");
    });

    it("includes available options", () => {
      const help = getHelp();

      expect(help).toContain("--help");
      expect(help).toContain("--version");
      expect(help).toContain("--once");
      expect(help).toContain("--watch");
    });

    it("includes init command", () => {
      const help = getHelp();

      expect(help).toContain("init");
    });
  });

  describe("clearScreen", () => {
    let consoleClearSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleClearSpy = vi.spyOn(console, "clear").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleClearSpy.mockRestore();
    });

    it("calls console.clear", () => {
      clearScreen();

      expect(consoleClearSpy).toHaveBeenCalledTimes(1);
    });
  });
});
