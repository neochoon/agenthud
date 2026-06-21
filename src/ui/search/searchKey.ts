/**
 * Pure reducer for detail-surface search key transitions (less-style two-phase model).
 *
 * Design decisions:
 * - While uncommitted (typing), every printable character (including n/N) appends
 *   to the query and jumps to index 0 (first match). This unblocks queries containing
 *   common identifiers like "function", "const", "return", "import".
 * - Enter commits: subsequent n/N navigate forward/backward through matches.
 * - Any printable char or backspace after commit re-enters the typing phase
 *   (uncommitted=true, index=0), so editing mid-navigation is natural.
 * - Esc returns null — the signal to close search entirely.
 * - Ctrl combos are ignored so terminal shortcuts pass through untouched.
 */

export type SearchSurface = "tree" | "viewer" | "detail";

export interface SearchState {
  surface: SearchSurface;
  query: string;
  index: number; // current match index (detail: line-match #; lists: selected match row)
  committed: boolean; // true after Enter; false while typing
}

export interface SearchKey {
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  escape?: boolean;
}

/**
 * Compute the next SearchState for a single keystroke in detail search.
 * Returns `null` to signal "exit search" (Esc).
 * Returns the current state unchanged when the key is irrelevant (e.g. ctrl-chord).
 */
export function applyDetailSearchKey(
  state: SearchState,
  input: string,
  key: SearchKey,
): SearchState | null {
  // Esc always exits search.
  if (key.escape) return null;

  // Backspace / delete: remove last character, return to uncommitted.
  // Reset index to 0 so the display jumps to the first match in the
  // shorter query — the old index is stale after a character is removed.
  if (key.backspace || key.delete) {
    return {
      ...state,
      query: state.query.slice(0, -1),
      committed: false,
      index: 0,
    };
  }

  // Enter: commit if not yet committed; no-op if already committed.
  if (key.return) {
    if (state.committed) return state;
    return { ...state, committed: true };
  }

  // Ignore ctrl combos and non-printable / empty input.
  if (!input || key.ctrl || input.length !== 1) return state;

  // Committed phase: n/N navigate; any other printable char re-enters typing.
  if (state.committed) {
    if (input === "n") return { ...state, index: state.index + 1 };
    if (input === "N") return { ...state, index: state.index - 1 };
    // Any other char appends and un-commits.
    return { ...state, query: state.query + input, committed: false, index: 0 };
  }

  // Uncommitted phase: all printable chars (incl. n/N) append to query.
  return { ...state, query: state.query + input, index: 0 };
}
