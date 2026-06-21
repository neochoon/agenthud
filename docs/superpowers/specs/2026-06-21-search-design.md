# In-pane text search (`/`) — design

> Issue: #198 · Branch: `feat/198-search`

## Context

AgentHUD has a type-`filter` (`f`) that cycles `config.filterPresets` to narrow
the Activity Viewer by activity *type* (response/bash/edit/…). It has no text
**search**: with dozens of sessions you cannot jump to "the auth session", and
in a long activity stream or a long Bash/diff body you cannot locate a string.

The three surfaces a user looks at are all local to the running TUI:

- **Session Tree** (top): projects → sessions → sub-agents.
- **Activity Viewer** (bottom): the selected session's activity stream (each row
  is `label` + a one-line `detail`).
- **Detail View** (overlay): one activity's full body — a diff, file content, or
  Bash stdout/stderr, which can be long.

Cross-session / global search (grep across every session on disk) is explicitly
out of scope — it is a much larger, separate feature (indexing, performance, a
new results surface).

## Goals

Add a text search bound to `/`, scoped to the **focused** surface, distinct from
the `f` type-filter. Two interaction models, chosen to fit each surface:

- **Lists (Tree, Viewer) — transient finder** (fzf-style): `/` opens a search
  input; typing narrows the list live to substring matches; `Enter` selects the
  highlighted item and restores the full list with that item selected; `Esc`
  cancels and restores with no change. Search *locates*; the `f` filter
  *persists* — the two stay distinct.
- **Detail View — jump** (less-style): `/` opens the input; typing jumps to the
  first match (live); `n`/`N` cycle next/previous; `Esc` exits. The body is
  unchanged; matches are highlighted.

Matching is **substring with smart-case** (all-lowercase query → case-
insensitive; any uppercase → case-sensitive). The matched span is rendered with
an inverse highlight. A bottom status line shows the query and match count
(`/auth   3/12`).

## Non-goals

- **Global / cross-session search.** Current TUI surfaces only.
- **Fuzzy matching.** Substring only — predictable, and it matches the
  less-style jump semantics in Detail. (Could be a later option.)
- **Regex.** Plain substring. (Later option if asked.)
- **Replacing the `f` type-filter.** Search is additive and orthogonal; in the
  Viewer the two compose (AND).
- **Persisting search across sessions/restarts.** Search state is ephemeral.

## Keys

`/ n N` are currently unbound; `g`/`G` remain scroll-to-top/bottom and are not
touched.

- `/` — open search in the focused surface (Tree if tree-focused, Viewer if
  viewer-focused, Detail if the Detail overlay is open).
- While the **list finder** is open: printable keys edit the query; `↑`/`↓` move
  the selection among the narrowed matches (j/k are reserved for the query);
  `Enter` selects + restores; `Esc` cancels + restores.
- While **Detail search** is open: printable keys edit the query (live jump to
  first match); `Enter` and `n` jump to the next match, `N` to the previous;
  `Esc` exits search (stays in the Detail View).
- `Backspace` edits the query in all modes.

Search mode is exclusive and short-circuits like the existing help/detail modes
(`useHotkeys` already routes by focus + mode; search becomes another mode).

## Surface behavior

### Session Tree (transient finder)

- **Match fields:** project name, session/sub-agent description
  (`firstUserPrompt`), and id. (Model/provider are not matched in v1 — low value,
  easy to add later.)
- **Hierarchical narrow:** a row is kept if it matches *or* has a descendant that
  matches — so a matching session keeps its parent project visible. Empty
  projects (no matching descendant and no self-match) are dropped.
- **Selection:** `Enter` sets the tree selection to the highlighted session/
  sub-agent, closes the finder, and restores the full tree. `Esc` restores with
  the prior selection.

### Activity Viewer (transient finder)

- **Match fields:** activity `label` + one-line `detail`. The multi-line
  `detailBody` is **not** searched here — that is the Detail View's job.
