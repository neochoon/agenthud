# Search state persistence — design

> Issue: #210 · Branch: `feat/210-search-persistence`
>
> Amends the list-search interaction defined in
> [`2026-06-21-search-design.md`](2026-06-21-search-design.md): lists are no
> longer a *transient* finder that closes on Enter. Search becomes a
> **persistent state** that survives Enter and Viewer↔Detail round-trips.

## Context

AgentHUD has in-pane text search (`/`) on three surfaces:

- **Session Tree** (top): projects → sessions → sub-agents.
- **Activity Viewer** (bottom): the selected session's activity stream.
- **Detail View** (overlay): one activity's full body.

Today, search is a single state object
`search = { surface, query, index, committed } | null`, but the three surfaces
behave inconsistently on Enter:

| Surface | Enter (current) |
|---|---|
| Tree | select node + **close search** (`setSearch(null)`) |
| Viewer | open matched row's Detail + **close search** (`setSearch(null)`) |
| Detail | commit (`committed=true`); search **persists**, `n`/`N` navigate |

Both Tree and Viewer already **narrow to matches** while typing
(`filterTreeBySearch` / hit-windowing in `ActivityViewerPanel`). The problem is
purely that Enter tears the search down, and that opening a Detail from a Viewer
search discards the Viewer search entirely — so returning (Esc) lands in a
viewer with no search and no matched-row context.

## Goals

1. Enter no longer closes search on any surface.
2. Enter's meaning on Tree/Viewer depends on whether the user navigated the
   selection with ↑/↓ during the search session.
3. Esc peels exactly one layer (it is not a blanket "kill all search").
4. A Viewer search survives a Viewer → Detail → back round-trip, including the
   matched-row cursor; the Detail's own body search is independent.

Out of scope: cross-session/global search; changing the matching algorithm
(substring + smart-case stays); the Detail two-phase model (kept as-is).

## State model

Extend `SearchState`:

```ts
interface SearchState {
  surface: "tree" | "viewer" | "detail";
  query: string;
  index: number;
  committed: boolean;  // existing
  navigated: boolean;  // NEW: has the user moved the selection with ↑/↓?
}
```

`navigated` lifecycle:

- `false` when search opens (`/`).
- `false` after any query edit (printable char append, Backspace/Delete) —
  editing the query resets the selection to the first match.
- `true` when ↑/↓ (Viewer/Tree) is pressed to move the selection.

Add a **saved-search slot** for the Viewer↔Detail round-trip:

```ts
savedSearch: {
  search: SearchState;        // the Viewer search snapshot
  cursorLine: number;         // viewerCursorLine
  scrollOffset: number;       // scrollOffset
} | null
```

`savedSearch` is set when a Detail is opened **from an active Viewer search**,
and consumed (restored, then cleared) when that Detail is closed.

## Behavior

### Enter — Tree / Viewer

| `navigated` | Behavior |
|---|---|
| `false` (typed, no arrow) | **Filter-confirm**: keep only matched results visible, keep search open, set `committed = true`. No row action. |
| `true` (↑/↓ to a row) | **Row action**, then keep search alive: Viewer → open that row's Detail (and snapshot the Viewer search into `savedSearch`); Tree → select/expand that node. |

Notes:

- Because both lists already narrow while typing, filter-confirm is mostly a
  *state* change (search stays open, search bar switches to its committed
  indicator). The visible row set does not change at the moment of Enter.
- After filter-confirm, pressing Enter again with `navigated` still `false` is a
  no-op; the user moves with ↑/↓ (which sets `navigated = true`) to act on a row.

### Enter — Detail

Unchanged from the existing two-phase model: type → Enter commits → `n`/`N`
navigate. Detail has no row action, so the `navigated` rule does not apply.

### Esc — layered pop (innermost active layer only)

| Situation | Esc does |
|---|---|
| Detail open **and** Detail's own search active | Reset only the Detail search (stay in Detail). `savedSearch` (the Viewer search) is untouched. |
| Detail open **and** no Detail search | Close Detail → return to Viewer; **restore** `savedSearch` (Viewer search + matched-row cursor/scroll), then clear `savedSearch`. |
| No Detail **and** Viewer/Tree search active | End that search; restore the full (un-narrowed) view. This is the sole exit from search. |
| Nothing active | No-op. |

### Viewer ↔ Detail round-trip (the headline case)

1. Viewer search, user ↑/↓ to a matched row, presses Enter.
2. Snapshot the Viewer search → `savedSearch`; open the row's Detail.
3. (Optional) In Detail, `/` runs an **independent** body-text search; `n`/`N`
   navigate; Esc resets it — `savedSearch` is not affected.
4. Esc out of Detail (no Detail search) → restore `savedSearch`: the Viewer is
   in its prior search state with the cursor on the originally matched row.
5. A further Esc in the Viewer ends the search (full view).

If a Detail is opened **without** an active Viewer search (a normal row Enter,
no search), `savedSearch` stays `null` and Esc simply closes the Detail.

## Components affected

- `src/ui/search/searchKey.ts` — add `navigated` to `SearchState`; the Detail
  reducer is unchanged. (Tree/Viewer keys are handled imperatively in `App.tsx`,
  not by this reducer.)
- `src/ui/App.tsx` —
  - `onOpenSearch`: initialize `navigated: false`.
  - Viewer/Tree search key handlers: set `navigated` on ↑/↓; reset on query
    edit; rewrite Enter to branch on `navigated`; **stop calling
    `setSearch(null)` on Enter**.
  - `openActivityDetail` (or the Viewer Enter path): when invoked from an active
    Viewer search, populate `savedSearch`.
  - `onDetailClose`: when `savedSearch` is present and the Detail had no active
    search, restore it (search + cursor/scroll) and clear the slot.
- `src/ui/search/SearchInput.tsx` / status surfaces — committed vs typing
  indicator already exists for Detail; reuse it for Tree/Viewer committed state.

No change to matching (`activityMatch`, `treeSearch`, smart-case) or to the
panel narrowing logic.

## Edge cases

- **Query edit after filter-confirm**: typing/Backspace sets `navigated = false`
  and `committed = false` (back to typing), so the next bare Enter filter-confirms
  again.
- **Empty query + Enter**: no matches semantics already show the full list while
  typing; bare Enter on an empty query is a no-op (nothing to confirm/act on).
- **Match list shrinks under live updates** while committed: `index` is clamped
  mod hit-count (existing behavior); the cursor stays on a valid match.
- **Detail opened from Tree?** Tree Enter selects a node, it does not open a
  Detail, so the Viewer↔Detail save/restore path is Viewer-only.
- **`navigated = true` but zero matches**: Enter is a no-op (no row to act on),
  consistent with the existing `hits.length > 0` guard.

## Testing (TDD)

Per surface and per transition, written failing-first:

- Viewer: bare Enter → search stays open, matches-only view, `committed`.
- Viewer: ↓ then Enter → Detail opens for the *navigated* row; `savedSearch` set.
- Viewer↔Detail: search → ↓ → Enter → Esc → Viewer search restored with cursor
  on the matched row.
- Viewer↔Detail: search → ↓ → Enter → `/` in Detail → Esc (resets Detail search,
  stays in Detail, Viewer snapshot intact) → Esc (Detail closes, Viewer search
  restored).
- Tree: bare Enter → search stays; ↓ then Enter → node selected, search stays.
- Esc layering: each row of the Esc table above as a discrete test.
- Regression: existing in-pane search tests still pass (matching, narrowing,
  smart-case, Detail `n`/`N`).
