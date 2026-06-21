/**
 * Pure helper for fzf-style edge-scrolling of a search hit window.
 *
 * Design decisions:
 * - Stateless pure function: all callers must persist `prevStart` themselves
 *   (via React state or ref) so the window moves smoothly rather than
 *   re-anchoring on every keystroke.
 * - Edge-only scroll: the window only moves when `selected` crosses the
 *   top or bottom boundary; it is otherwise stable regardless of which hit
 *   inside the window is active.
 */

/**
 * Compute the next window-start position using edge-scroll semantics.
 *
 * - Selection moves freely within `[prevStart, prevStart + visibleRows)`.
 * - If `selected < prevStart` → scroll up so the selected hit is the first
 *   visible row (newStart = selected).
 * - If `selected >= prevStart + visibleRows` → scroll down so the selected
 *   hit is the last visible row (newStart = selected - visibleRows + 1).
 * - Otherwise keep prevStart unchanged.
 * - Result is always clamped to `[0, max(0, total - visibleRows)]`.
 * - When `total <= visibleRows` the result is always 0.
 */
export function edgeScrollWindowStart(
  prevStart: number,
  selected: number,
  visibleRows: number,
  total: number,
): number {
  if (total <= 0 || visibleRows <= 0) return 0;
  if (total <= visibleRows) return 0;

  const maxStart = total - visibleRows;
  // Clamp prevStart defensively (caller may pass an out-of-range value).
  const clampedPrev = Math.max(0, Math.min(prevStart, maxStart));

  let newStart: number;
  if (selected < clampedPrev) {
    // Selected crossed the top edge → bring it into view as the first row.
    newStart = selected;
  } else if (selected >= clampedPrev + visibleRows) {
    // Selected crossed the bottom edge → bring it into view as the last row.
    newStart = selected - visibleRows + 1;
  } else {
    // Selection is within the current window → keep it stable.
    newStart = clampedPrev;
  }

  return Math.max(0, Math.min(newStart, maxStart));
}
