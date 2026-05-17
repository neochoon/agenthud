/**
 * @vitest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHotkeys } from "../../../src/ui/hooks/useHotkeys.js";

const noopKey = {
  upArrow: false,
  downArrow: false,
  tab: false,
  pageUp: false,
  pageDown: false,
  return: false,
  ctrl: false,
};
const upKey = {
  upArrow: true,
  downArrow: false,
  tab: false,
  pageUp: false,
  pageDown: false,
  return: false,
};
const downKey = {
  upArrow: false,
  downArrow: true,
  tab: false,
  pageUp: false,
  pageDown: false,
};
const tabKey = {
  upArrow: false,
  downArrow: false,
  tab: true,
  pageUp: false,
  pageDown: false,
  return: false,
};
const pageUpKey = {
  upArrow: false,
  downArrow: false,
  tab: false,
  pageUp: true,
  pageDown: false,
  return: false,
};
const pageDownKey = {
  upArrow: false,
  downArrow: false,
  tab: false,
  pageUp: false,
  pageDown: true,
  return: false,
};
const returnKey = {
  upArrow: false,
  downArrow: false,
  tab: false,
  pageUp: false,
  pageDown: false,
  return: true,
};

function makeOptions(overrides = {}) {
  return {
    focus: "tree" as const,
    detailMode: false,
    helpMode: false,
    onSwitchFocus: vi.fn(),
    onScrollUp: vi.fn(),
    onScrollDown: vi.fn(),
    onScrollPageUp: vi.fn(),
    onScrollPageDown: vi.fn(),
    onScrollHalfPageUp: vi.fn(),
    onScrollHalfPageDown: vi.fn(),
    onScrollTop: vi.fn(),
    onScrollBottom: vi.fn(),
    onSaveLog: vi.fn(),
    onRefresh: vi.fn(),
    onQuit: vi.fn(),
    onEnter: vi.fn(),
    onHide: vi.fn(),
    onDetailClose: vi.fn(),
    onDetailScrollUp: vi.fn(),
    onDetailScrollDown: vi.fn(),
    onFilter: vi.fn(),
    onHelp: vi.fn(),
    filterLabel: "all",
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

    it("calls onScrollPageUp when PageUp is pressed (tree focus)", () => {
      const onScrollPageUp = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "tree", onScrollPageUp })),
      );
      act(() => result.current.handleInput("", pageUpKey));
      expect(onScrollPageUp).toHaveBeenCalledTimes(1);
    });

    it("calls onScrollPageDown when PageDown is pressed (tree focus)", () => {
      const onScrollPageDown = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "tree", onScrollPageDown })),
      );
      act(() => result.current.handleInput("", pageDownKey));
      expect(onScrollPageDown).toHaveBeenCalledTimes(1);
    });

    it("calls onScrollPageUp when PageUp is pressed (viewer focus)", () => {
      const onScrollPageUp = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "viewer", onScrollPageUp })),
      );
      act(() => result.current.handleInput("", pageUpKey));
      expect(onScrollPageUp).toHaveBeenCalledTimes(1);
    });

    it("calls onScrollPageDown when PageDown is pressed (viewer focus)", () => {
      const onScrollPageDown = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "viewer", onScrollPageDown })),
      );
      act(() => result.current.handleInput("", pageDownKey));
      expect(onScrollPageDown).toHaveBeenCalledTimes(1);
    });

    it("calls onEnter when Enter is pressed (tree focus)", () => {
      const onEnter = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "tree", onEnter })),
      );
      act(() => result.current.handleInput("", returnKey));
      expect(onEnter).toHaveBeenCalledTimes(1);
    });

    it("calls onEnter when Enter is pressed (viewer focus)", () => {
      const onEnter = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "viewer", onEnter })),
      );
      act(() => result.current.handleInput("", returnKey));
      expect(onEnter).toHaveBeenCalledTimes(1);
    });

    it("calls onHide when h is pressed in tree focus", () => {
      const onHide = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "tree", onHide })),
      );
      act(() => result.current.handleInput("h", noopKey));
      expect(onHide).toHaveBeenCalledTimes(1);
    });

    it("does not call onHide when h is pressed in viewer focus", () => {
      const onHide = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "viewer", onHide })),
      );
      act(() => result.current.handleInput("h", noopKey));
      expect(onHide).not.toHaveBeenCalled();
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

  describe("ctrl key aliases", () => {
    it("calls onScrollPageUp when Ctrl+B is pressed", () => {
      const onScrollPageUp = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ onScrollPageUp })),
      );
      act(() => result.current.handleInput("b", { ...noopKey, ctrl: true }));
      expect(onScrollPageUp).toHaveBeenCalledTimes(1);
    });

    it("calls onScrollPageDown when Ctrl+F is pressed", () => {
      const onScrollPageDown = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ onScrollPageDown })),
      );
      act(() => result.current.handleInput("f", { ...noopKey, ctrl: true }));
      expect(onScrollPageDown).toHaveBeenCalledTimes(1);
    });

    it("calls onScrollHalfPageUp when Ctrl+U is pressed", () => {
      const onScrollHalfPageUp = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ onScrollHalfPageUp })),
      );
      act(() => result.current.handleInput("u", { ...noopKey, ctrl: true }));
      expect(onScrollHalfPageUp).toHaveBeenCalledTimes(1);
    });

    it("calls onScrollHalfPageDown when Ctrl+D is pressed", () => {
      const onScrollHalfPageDown = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ onScrollHalfPageDown })),
      );
      act(() => result.current.handleInput("d", { ...noopKey, ctrl: true }));
      expect(onScrollHalfPageDown).toHaveBeenCalledTimes(1);
    });
  });

  describe("statusBarItems", () => {
    it("returns tree-focus status bar items when focus is tree", () => {
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "tree" })),
      );
      expect(result.current.statusBarItems).toEqual([
        "Tab: viewer",
        "↑↓/jk: select",
        "PgUp/Dn: page",
        "↵: expand",
        "h: hide",
        "r: refresh",
        "?: help",
        "q: quit",
      ]);
    });

    it("returns viewer-focus status bar items when focus is viewer", () => {
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ focus: "viewer" })),
      );
      expect(result.current.statusBarItems).toEqual([
        "Tab: sessions",
        "↑↓/jk: scroll",
        "PgUp/Dn: page",
        "g: live",
        "G: oldest",
        "↵: detail",
        "f: all",
        "?: help",
        "q: quit",
      ]);
    });

    it("returns detail mode status bar items when detailMode is true", () => {
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ detailMode: true })),
      );
      expect(result.current.statusBarItems).toEqual([
        "↑↓/jk: scroll",
        "↵/Esc: close",
        "?: help",
      ]);
    });

    it("returns minimal status bar when helpMode is true", () => {
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ helpMode: true })),
      );
      expect(result.current.statusBarItems).toEqual(["↵/Esc/q/?: close"]);
    });
  });

  describe("help mode", () => {
    it("calls onHelp when ? pressed", () => {
      const onHelp = vi.fn();
      const { result } = renderHook(() => useHotkeys(makeOptions({ onHelp })));
      act(() => result.current.handleInput("?", noopKey));
      expect(onHelp).toHaveBeenCalledTimes(1);
    });

    it("toggles help off when ? pressed while help is open", () => {
      const onHelp = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ helpMode: true, onHelp })),
      );
      act(() => result.current.handleInput("?", noopKey));
      expect(onHelp).toHaveBeenCalledTimes(1);
    });

    it("closes help on Esc", () => {
      const onHelp = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ helpMode: true, onHelp })),
      );
      act(() => result.current.handleInput("", { ...noopKey, escape: true }));
      expect(onHelp).toHaveBeenCalledTimes(1);
    });

    it("closes help on Enter", () => {
      const onHelp = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ helpMode: true, onHelp })),
      );
      act(() => result.current.handleInput("", returnKey));
      expect(onHelp).toHaveBeenCalledTimes(1);
    });

    it("closes help on q", () => {
      const onHelp = vi.fn();
      const onQuit = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ helpMode: true, onHelp, onQuit })),
      );
      act(() => result.current.handleInput("q", noopKey));
      expect(onHelp).toHaveBeenCalledTimes(1);
      expect(onQuit).not.toHaveBeenCalled();
    });

    it("swallows other keys when help is open", () => {
      const onScrollUp = vi.fn();
      const onHelp = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ helpMode: true, onScrollUp, onHelp })),
      );
      act(() => result.current.handleInput("", { ...noopKey, upArrow: true }));
      expect(onScrollUp).not.toHaveBeenCalled();
      expect(onHelp).not.toHaveBeenCalled();
    });

    it("opens help even from detail mode (? in detailMode)", () => {
      const onHelp = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ detailMode: true, onHelp })),
      );
      act(() => result.current.handleInput("?", noopKey));
      expect(onHelp).toHaveBeenCalledTimes(1);
    });
  });

  describe("detail mode", () => {
    const escKey = { ...noopKey, escape: true };

    it("calls onDetailScrollUp when upArrow pressed in detail mode", () => {
      const onDetailScrollUp = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ detailMode: true, onDetailScrollUp })),
      );
      act(() => result.current.handleInput("", { ...noopKey, upArrow: true }));
      expect(onDetailScrollUp).toHaveBeenCalledTimes(1);
    });

    it("calls onDetailScrollDown when downArrow pressed in detail mode", () => {
      const onDetailScrollDown = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ detailMode: true, onDetailScrollDown })),
      );
      act(() =>
        result.current.handleInput("", { ...noopKey, downArrow: true }),
      );
      expect(onDetailScrollDown).toHaveBeenCalledTimes(1);
    });

    it("calls onDetailClose when Enter pressed in detail mode", () => {
      const onDetailClose = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ detailMode: true, onDetailClose })),
      );
      act(() => result.current.handleInput("", returnKey));
      expect(onDetailClose).toHaveBeenCalledTimes(1);
    });

    it("calls onDetailClose when Esc pressed in detail mode", () => {
      const onDetailClose = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ detailMode: true, onDetailClose })),
      );
      act(() => result.current.handleInput("", escKey));
      expect(onDetailClose).toHaveBeenCalledTimes(1);
    });

    it("calls onDetailClose when q pressed in detail mode (not onQuit)", () => {
      const onDetailClose = vi.fn();
      const onQuit = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ detailMode: true, onDetailClose, onQuit })),
      );
      act(() => result.current.handleInput("q", noopKey));
      expect(onDetailClose).toHaveBeenCalledTimes(1);
      expect(onQuit).not.toHaveBeenCalled();
    });

    it("does not call onQuit when q pressed in detail mode", () => {
      const onQuit = vi.fn();
      const { result } = renderHook(() =>
        useHotkeys(makeOptions({ detailMode: true, onQuit })),
      );
      act(() => result.current.handleInput("q", noopKey));
      expect(onQuit).not.toHaveBeenCalled();
    });
  });
});
