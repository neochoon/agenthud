import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("CLI argument parsing", () => {
  describe("parseArgs", () => {
    it("returns watch mode by default", () => {
      const result = parseArgs([]);

      expect(result.mode).toBe("watch");
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
  });
});
