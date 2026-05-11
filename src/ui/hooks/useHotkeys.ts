// src/ui/hooks/useHotkeys.ts
interface UseHotkeysOptions {
  focus: "tree" | "viewer";
  onSwitchFocus: () => void;
  onScrollUp: () => void;
  onScrollDown: () => void;
  onScrollTop: () => void;
  onScrollBottom: () => void;
  onSaveLog: () => void;
  onRefresh: () => void;
  onQuit: () => void;
}

export interface UseHotkeysResult {
  handleInput: (input: string, key: { upArrow: boolean; downArrow: boolean }) => void;
  statusBarItems: string[];
}

export function useHotkeys({
  focus,
  onSwitchFocus,
  onScrollUp,
  onScrollDown,
  onScrollTop,
  onScrollBottom,
  onSaveLog,
  onRefresh,
  onQuit,
}: UseHotkeysOptions): UseHotkeysResult {
  const handleInput = (
    input: string,
    key: { upArrow: boolean; downArrow: boolean },
  ) => {
    if (input === "q") { onQuit(); return; }
    if (input === "\t") { onSwitchFocus(); return; }
    if (input === "r") { onRefresh(); return; }

    if (focus === "viewer") {
      if (key.upArrow || input === "k") { onScrollUp(); return; }
      if (key.downArrow || input === "j") { onScrollDown(); return; }
      if (input === "g") { onScrollTop(); return; }
      if (input === "G") { onScrollBottom(); return; }
      if (input === "s") { onSaveLog(); return; }
    }

    if (focus === "tree") {
      if (key.upArrow || input === "k") { onScrollUp(); return; }
      if (key.downArrow || input === "j") { onScrollDown(); return; }
    }
  };

  const statusBarItems =
    focus === "tree"
      ? ["Tab: viewer", "↑↓: select", "r: refresh", "q: quit"]
      : ["Tab: tree", "↑↓: scroll", "g: top", "G: live", "s: save", "q: quit"];

  return { handleInput, statusBarItems };
}
