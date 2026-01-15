/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHotkeys } from "../../src/ui/hooks/useHotkeys.js";

describe("useHotkeys", () => {
  describe("hotkey generation", () => {
    it("generates hotkey from first character of panel name", () => {
      const onRefreshAll = vi.fn();
      const onQuit = vi.fn();

      const { result } = renderHook(() =>
        useHotkeys({
          manualPanels: [{ name: "tests", label: "run tests", action: vi.fn() }],
          onRefreshAll,
          onQuit,
        })
      );

      const testsHotkey = result.current.hotkeys.find((h) => h.label === "run tests");
      expect(testsHotkey).toBeDefined();
      expect(testsHotkey?.key).toBe("t");
    });

    it("skips reserved keys (r, q)", () => {
      const { result } = renderHook(() =>
        useHotkeys({
          manualPanels: [
            { name: "refresh", label: "refresh panel", action: vi.fn() },
            { name: "query", label: "run query", action: vi.fn() },
          ],
          onRefreshAll: vi.fn(),
          onQuit: vi.fn(),
        })
      );

      // 'r' is reserved, should use 'e' from "refresh"
      const refreshHotkey = result.current.hotkeys.find((h) => h.label === "refresh panel");
      expect(refreshHotkey?.key).toBe("e");

      // 'q' is reserved, should use 'u' from "query"
      const queryHotkey = result.current.hotkeys.find((h) => h.label === "run query");
      expect(queryHotkey?.key).toBe("u");
    });

    it("skips already used keys", () => {
      const { result } = renderHook(() =>
        useHotkeys({
          manualPanels: [
            { name: "tests", label: "run tests", action: vi.fn() },
            { name: "types", label: "check types", action: vi.fn() },
          ],
          onRefreshAll: vi.fn(),
          onQuit: vi.fn(),
        })
      );

      const testsHotkey = result.current.hotkeys.find((h) => h.label === "run tests");
      const typesHotkey = result.current.hotkeys.find((h) => h.label === "check types");

      expect(testsHotkey?.key).toBe("t");
      // 't' already used, should use 'y' from "types"
      expect(typesHotkey?.key).toBe("y");
    });

    it("handles panel with no available characters", () => {
      const { result } = renderHook(() =>
        useHotkeys({
          manualPanels: [
            { name: "rq", label: "reserved only", action: vi.fn() }, // only r and q
          ],
          onRefreshAll: vi.fn(),
          onQuit: vi.fn(),
        })
      );

      // No valid key available, should not create hotkey
      const hotkey = result.current.hotkeys.find((h) => h.label === "reserved only");
      expect(hotkey).toBeUndefined();
    });

    it("includes refresh all hotkey (r)", () => {
      const { result } = renderHook(() =>
        useHotkeys({
          manualPanels: [],
          onRefreshAll: vi.fn(),
          onQuit: vi.fn(),
        })
      );

      const refreshHotkey = result.current.hotkeys.find((h) => h.key === "r");
      expect(refreshHotkey).toBeDefined();
      expect(refreshHotkey?.label).toBe("refresh all");
    });

    it("includes quit hotkey (q)", () => {
      const { result } = renderHook(() =>
        useHotkeys({
          manualPanels: [],
          onRefreshAll: vi.fn(),
          onQuit: vi.fn(),
        })
      );

      const quitHotkey = result.current.hotkeys.find((h) => h.key === "q");
      expect(quitHotkey).toBeDefined();
      expect(quitHotkey?.label).toBe("quit");
    });

    it("orders hotkeys: manual panels first, then r, then q", () => {
      const { result } = renderHook(() =>
        useHotkeys({
          manualPanels: [
            { name: "tests", label: "run tests", action: vi.fn() },
            { name: "build", label: "run build", action: vi.fn() },
          ],
          onRefreshAll: vi.fn(),
          onQuit: vi.fn(),
        })
      );

      const keys = result.current.hotkeys.map((h) => h.key);
      expect(keys).toEqual(["t", "b", "r", "q"]);
    });
  });

  describe("handleInput", () => {
    it("calls panel action when matching key is pressed", () => {
      const testsAction = vi.fn();

      const { result } = renderHook(() =>
        useHotkeys({
          manualPanels: [{ name: "tests", label: "run tests", action: testsAction }],
          onRefreshAll: vi.fn(),
          onQuit: vi.fn(),
        })
      );

      act(() => {
        result.current.handleInput("t");
      });

      expect(testsAction).toHaveBeenCalledTimes(1);
    });

    it("calls onRefreshAll when r is pressed", () => {
      const onRefreshAll = vi.fn();

      const { result } = renderHook(() =>
        useHotkeys({
          manualPanels: [],
          onRefreshAll,
          onQuit: vi.fn(),
        })
      );

      act(() => {
        result.current.handleInput("r");
      });

      expect(onRefreshAll).toHaveBeenCalledTimes(1);
    });

    it("calls onQuit when q is pressed", () => {
      const onQuit = vi.fn();

      const { result } = renderHook(() =>
        useHotkeys({
          manualPanels: [],
          onRefreshAll: vi.fn(),
          onQuit,
        })
      );

      act(() => {
        result.current.handleInput("q");
      });

      expect(onQuit).toHaveBeenCalledTimes(1);
    });

    it("does nothing for unregistered keys", () => {
      const testsAction = vi.fn();
      const onRefreshAll = vi.fn();
      const onQuit = vi.fn();

      const { result } = renderHook(() =>
        useHotkeys({
          manualPanels: [{ name: "tests", label: "run tests", action: testsAction }],
          onRefreshAll,
          onQuit,
        })
      );

      act(() => {
        result.current.handleInput("x");
      });

      expect(testsAction).not.toHaveBeenCalled();
      expect(onRefreshAll).not.toHaveBeenCalled();
      expect(onQuit).not.toHaveBeenCalled();
    });

    it("handles multiple panels correctly", () => {
      const testsAction = vi.fn();
      const buildAction = vi.fn();

      const { result } = renderHook(() =>
        useHotkeys({
          manualPanels: [
            { name: "tests", label: "run tests", action: testsAction },
            { name: "build", label: "run build", action: buildAction },
          ],
          onRefreshAll: vi.fn(),
          onQuit: vi.fn(),
        })
      );

      act(() => {
        result.current.handleInput("b");
      });

      expect(testsAction).not.toHaveBeenCalled();
      expect(buildAction).toHaveBeenCalledTimes(1);
    });
  });

  describe("statusBarItems", () => {
    it("returns formatted status bar items", () => {
      const { result } = renderHook(() =>
        useHotkeys({
          manualPanels: [{ name: "tests", label: "run tests", action: vi.fn() }],
          onRefreshAll: vi.fn(),
          onQuit: vi.fn(),
        })
      );

      expect(result.current.statusBarItems).toEqual([
        "t: run tests",
        "r: refresh all",
        "q: quit",
      ]);
    });

    it("returns only r and q when no manual panels", () => {
      const { result } = renderHook(() =>
        useHotkeys({
          manualPanels: [],
          onRefreshAll: vi.fn(),
          onQuit: vi.fn(),
        })
      );

      expect(result.current.statusBarItems).toEqual(["r: refresh all", "q: quit"]);
    });
  });

  describe("dynamic updates", () => {
    it("updates hotkeys when manualPanels change", () => {
      const action1 = vi.fn();
      const action2 = vi.fn();

      const { result, rerender } = renderHook(
        ({ panels }) =>
          useHotkeys({
            manualPanels: panels,
            onRefreshAll: vi.fn(),
            onQuit: vi.fn(),
          }),
        {
          initialProps: {
            panels: [{ name: "tests", label: "run tests", action: action1 }],
          },
        }
      );

      expect(result.current.hotkeys.find((h) => h.key === "t")).toBeDefined();
      expect(result.current.hotkeys.find((h) => h.key === "b")).toBeUndefined();

      rerender({
        panels: [
          { name: "tests", label: "run tests", action: action1 },
          { name: "build", label: "run build", action: action2 },
        ],
      });

      expect(result.current.hotkeys.find((h) => h.key === "t")).toBeDefined();
      expect(result.current.hotkeys.find((h) => h.key === "b")).toBeDefined();
    });
  });
});
