# Search State Persistence — implementation record

> Issue: #210 · Branch: `feat/210-search-persistence` ·
> Plan: [`../plans/2026-06-23-search-persistence.md`](../plans/2026-06-23-search-persistence.md)

A durable, committed record of why each task was built the way it was —
decisions and deviations a diff cannot show. Per-task entries are appended after
a clean review; a one-page digest is synthesized at PR time.

## Ledger

- Task 1: complete (commits d75a75c..813dea9, review clean — Approved)

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
