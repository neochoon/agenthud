# Search State Persistence — implementation record

> Issue: #210 · Branch: `feat/210-search-persistence` ·
> Plan: [`../plans/2026-06-23-search-persistence.md`](../plans/2026-06-23-search-persistence.md)

A durable, committed record of why each task was built the way it was —
decisions and deviations a diff cannot show. Per-task entries are appended after
a clean review; a one-page digest is synthesized at PR time.

## Ledger

- Task 1: complete (commits d75a75c..813dea9, review clean — Approved)
- Task 2: complete (commits 3bc0682..a147940, review clean — Approved)
- Task 3: complete (commits ecbaec1..6c20039, review clean — Approved)

---

## Task 1 — Viewer Enter: filter-confirm vs open-detail (driven by `navigated`)

**Intent:** Make viewer Enter keep the search open, branching on whether the user
navigated the selection: bare Enter filter-confirms (matches-only stays), ↓/↑
then Enter opens the matched row's Detail.

**What was built:** Added `navigated?: boolean` to `SearchState`
(`src/ui/search/searchKey.ts`). In `App.tsx`: `onOpenSearch` inits
`navigated:false`; viewer ↑/↓ set `navigated:true`; typing/backspace reset it to
`false`; the viewer Enter handler returns early (no Detail, no close) when
`!navigated`, and otherwise opens the selected match's Detail (still
`setSearch(null)` for now — round-trip preservation is Task 2). New test
`bare Enter … filter-confirms`; the existing #209 test updated to press ↓ before
Enter.

**Key decisions / trade-offs:**
- `navigated` is **optional** (`navigated?: boolean`) so existing `SearchState`
  literals don't break; read as `!search.navigated` / `search.navigated`.
- Reset `navigated` on every query edit so a fresh query always filter-confirms
  on a bare Enter (matches the "did you move the selection?" rule).
- Test mechanics proven this session: arrow/Esc built from
  `String.fromCharCode(27)` (no raw ESC bytes); search count is 1-based
  (`1/2` = first of two). These were baked into the plan after a pre-flight
  probe caught wrong `"[B"`/`"2/2"` values.

**Deviations from the plan:** None in behavior. The spec's filter-confirm
"set `committed = true`" is intentionally **not** implemented for the viewer
(nothing reads it; YAGNI) — `committed` stays Detail-only. Recorded as agreed.

**Files touched:** `src/ui/search/searchKey.ts`, `src/ui/App.tsx`,
`tests/ui/App.test.tsx`.

**Follow-ups / known gaps:**
- Review Minor: filter-confirm test asserts via two `tick()`s rather than
  `vi.waitFor` (intentional — asserting *absence* of a transition); could carry
  an inline note.
- Pre-existing (not a regression): a navigated Enter with `hits.length === 0`
  still closes the search without opening Detail.

---

## Task 2 — Viewer ↔ Detail round-trip: preserve & restore the viewer search

**Intent:** Opening a Detail from a viewer-search row, then Esc-ing back, should
land in the same viewer search with the cursor on the matched row; the Detail's
own body search must be independent.

**What was built:** Added `savedViewerSearch: { search; windowStart } | null`
state in `App.tsx` (right after `search`). The viewer navigated-Enter branch
snapshots `{ search, windowStart: viewerSearchWindowStart }` into it *before*
opening the Detail (then still `setSearch(null)`). `onDetailClose` restores the
snapshot (`setSearch` + `setViewerSearchWindowStart`) and clears the slot when
present. Two tests: the round-trip restore (RED→GREEN) and a layering guard
(Detail's own `/` search resets on Esc without losing the saved viewer search,
then a second Esc closes Detail and restores it).

**Key decisions / trade-offs:**
- Snapshot captures the render-closure `search` by value before `setSearch(null)`
  runs; React batches event-handler updates so the snapshot is never clobbered.
- Restore is guarded by `if (savedViewerSearch)`, so a Detail opened by a plain
  Enter (no active search) closes normally with no stale-search resurrection
  (verified by the reviewer as the key risk).
- Detail's independent body search "just works" because entering Detail sets
  `search=null` (viewer search stashed) — its `/` opens a fresh detail-surface
  search; the layering test is a guard, not RED-first (passes on Task 2 code).

**Deviations from the plan:** None.

**Files touched:** `src/ui/App.tsx`, `tests/ui/App.test.tsx`.

**Follow-ups / known gaps:** None. (`committed` still Detail-only, as agreed.)

---

## Task 3 — Tree Enter: filter-confirm vs select-node, keep search alive

**Intent:** Apply the same `navigated`-driven Enter to the tree surface: bare
Enter filter-confirms (keeps the narrowed tree search), ↓/↑ then Enter
selects/expands the node — both keep the search open; Esc still ends it.

**What was built:** In `App.tsx`'s `if (search?.surface === "tree")` block: ↑/↓
now set `navigated:true`; typing/backspace reset `navigated:false`; the Enter
handler returns early when `!navigated` (filter-confirm) and otherwise
`setSelectedId` + `stopTracking` **without** the old `setSearch(null)`. The
`key.escape → setSearch(null)` path is untouched (Esc still exits search). New
top-level describe `tree search → Enter keeps search alive` with two tests
(bare-Enter filter-confirm; ↓+Enter selects node, search stays), each RED→GREEN.

**Key decisions / trade-offs:**
- Mirrors the viewer surface exactly (same `navigated` semantics), so the three
  list surfaces behave consistently.
- Tree tests open `/` directly (tree is focused at boot; `↵: expand` footer
  confirms) — no Tab needed, unlike the viewer tests.

**Deviations from the plan:** None.

**Files touched:** `src/ui/App.tsx`, `tests/ui/App.test.tsx`.

**Follow-ups / known gaps:** None.
