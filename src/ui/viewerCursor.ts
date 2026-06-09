/**
 * Adjust the activity-viewer cursor when new activities arrive so
 * the cursor stays anchored to its activity instead of sliding to a
 * different one as the visible window auto-scrolls in LIVE mode.
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
 * - Pure function — App.tsx wires it into a `useEffect` keyed off
 *   the merged activity count, but the math has no React
 *   dependencies and tests run as plain unit tests.
 *
 * Gotcha:
 * - When the cursor's anchored activity would scroll off the top
 *   of the viewport (cursor + delta > viewerRows - 1), we clamp
 *   to `viewerRows - 1` and accept losing content-anchoring for
 *   that activity. The alternative — switching the viewer to
 *   PAUSED automatically — is a bigger behavior change and
 *   belongs in a follow-up if it turns out to be needed.
 */

export interface AdjustViewerCursorArgs {
  prevCursorLine: number;
  prevActivityCount: number;
  newActivityCount: number;
  isLive: boolean;
  viewerRows: number;
}

export function adjustViewerCursorOnNewActivities(
  args: AdjustViewerCursorArgs,
): number {
  const {
    prevCursorLine,
    prevActivityCount,
    newActivityCount,
    isLive,
    viewerRows,
  } = args;

  // Paused: visible window doesn't auto-scroll, so the activity at
  // the cursor's screen row hasn't changed. No adjustment needed.
  if (!isLive) return prevCursorLine;

  // Cursor on the live row — user is tracking the live edge.
  if (prevCursorLine === 0) return 0;

  // Defensive: activity count shrank (filter change, etc.). The
  // filter-change reset elsewhere handles cursor; no-op here.
  if (newActivityCount <= prevActivityCount) return prevCursorLine;

  const delta = newActivityCount - prevActivityCount;
  const maxCursor = Math.max(0, viewerRows - 1);
  return Math.min(prevCursorLine + delta, maxCursor);
}
