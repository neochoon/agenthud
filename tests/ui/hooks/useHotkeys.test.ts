/**
 * @vitest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHotkeys } from "../../../src/ui/hooks/useHotkeys.js";

const noopKey = { upArrow: false, downArrow: false, tab: false };
const upKey = { upArrow: true, downArrow: false, tab: false };
const downKey = { upArrow: false, downArrow: true, tab: false };
const tabKey = { upArrow: false, downArrow: false, tab: true };

function makeOptions(overrides = {}) {
  return {
    focus: "tree" as const,
    onSwitchFocus: vi.fn(),
    onScrollUp: vi.fn(),
    onScrollDown: vi.fn(),
    onScrollTop: vi.fn(),
    onScrollBottom: vi.fn(),
    onSaveLog: vi.fn(),
    onRefresh: vi.fn(),
    onQuit: vi.fn(),
    ...overrides,
  };
}

describe("useHotkeys", () => {
  describe("global keys (work regardless of focus)", () => {
    it("calls onQuit when q is pressed", () => {
      const onQuit = vi.fn();
      const { result } = renderHook(() => useHotkeys(makeOptions({ onQuit })));
      act(() => result.current.handleInput("q", noopKey));
      expect(onQuit).toHaveBeenCalledTimes(1);
    });

    it("calls onSwitchFocus when Tab is pressed", () => {
      const onSwitchFocus = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ onSwitchFocus })),
      );
      act(() => result.current.handleInput("", tabKey));
      expect(onSwitchFocus).toHaveBeenCalledTimes(1);
    });

    it("calls onRefresh when r is pressed", () => {
      const onRefresh = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ onRefresh })),
      );
      act(() => result.current.handleInput("r", noopKey));
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("tree focus", () => {
    it("calls onScrollUp when upArrow is pressed", () => {
      const onScrollUp = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "tree", onScrollUp })),
      );
      act(() => result.current.handleInput("", upKey));
      expect(onScrollUp).toHaveBeenCalledTimes(1);
    });

    it("calls onScrollUp when k is pressed", () => {
      const onScrollUp = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "tree", onScrollUp })),
      );
      act(() => result.current.handleInput("k", noopKey));
      expect(onScrollUp).toHaveBeenCalledTimes(1);
    });

    it("calls onScrollDown when downArrow is pressed", () => {
      const onScrollDown = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "tree", onScrollDown })),
      );
      act(() => result.current.handleInput("", downKey));
      expect(onScrollDown).toHaveBeenCalledTimes(1);
    });

    it("calls onScrollDown when j is pressed", () => {
      const onScrollDown = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "tree", onScrollDown })),
      );
      act(() => result.current.handleInput("j", noopKey));
      expect(onScrollDown).toHaveBeenCalledTimes(1);
    });

    it("does not call onSaveLog when s is pressed in tree focus", () => {
      const onSaveLog = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "tree", onSaveLog })),
      );
      act(() => result.current.handleInput("s", noopKey));
      expect(onSaveLog).not.toHaveBeenCalled();
    });
  });

  describe("viewer focus", () => {
    it("calls onScrollUp when upArrow is pressed", () => {
      const onScrollUp = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "viewer", onScrollUp })),
      );
      act(() => result.current.handleInput("", upKey));
      expect(onScrollUp).toHaveBeenCalledTimes(1);
    });

    it("calls onScrollDown when j is pressed", () => {
      const onScrollDown = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "viewer", onScrollDown })),
      );
      act(() => result.current.handleInput("j", noopKey));
      expect(onScrollDown).toHaveBeenCalledTimes(1);
    });

    it("calls onScrollTop when g is pressed", () => {
      const onScrollTop = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "viewer", onScrollTop })),
      );
      act(() => result.current.handleInput("g", noopKey));
      expect(onScrollTop).toHaveBeenCalledTimes(1);
    });

    it("calls onScrollBottom when G is pressed", () => {
      const onScrollBottom = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "viewer", onScrollBottom })),
      );
      act(() => result.current.handleInput("G", noopKey));
      expect(onScrollBottom).toHaveBeenCalledTimes(1);
    });

    it("calls onSaveLog when s is pressed", () => {
      const onSaveLog = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "viewer", onSaveLog })),
      );
      act(() => result.current.handleInput("s", noopKey));
      expect(onSaveLog).toHaveBeenCalledTimes(1);
    });
  });

  describe("statusBarItems", () => {
    it("returns tree-focus status bar items when focus is tree", () => {
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "tree" })),
      );
      expect(result.current.statusBarItems).toEqual([
        "Tab: viewer",
        "↑↓: select",
        "r: refresh",
        "q: quit",
      ]);
    });

    it("returns viewer-focus status bar items when focus is viewer", () => {
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "viewer" })),
      );
      expect(result.current.statusBarItems).toEqual([
        "Tab: tree",
        "↑↓: scroll",
        "g: top",
        "G: live",
        "s: save",
        "q: quit",
      ]);
    });
  });
});
