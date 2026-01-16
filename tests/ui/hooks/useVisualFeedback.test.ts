/**
 * @vitest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVisualFeedback } from "../../../src/ui/hooks/useVisualFeedback.js";

describe("useVisualFeedback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initialization", () => {
    it("initializes all panels with default state", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: ["project", "git", "tests", "claude"],
        }),
      );

      expect(result.current.states.project).toEqual({
        isRunning: false,
        justRefreshed: false,
        justCompleted: false,
      });
      expect(result.current.states.git).toEqual({
        isRunning: false,
        justRefreshed: false,
        justCompleted: false,
      });
      expect(result.current.states.tests).toEqual({
        isRunning: false,
        justRefreshed: false,
        justCompleted: false,
      });
      expect(result.current.states.claude).toEqual({
        isRunning: false,
        justRefreshed: false,
        justCompleted: false,
      });
    });

    it("handles empty panel list", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: [],
        }),
      );

      expect(result.current.states).toEqual({});
    });

    it("handles custom panels", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: ["git", "deploy", "build"],
        }),
      );

      expect(result.current.states.deploy).toEqual({
        isRunning: false,
        justRefreshed: false,
        justCompleted: false,
      });
      expect(result.current.states.build).toEqual({
        isRunning: false,
        justRefreshed: false,
        justCompleted: false,
      });
    });
  });

  describe("setRunning", () => {
    it("sets isRunning to true for a panel", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: ["git"],
        }),
      );

      act(() => {
        result.current.setRunning("git", true);
      });

      expect(result.current.states.git.isRunning).toBe(true);
    });

    it("sets isRunning to false for a panel", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: ["git"],
        }),
      );

      act(() => {
        result.current.setRunning("git", true);
      });
      expect(result.current.states.git.isRunning).toBe(true);

      act(() => {
        result.current.setRunning("git", false);
      });
      expect(result.current.states.git.isRunning).toBe(false);
    });

    it("does not affect other panels", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: ["git", "tests"],
        }),
      );

      act(() => {
        result.current.setRunning("git", true);
      });

      expect(result.current.states.git.isRunning).toBe(true);
      expect(result.current.states.tests.isRunning).toBe(false);
    });
  });

  describe("setRefreshed", () => {
    it("sets justRefreshed to true for a panel", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: ["git"],
        }),
      );

      act(() => {
        result.current.setRefreshed("git");
      });

      expect(result.current.states.git.justRefreshed).toBe(true);
    });

    it("auto-clears justRefreshed after 1.5 seconds", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: ["git"],
        }),
      );

      act(() => {
        result.current.setRefreshed("git");
      });
      expect(result.current.states.git.justRefreshed).toBe(true);

      // Advance time by 1.4 seconds - should still be true
      act(() => {
        vi.advanceTimersByTime(1400);
      });
      expect(result.current.states.git.justRefreshed).toBe(true);

      // Advance time by 0.2 seconds (total 1.6s) - should be cleared
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(result.current.states.git.justRefreshed).toBe(false);
    });

    it("resets timer when called again before timeout", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: ["git"],
        }),
      );

      act(() => {
        result.current.setRefreshed("git");
      });

      // Advance 1 second
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(result.current.states.git.justRefreshed).toBe(true);

      // Call again - should reset timer
      act(() => {
        result.current.setRefreshed("git");
      });

      // Advance 1 second (total would be 2s from first call)
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      // Should still be true because timer was reset
      expect(result.current.states.git.justRefreshed).toBe(true);

      // Advance 0.6 more seconds (1.6s from second call)
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(result.current.states.git.justRefreshed).toBe(false);
    });
  });

  describe("setCompleted", () => {
    it("sets justCompleted to true for a panel", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: ["tests"],
        }),
      );

      act(() => {
        result.current.setCompleted("tests");
      });

      expect(result.current.states.tests.justCompleted).toBe(true);
    });

    it("auto-clears justCompleted after 1.5 seconds", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: ["tests"],
        }),
      );

      act(() => {
        result.current.setCompleted("tests");
      });
      expect(result.current.states.tests.justCompleted).toBe(true);

      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(result.current.states.tests.justCompleted).toBe(false);
    });
  });

  describe("startAsync / endAsync", () => {
    it("startAsync sets isRunning to true", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: ["git"],
        }),
      );

      act(() => {
        result.current.startAsync("git");
      });

      expect(result.current.states.git.isRunning).toBe(true);
    });

    it("endAsync sets isRunning to false and justRefreshed to true", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: ["git"],
        }),
      );

      act(() => {
        result.current.startAsync("git");
      });
      expect(result.current.states.git.isRunning).toBe(true);

      act(() => {
        result.current.endAsync("git");
      });

      expect(result.current.states.git.isRunning).toBe(false);
      expect(result.current.states.git.justRefreshed).toBe(true);
    });

    it("endAsync with completed flag sets justCompleted instead", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: ["tests"],
        }),
      );

      act(() => {
        result.current.startAsync("tests");
      });

      act(() => {
        result.current.endAsync("tests", { completed: true });
      });

      expect(result.current.states.tests.isRunning).toBe(false);
      expect(result.current.states.tests.justRefreshed).toBe(false);
      expect(result.current.states.tests.justCompleted).toBe(true);
    });
  });

  describe("getState", () => {
    it("returns state for existing panel", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: ["git"],
        }),
      );

      const state = result.current.getState("git");
      expect(state).toEqual({
        isRunning: false,
        justRefreshed: false,
        justCompleted: false,
      });
    });

    it("returns default state for unknown panel", () => {
      const { result } = renderHook(() =>
        useVisualFeedback({
          panels: ["git"],
        }),
      );

      const state = result.current.getState("unknown");
      expect(state).toEqual({
        isRunning: false,
        justRefreshed: false,
        justCompleted: false,
      });
    });
  });

  describe("cleanup", () => {
    it("clears pending timeouts on unmount", () => {
      const { result, unmount } = renderHook(() =>
        useVisualFeedback({
          panels: ["git"],
        }),
      );

      act(() => {
        result.current.setRefreshed("git");
      });
      expect(result.current.states.git.justRefreshed).toBe(true);

      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });
});
