/**
 * Single-source-of-truth Ink keyboard dispatcher. Receives a giant
 * options bag of `onXxx` callbacks from `App.tsx` and routes the
 * current keystroke to the right callback based on focus (`tree`
 * vs `viewer`) and mode (help overlay open, detail overlay open).
 *
 * Design decisions:
 * - Modes are exclusive and short-circuit: help > detail > main.
 *   The input handler returns early after the first mode handles
 *   the key. Otherwise typing `j` in the help overlay would also
 *   scroll the tree underneath.
 * - Vim keys (`j/k/g/G/Ctrl+B/F/U/D`) and arrow keys are both
 *   accepted in parallel — users come from both terminal cultures
 *   and having either work removes friction.
 *
 * Gotcha:
 * - The plain `f` (filter cycle) handler MUST guard `!key.ctrl`.
 *   Otherwise Ctrl+F (page-down) ALSO fires the filter cycle on
 *   the same keystroke. Same for `b`/`u`/`d` vs their Ctrl
 *   variants — vim's leader-style keys overlap with control
 *   codes if the modifier isn't excluded.
 */

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
  onDetailScrollHalfPageUp: () => void;
  onDetailScrollHalfPageDown: () => void;
  onFilter: () => void;
  onHelp: () => void;
  onHelpScroll?: (delta: number) => void;
  onHelpScrollToTop?: () => void;
  onToggleTracking?: () => void;
  /** Tree only: jump to the parent of the current row (sub-agent →
   * session, session → project, project → previous row). */
  onJumpToParent?: () => void;
  /** Tree only: toggle whether hidden items appear in the tree. */
  onToggleShowHidden?: () => void;
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
      leftArrow?: boolean;
      rightArrow?: boolean;
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
  onDetailScrollHalfPageUp,
  onDetailScrollHalfPageDown,
  onFilter,
  onHelp,
  onHelpScroll,
  onHelpScrollToTop,
  onToggleTracking,
  onJumpToParent,
  onToggleShowHidden,
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
      leftArrow?: boolean;
      rightArrow?: boolean;
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
      if (key.ctrl && input === "u") {
        onDetailScrollHalfPageUp();
        return;
      }
      if (key.ctrl && input === "d") {
        onDetailScrollHalfPageDown();
        return;
      }
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
      // `H` (Shift+H) is hide — uppercase keeps the mutation behind a
      // deliberate keystroke. Lowercase `h` is vim-left (jump to
      // parent), aliased to `←`. Old behavior (`h` = hide) was a
      // footgun: users coming from vim hit `h` for navigation and
      // accidentally hid sessions they were actively monitoring.
      // `a` toggles whether hidden items show in the tree.
      if (input === "H") {
        onHide();
        return;
      }
      if (input === "a" && onToggleShowHidden) {
        onToggleShowHidden();
        return;
      }
      if ((input === "h" || key.leftArrow) && onJumpToParent) {
        onJumpToParent();
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
      ? ["↑↓/jk: scroll", "C-u/d: ½page", "↵/Esc: close", "?: help"]
      : focus === "tree"
        ? [
            ...trackingItems,
            "Tab: viewer",
            "↑↓/jk: select",
            "←: parent",
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
