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
  onSaveLog: () => void;
  onRefresh: () => void;
  onQuit: () => void;
  onEnter: () => void;
  onHide: () => void;
  onDetailClose: () => void;
  onDetailScrollUp: () => void;
  onDetailScrollDown: () => void;
  onFilter: () => void;
  onHelp: () => void;
  filterLabel: string; // e.g. "all", "response", "commit"
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
  onSaveLog,
  onRefresh,
  onQuit,
  onEnter,
  onHide,
  onDetailClose,
  onDetailScrollUp,
  onDetailScrollDown,
  onFilter,
  onHelp,
  filterLabel,
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
      if (input === "s") {
        onSaveLog();
        return;
      }
    }
  };

  const statusBarItems = helpMode
    ? ["↵/Esc/q/?: close"]
    : detailMode
      ? ["↑↓/jk: scroll", "↵/Esc: close", "?: help"]
      : focus === "tree"
        ? [
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
            "Tab: sessions",
            "↑↓/jk: scroll",
            "PgUp/Dn: page",
            "g: live",
            "G: oldest",
            "↵: detail",
            `f: ${filterLabel}`,
            "?: help",
            "q: quit",
          ];

  return { handleInput, statusBarItems };
}
