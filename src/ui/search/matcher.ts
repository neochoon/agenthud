/**
 * Substring matching with smart-case for the in-pane search. Returns
 * highlight ranges so callers can render matches; never fuzzy, never
 * regex — the query is matched literally.
 */

export interface MatchRange {
  start: number; // inclusive
  end: number; // exclusive (half-open)
}

/** Smart-case: case-sensitive iff the query contains an uppercase letter. */
export function isCaseSensitive(query: string): boolean {
  return /[A-Z]/.test(query);
}

/** All non-overlapping match ranges of `query` in `text`, left to right.
 * Empty when the query is empty or there is no match. */
export function matchRanges(text: string, query: string): MatchRange[] {
  if (!query) return [];
  const cs = isCaseSensitive(query);
  const hay = cs ? text : text.toLowerCase();
  const needle = cs ? query : query.toLowerCase();
  const out: MatchRange[] = [];
  let i = hay.indexOf(needle);
  while (i !== -1) {
    out.push({ start: i, end: i + needle.length });
    i = hay.indexOf(needle, i + needle.length); // non-overlapping
  }
  return out;
}

/** Whether `query` occurs in `text` (smart-case). False for an empty query. */
export function hasMatch(text: string, query: string): boolean {
  if (!query) return false;
  const cs = isCaseSensitive(query);
  return (cs ? text : text.toLowerCase()).includes(
    cs ? query : query.toLowerCase(),
  );
}
