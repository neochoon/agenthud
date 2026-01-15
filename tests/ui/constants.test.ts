import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getTerminalWidth,
  MIN_TERMINAL_WIDTH,
  MAX_TERMINAL_WIDTH,
  DEFAULT_FALLBACK_WIDTH,
} from "../../src/ui/constants.js";

describe("getTerminalWidth", () => {
  const originalColumns = process.stdout.columns;

  afterEach(() => {
    Object.defineProperty(process.stdout, "columns", {
      value: originalColumns,
      writable: true,
      configurable: true,
    });
  });

  function setColumns(value: number | undefined) {
    Object.defineProperty(process.stdout, "columns", {
      value,
      writable: true,
      configurable: true,
    });
  }

  describe("normal terminal sizes", () => {
    it("returns terminal width for normal size (100 columns)", () => {
      setColumns(100);

      const width = getTerminalWidth();

      expect(width).toBe(100);
    });

    it("returns terminal width for small terminal (60 columns)", () => {
      setColumns(60);

      const width = getTerminalWidth();

      expect(width).toBe(60);
    });
  });

  describe("max width cap", () => {
    it("caps width at MAX_TERMINAL_WIDTH (120) for wide terminals", () => {
      setColumns(200);

      const width = getTerminalWidth();

      expect(width).toBe(MAX_TERMINAL_WIDTH);
      expect(width).toBe(120);
    });

    it("caps width at 120 for ultrawide terminals (300 columns)", () => {
      setColumns(300);

      const width = getTerminalWidth();

      expect(width).toBe(120);
    });

    it("returns exactly 120 when terminal is 120 columns", () => {
      setColumns(120);

      const width = getTerminalWidth();

      expect(width).toBe(120);
    });
  });

  describe("min width enforcement", () => {
    it("enforces minimum width for very small terminals", () => {
      setColumns(30);

      const width = getTerminalWidth();

      expect(width).toBe(MIN_TERMINAL_WIDTH);
      expect(width).toBe(50);
    });

    it("returns exactly 50 when terminal is 50 columns", () => {
      setColumns(50);

      const width = getTerminalWidth();

      expect(width).toBe(50);
    });
  });

  describe("fallback behavior", () => {
    it("returns fallback width when columns is undefined", () => {
      setColumns(undefined);

      const width = getTerminalWidth();

      expect(width).toBe(DEFAULT_FALLBACK_WIDTH);
      expect(width).toBe(80);
    });

    it("returns fallback width when columns is 0", () => {
      setColumns(0);

      const width = getTerminalWidth();

      expect(width).toBe(80);
    });

    it("returns fallback width when columns is negative", () => {
      setColumns(-1);

      const width = getTerminalWidth();

      expect(width).toBe(80);
    });
  });
});
