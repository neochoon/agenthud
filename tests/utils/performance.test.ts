import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock perf_hooks module
vi.mock("perf_hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("perf_hooks")>();
  return {
    ...actual,
    performance: {
      ...actual.performance,
      clearMarks: vi.fn(),
      clearMeasures: vi.fn(),
    },
  };
});

import { performance } from "perf_hooks";
import {
  startPerformanceCleanup,
  stopPerformanceCleanup,
  clearPerformanceEntries,
} from "../../src/utils/performance.js";

const mockClearMarks = vi.mocked(performance.clearMarks);
const mockClearMeasures = vi.mocked(performance.clearMeasures);

describe("Performance cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopPerformanceCleanup();
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
