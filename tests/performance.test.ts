import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startPerformanceCleanup,
  stopPerformanceCleanup,
  clearPerformanceEntries,
  setPerformanceFunctions,
  resetPerformanceFunctions,
} from "../src/utils/performance.js";

describe("Performance cleanup", () => {
  let mockClearMarks: ReturnType<typeof vi.fn>;
  let mockClearMeasures: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockClearMarks = vi.fn();
    mockClearMeasures = vi.fn();
    setPerformanceFunctions({
      clearMarks: mockClearMarks,
      clearMeasures: mockClearMeasures,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopPerformanceCleanup();
    resetPerformanceFunctions();
    vi.useRealTimers();
  });

  describe("clearPerformanceEntries", () => {
    it("clears both marks and measures", () => {
      clearPerformanceEntries();

      expect(mockClearMarks).toHaveBeenCalledTimes(1);
      expect(mockClearMeasures).toHaveBeenCalledTimes(1);
    });
  });

  describe("startPerformanceCleanup", () => {
    it("runs cleanup periodically at specified interval", () => {
      startPerformanceCleanup(1000);

      // Initial call should not happen
      expect(mockClearMarks).not.toHaveBeenCalled();

      // After first interval
      vi.advanceTimersByTime(1000);
      expect(mockClearMarks).toHaveBeenCalledTimes(1);
      expect(mockClearMeasures).toHaveBeenCalledTimes(1);

      // After second interval
      vi.advanceTimersByTime(1000);
      expect(mockClearMarks).toHaveBeenCalledTimes(2);
      expect(mockClearMeasures).toHaveBeenCalledTimes(2);
    });

    it("uses default interval of 60 seconds", () => {
      startPerformanceCleanup();

      vi.advanceTimersByTime(59999);
      expect(mockClearMarks).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(mockClearMarks).toHaveBeenCalledTimes(1);
    });
  });

  describe("stopPerformanceCleanup", () => {
    it("stops the periodic cleanup", () => {
      startPerformanceCleanup(1000);

      vi.advanceTimersByTime(1000);
      expect(mockClearMarks).toHaveBeenCalledTimes(1);

      stopPerformanceCleanup();

      vi.advanceTimersByTime(2000);
      expect(mockClearMarks).toHaveBeenCalledTimes(1); // No additional calls
    });

    it("is safe to call when not started", () => {
      expect(() => stopPerformanceCleanup()).not.toThrow();
    });
  });
});