- **Composition:** search narrows *within* the currently `f`-filtered activities
  (AND). Clearing search restores the `f`-filtered stream; the `f` filter is
  independent.
- **Selection:** `Enter` moves the viewer cursor to the highlighted activity and
  restores the full (filtered) stream. `Esc` restores the prior cursor.

### Detail View (jump)

- **Match target:** the rendered body text (the same lines the view scrolls).
- `n`/`N` cycle matches and scroll the body so the current match is visible; the
  current match gets a distinct highlight from the others. `Esc` exits search;
  the Detail View stays open at the current scroll position.

## Components

Keep units small and pure where possible.

- **`src/ui/search/matcher.ts`** — pure matching. `matchRanges(text, query):
  Array<[start, end]>` (smart-case; empty for no match / empty query) and a thin
  `hasMatch(text, query): boolean`. The single source of match + highlight
  truth, unit-tested in isolation.
- **Tree narrow** — a pure `filterTreeBySearch(tree, query)` mirroring the
  existing `filterTreeByHidden` shape (`src/ui/App.tsx`), returning the
  hierarchically-narrowed tree.
- **Viewer narrow** — a pure predicate over `ActivityEntry` (label + detail)
  reusing `matcher`.
- **Detail matches** — a pure helper returning the match line/column positions
  over the body lines for jump + highlight.
- **Search state + input shell** — a small piece of UI state (active surface,
  query, selection/match index) and a status-line input renderer. Routed by a
  new `search` mode in `useHotkeys` (sibling to help/detail modes).

## Data flow

```
'/'  → enter search mode for the focused surface
typing → matcher.matchRanges over that surface's text
  · lists  → narrow (pure filter) + highlight; ↑/↓ move selection
  · detail → compute match positions; jump to first; highlight
Enter → lists: commit selection, restore full list; detail: next match
Esc   → restore (lists) / exit (detail); leave search mode
```

## Error handling

- Empty query → no matches, no narrow (list shows full set; detail no jump).
- No matches → status line shows `0/0`; lists render empty-with-hint; detail
  stays put. No throw.
- Query with regex-special characters is treated literally (substring, not
  regex) — no escaping pitfalls.
- Search state resets when the focused surface changes or the underlying data
  refreshes in a way that invalidates the selection (fall back to the live edge,
  consistent with existing viewer behavior).

## Testing

- **`matcher.ts`** unit tests: substring hit/miss, smart-case (lowercase vs
  mixed-case query), multiple ranges in one string, empty query, overlapping/
  adjacent matches, unicode width-safe ranges.
- **Tree narrow**: matching session keeps its project; matching project keeps
  itself; non-matching branches dropped; sub-agent match keeps parent chain.
- **Viewer narrow**: matches label and detail; composes with a `f` filter (AND);
  Enter selects the right activity.
- **Detail jump**: first-match jump, `n`/`N` wrap-around, current-vs-other
  highlight, `Esc` keeps scroll.
- **Hotkeys**: `/` enters search for the focused surface; keys route to the
  query; `Esc`/`Enter` lifecycle; search mode short-circuits other bindings.

All via TDD. `tsc --noEmit` and whole-repo `biome check` clean before each
commit. Docs kept in sync (`getHelp()`, `HelpPanel` SECTIONS, FEATURES.md).

## Phasing

One spec, a staged plan — each phase is independently shippable.

1. **Shared matcher + search shell + Detail search.** Establishes
   `matcher.ts`, the search mode in `useHotkeys`, the status-line input, and the
   simplest surface (jump, no narrow, no selection-restore).
2. **Activity Viewer narrow-finder.** Adds list-narrow + transient-finder
   lifecycle + AND composition with `f`.
3. **Session Tree narrow-finder.** Hierarchical narrow + selection restore — the
   highest-value, most complex surface, built last on the proven shell.

Each phase updates `getHelp()`, `HelpPanel`, and FEATURES.md for the keys it
adds.
