// src/ui/hooks/useHotkeys.ts
interface UseHotkeysOptions {
  focus: "tree" | "viewer";
  onSwitchFocus: () => void;
  onScrollUp: () => void;
  onScrollDown: () => void;
  onScrollPageUp: () => void;
  onScrollPageDown: () => void;
  onScrollTop: () => void;
  onScrollBottom: () => void;
  onSaveLog: () => void;
  onRefresh: () => void;
  onQuit: () => void;
  onEnter: () => void;
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
    },
  ) => void;
  statusBarItems: string[];
}

export function useHotkeys({
  focus,
  onSwitchFocus,
  onScrollUp,
  onScrollDown,
  onScrollPageUp,
  onScrollPageDown,
  onScrollTop,
  onScrollBottom,
  onSaveLog,
  onRefresh,
  onQuit,
  onEnter,
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
    },
  ) => {
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

    if (key.pageUp) {
      onScrollPageUp();
      return;
    }
    if (key.pageDown) {
      onScrollPageDown();
      return;
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

    if (focus === "tree") {
      if (key.upArrow || input === "k") {
        onScrollUp();
        return;
      }
      if (key.downArrow || input === "j") {
        onScrollDown();
        return;
      }
    }
  };

  const statusBarItems =
    focus === "tree"
      ? [
          "Tab: viewer",
          "↑↓/jk: select",
          "PgUp/Dn: page",
          "↵: expand",
          "r: refresh",
          "q: quit",
        ]
      : [
          "Tab: tree",
          "↑↓/jk: scroll",
          "PgUp/Dn: page",
          "g: top",
          "G: live",
          "s: save",
          "q: quit",
        ];

  return { handleInput, statusBarItems };
}
