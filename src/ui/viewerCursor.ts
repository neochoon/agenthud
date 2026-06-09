/**
 * Decide how the activity-viewer cursor should move when new
 * activities arrive in LIVE mode, so the cursor stays anchored to
 * its activity rather than sliding to a different one as the
 * visible window auto-scrolls.
 *
 * Design decisions:
 * - `viewerCursorLine` counts rows from the LIVE EDGE (the bottom
 *   of the tail-feed). cursor = 0 means "on the live row";
 *   cursor = viewerRows - 1 means "at the top of the visible
 *   window" (oldest visible). Counting from the bottom keeps the
 *   live-edge case clean: cursor = 0 always means "follow live".
 * - cursorLine === 0 is treated as "user wants to track live" —
 *   not as a content anchor. The user hasn't moved off the live
 *   row, so leave it on the live row.
 * - When the cursor's anchored activity would scroll off the top
 *   of the viewport, the result switches the viewer to PAUSED.
 *   This freezes the view at its current snapshot (cursor stays
 *   on the top row showing the same activity, no further auto-
 *   scrolling, new entries accumulate as the `+N↓` badge). The
 *   alternative (clamp cursor + stay LIVE) makes the cursor's
 *   activity silently slide forward each new entry — exactly the
 *   bug we're fixing.
 * - Pure function returning a result shape. App.tsx wires it into
 *   a `useEffect` and applies the result to setViewerCursorLine /
 *   setIsLive / setScrollOffset / setNewCount. Tests run as plain
 *   unit tests with no React surface.
 */

export interface AdjustViewerCursorArgs {
  prevCursorLine: number;
  prevActivityCount: number;
  newActivityCount: number;
  isLive: boolean;
  viewerRows: number;
}

export interface AdjustViewerCursorResult {
  /** New cursor row (counted from the live edge). */
  cursorLine: number;
  /** True when the result transitions LIVE → PAUSED. */
  autoPause: boolean;
  /**
   * On auto-pause, the number of new entries that became
   * "scrolled past" the viewport — caller should add this to both
   * `scrollOffset` and `newCount` so the badge reflects them.
   * Always 0 when `autoPause` is false.
   */
  scrollDelta: number;
}

export function adjustViewerCursorOnNewActivities(
  args: AdjustViewerCursorArgs,
): AdjustViewerCursorResult {
  const {
    prevCursorLine,
    prevActivityCount,
    newActivityCount,
    isLive,
    viewerRows,
  } = args;

  const noOp: AdjustViewerCursorResult = {
    cursorLine: prevCursorLine,
    autoPause: false,
    scrollDelta: 0,
  };

  // Paused: visible window doesn't auto-scroll, so the activity at
  // the cursor's screen row hasn't changed. No adjustment needed.
  if (!isLive) return noOp;

  // Cursor on the live row — user is tracking the live edge.
  if (prevCursorLine === 0)
    return { cursorLine: 0, autoPause: false, scrollDelta: 0 };

  // Defensive: activity count shrank (filter change, etc.). The
  // filter-change reset elsewhere handles cursor; no-op here.
  if (newActivityCount <= prevActivityCount) return noOp;

  const delta = newActivityCount - prevActivityCount;
  const maxCursor = Math.max(0, viewerRows - 1);
  const upwardRoom = maxCursor - prevCursorLine;

  if (delta <= upwardRoom) {
    // Fits: move cursor up by delta so it stays on the same activity.
    return {
      cursorLine: prevCursorLine + delta,
      autoPause: false,
      scrollDelta: 0,
    };
  }

  // Overflow: consume `upwardRoom` of the delta lifting the cursor
  // to the top of the viewport, then transition to PAUSED. The
  // remaining (delta - upwardRoom) entries become the scroll offset
  // so the view freezes on the same snapshot it was showing before.
  return {
    cursorLine: maxCursor,
    autoPause: true,
    scrollDelta: delta - upwardRoom,
  };
}
