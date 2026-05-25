interface UseHotkeysOptions {
  focus: "tree" | "viewer";
  detailMode: boolean;
  helpMode: boolean;
  onSwitchFocus: () => void;
  onScrollUp: () => void;
  onScrollDown: () => void;
  onScrollPageUp: () => void;
  onScrollPageDown: () => void;
  onScrollHalfPageUp: () => void;
  onScrollHalfPageDown: () => void;
  onScrollTop: () => void;
  onScrollBottom: () => void;
  onRefresh: () => void;
  onQuit: () => void;
  onEnter: () => void;
  onHide: () => void;
  onDetailClose: () => void;
  onDetailScrollUp: () => void;
  onDetailScrollDown: () => void;
  onFilter: () => void;
  onHelp: () => void;
  onHelpScroll?: (delta: number) => void;
  onHelpScrollToTop?: () => void;
  onToggleTracking?: () => void;
  filterLabel: string; // e.g. "all", "response", "commit"
  trackingOn?: boolean;
}

export interface UseHotkeysResult {
  handleInput: (
    input: string,
    key: {
      upArrow: boolean;
      downArrow: boolean;
      tab: boolean;
      pageUp: boolean;
      pageDown: boolean;
      return: boolean;
      ctrl: boolean;
      escape?: boolean;
    },
  ) => void;
  statusBarItems: string[];
}

export function useHotkeys({
  focus,
  detailMode,
  helpMode,
  onSwitchFocus,
  onScrollUp,
  onScrollDown,
  onScrollPageUp,
  onScrollPageDown,
  onScrollHalfPageUp,
  onScrollHalfPageDown,
  onScrollTop,
  onScrollBottom,
  onRefresh,
  onQuit,
  onEnter,
  onHide,
  onDetailClose,
  onDetailScrollUp,
  onDetailScrollDown,
  onFilter,
  onHelp,
  onHelpScroll,
  onHelpScrollToTop,
  onToggleTracking,
  filterLabel,
  trackingOn = false,
}: UseHotkeysOptions): UseHotkeysResult {
  const handleInput = (
    input: string,
    key: {
      upArrow: boolean;
      downArrow: boolean;
      tab: boolean;
      pageUp: boolean;
      pageDown: boolean;
      return: boolean;
      ctrl: boolean;
      escape?: boolean;
    },
  ) => {
    if (helpMode) {
      if (key.return || key.escape || input === "q" || input === "?") {
        onHelp(); // toggle = close
        return;
      }
      if (onHelpScroll) {
        if (key.downArrow || input === "j" || input === " ") {
          onHelpScroll(1);
          return;
        }
        if (key.upArrow || input === "k") {
          onHelpScroll(-1);
          return;
        }
        if (key.pageDown || (key.ctrl && input === "f")) {
          onHelpScroll(10);
          return;
        }
        if (key.pageUp || (key.ctrl && input === "b")) {
          onHelpScroll(-10);
          return;
        }
        if (input === "G") {
          onHelpScroll(Number.MAX_SAFE_INTEGER);
          return;
        }
      }
      if (input === "g" && onHelpScrollToTop) {
        onHelpScrollToTop();
        return;
      }
      return; // swallow everything else
    }

    if (input === "?") {
      onHelp();
      return;
    }

    if (detailMode) {
      if (key.upArrow || input === "k") {
        onDetailScrollUp();
        return;
      }
      if (key.downArrow || input === "j") {
        onDetailScrollDown();
        return;
      }
      if (key.return || key.escape || input === "q") {
        onDetailClose();
        return;
      }
      return;
    }

    if (input === "q") {
      onQuit();
      return;
    }
    if (key.tab) {
      onSwitchFocus();
      return;
    }
    if (key.return) {
      onEnter();
      return;
    }
    if (input === "r") {
      onRefresh();
      return;
    }
    if (input === "f" && !key.ctrl && focus === "viewer") {
      onFilter();
      return;
    }
    if (input === "t" && !key.ctrl && onToggleTracking) {
      onToggleTracking();
      return;
    }

    if (key.pageUp) {
      onScrollPageUp();
      return;
    }
    if (key.pageDown) {
      onScrollPageDown();
      return;
    }

    if (key.ctrl) {
      if (input === "b") {
        onScrollPageUp();
        return;
      }
      if (input === "f") {
        onScrollPageDown();
        return;
      }
      if (input === "u") {
        onScrollHalfPageUp();
        return;
      }
      if (input === "d") {
        onScrollHalfPageDown();
        return;
      }
    }

    if (focus === "tree") {
      if (input === "h") {
        onHide();
        return;
      }
      if (key.upArrow || input === "k") {
        onScrollUp();
        return;
      }
      if (key.downArrow || input === "j") {
        onScrollDown();
        return;
      }
    }

    if (focus === "viewer") {
      if (key.upArrow || input === "k") {
        onScrollUp();
        return;
      }
      if (key.downArrow || input === "j") {
        onScrollDown();
        return;
      }
      if (input === "g") {
        onScrollTop();
        return;
      }
      if (input === "G") {
        onScrollBottom();
        return;
      }
    }
  };

  // Leading item shown when tracking mode is on, so users can always tell
  // at a glance that selection will move on its own.
  const trackingItems = trackingOn ? ["TRK ●"] : ["t: track"];

  const statusBarItems = helpMode
    ? ["↑↓/jk: scroll", "PgDn/Space: page", "↵/Esc/q/?: close"]
    : detailMode
      ? ["↑↓/jk: scroll", "↵/Esc: close", "?: help"]
      : focus === "tree"
        ? [
            ...trackingItems,
            "Tab: viewer",
            "↑↓/jk: select",
            "PgUp/Dn: page",
            "↵: expand",
            "h: hide",
            "r: refresh",
            "?: help",
            "q: quit",
          ]
        : [
            ...trackingItems,
            "Tab: projects",
            "↑↓/jk: scroll",
            "PgUp/Dn: page",
            "g: oldest",
            "G: live",
            "↵: detail",
            `f: ${filterLabel}`,
            "?: help",
            "q: quit",
          ];

  return { handleInput, statusBarItems };
}
