import { describe, it, expect, afterEach } from "vitest";
import {
  getTerminalWidth,
  setStdoutColumnsFn,
  resetStdoutColumnsFn,
  MIN_TERMINAL_WIDTH,
  MAX_TERMINAL_WIDTH,
  DEFAULT_FALLBACK_WIDTH,
} from "../src/ui/constants.js";

describe("getTerminalWidth", () => {
  afterEach(() => {
    resetStdoutColumnsFn();
  });

  describe("normal terminal sizes", () => {
    it("returns terminal width for normal size (100 columns)", () => {
      setStdoutColumnsFn(() => 100);

      const width = getTerminalWidth();

      expect(width).toBe(100);
    });

    it("returns terminal width for small terminal (60 columns)", () => {
      setStdoutColumnsFn(() => 60);

      const width = getTerminalWidth();

      expect(width).toBe(60);
    });
  });

  describe("max width cap", () => {
    it("caps width at MAX_TERMINAL_WIDTH (120) for wide terminals", () => {
      setStdoutColumnsFn(() => 200);

      const width = getTerminalWidth();

      expect(width).toBe(MAX_TERMINAL_WIDTH);
      expect(width).toBe(120);
    });

    it("caps width at 120 for ultrawide terminals (300 columns)", () => {
      setStdoutColumnsFn(() => 300);

      const width = getTerminalWidth();

      expect(width).toBe(120);
    });

    it("returns exactly 120 when terminal is 120 columns", () => {
      setStdoutColumnsFn(() => 120);

      const width = getTerminalWidth();

      expect(width).toBe(120);
    });
  });

  describe("min width enforcement", () => {
    it("enforces minimum width for very small terminals", () => {
      setStdoutColumnsFn(() => 30);

      const width = getTerminalWidth();

      expect(width).toBe(MIN_TERMINAL_WIDTH);
      expect(width).toBe(50);
    });

    it("returns exactly 50 when terminal is 50 columns", () => {
      setStdoutColumnsFn(() => 50);

      const width = getTerminalWidth();

      expect(width).toBe(50);
    });
  });

  describe("fallback behavior", () => {
    it("returns fallback width when columns is undefined", () => {
      setStdoutColumnsFn(() => undefined);

      const width = getTerminalWidth();

      expect(width).toBe(DEFAULT_FALLBACK_WIDTH);
      expect(width).toBe(80);
    });

    it("returns fallback width when columns is 0", () => {
      setStdoutColumnsFn(() => 0);

      const width = getTerminalWidth();

      expect(width).toBe(80);
    });

    it("returns fallback width when columns is negative", () => {
      setStdoutColumnsFn(() => -1);

      const width = getTerminalWidth();

      expect(width).toBe(80);
    });
  });
});
