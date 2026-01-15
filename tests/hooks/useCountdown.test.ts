/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCountdown } from "../../src/ui/hooks/useCountdown.js";

describe("useCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initialization", () => {
    it("initializes countdown from interval in seconds", () => {
      const { result } = renderHook(() =>
        useCountdown({
          panels: {
            project: { interval: 30000 }, // 30s in ms
            git: { interval: 60000 }, // 60s in ms
          },
          enabled: true,
        })
      );

      expect(result.current.countdowns.project).toBe(30);
      expect(result.current.countdowns.git).toBe(60);
    });

    it("sets null for manual panels (interval === null)", () => {
      const { result } = renderHook(() =>
        useCountdown({
          panels: {
            tests: { interval: null }, // manual
          },
          enabled: true,
        })
      );

      expect(result.current.countdowns.tests).toBeNull();
    });

    it("handles custom panels", () => {
      const { result } = renderHook(() =>
        useCountdown({
          panels: {
            git: { interval: 30000 },
          },
          customPanels: {
            deploy: { interval: 120000 }, // 2 minutes
            build: { interval: null }, // manual
          },
          enabled: true,
        })
      );

      expect(result.current.countdowns.deploy).toBe(120);
      expect(result.current.countdowns.build).toBeNull();
    });
  });

  describe("tick behavior", () => {
    it("decrements countdown every second", () => {
      const { result } = renderHook(() =>
        useCountdown({
          panels: {
            git: { interval: 5000 }, // 5s
          },
          enabled: true,
        })
      );

      expect(result.current.countdowns.git).toBe(5);

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.countdowns.git).toBe(4);

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.countdowns.git).toBe(3);
    });

    it("stops at 1, does not go to 0", () => {
      const { result } = renderHook(() =>
        useCountdown({
          panels: {
            git: { interval: 3000 }, // 3s
          },
          enabled: true,
        })
      );

      expect(result.current.countdowns.git).toBe(3);

      act(() => {
        vi.advanceTimersByTime(3000); // 3 seconds
      });

      // Should stop at 1, not 0
      expect(result.current.countdowns.git).toBe(1);
    });

    it("does not tick manual panels", () => {
      const { result } = renderHook(() =>
        useCountdown({
          panels: {
            tests: { interval: null },
          },
          enabled: true,
        })
      );

      expect(result.current.countdowns.tests).toBeNull();

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(result.current.countdowns.tests).toBeNull();
    });

    it("does not tick when disabled", () => {
      const { result } = renderHook(() =>
        useCountdown({
          panels: {
            git: { interval: 5000 },
          },
          enabled: false, // disabled (once mode)
        })
      );

      expect(result.current.countdowns.git).toBe(5);

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      // Should not change when disabled
      expect(result.current.countdowns.git).toBe(5);
    });
  });

  describe("reset", () => {
    it("resets single panel countdown to interval", () => {
      const { result } = renderHook(() =>
        useCountdown({
          panels: {
            git: { interval: 30000 },
          },
          enabled: true,
        })
      );

      // Tick down
      act(() => {
        vi.advanceTimersByTime(10000); // 10 seconds
      });
      expect(result.current.countdowns.git).toBe(20);

      // Reset
      act(() => {
        result.current.reset("git");
      });
      expect(result.current.countdowns.git).toBe(30);
    });

    it("resets custom panel countdown", () => {
      const { result } = renderHook(() =>
        useCountdown({
          panels: {},
          customPanels: {
            deploy: { interval: 60000 },
          },
          enabled: true,
        })
      );

      act(() => {
        vi.advanceTimersByTime(30000);
      });
      expect(result.current.countdowns.deploy).toBe(30);

      act(() => {
        result.current.reset("deploy");
      });
      expect(result.current.countdowns.deploy).toBe(60);
    });

    it("does nothing for manual panels", () => {
      const { result } = renderHook(() =>
        useCountdown({
          panels: {
            tests: { interval: null },
          },
          enabled: true,
        })
      );

      act(() => {
        result.current.reset("tests");
      });

      expect(result.current.countdowns.tests).toBeNull();
    });
  });

  describe("resetAll", () => {
    it("resets all panel countdowns", () => {
      const { result } = renderHook(() =>
        useCountdown({
          panels: {
            project: { interval: 30000 },
            git: { interval: 60000 },
            tests: { interval: null }, // manual
          },
          customPanels: {
            deploy: { interval: 120000 },
          },
          enabled: true,
        })
      );

      // Tick down
      act(() => {
        vi.advanceTimersByTime(20000);
      });

      expect(result.current.countdowns.project).toBe(10);
      expect(result.current.countdowns.git).toBe(40);
      expect(result.current.countdowns.deploy).toBe(100);

      // Reset all
      act(() => {
        result.current.resetAll();
      });

      expect(result.current.countdowns.project).toBe(30);
      expect(result.current.countdowns.git).toBe(60);
      expect(result.current.countdowns.deploy).toBe(120);
      expect(result.current.countdowns.tests).toBeNull(); // manual stays null
    });
  });

  describe("cleanup", () => {
    it("clears interval on unmount", () => {
      const { unmount } = renderHook(() =>
        useCountdown({
          panels: {
            git: { interval: 30000 },
          },
          enabled: true,
        })
      );

      const clearIntervalSpy = vi.spyOn(global, "clearInterval");

      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});
