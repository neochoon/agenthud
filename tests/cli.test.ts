import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseArgs,
  clearScreen,
  setClearFn,
  resetClearFn,
} from "../src/cli.js";

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
  });

  describe("clearScreen", () => {
    let mockClear: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockClear = vi.fn();
      setClearFn(mockClear);
    });

    afterEach(() => {
      resetClearFn();
    });

    it("calls the clear function", () => {
      clearScreen();

      expect(mockClear).toHaveBeenCalledTimes(1);
    });
  });
});
