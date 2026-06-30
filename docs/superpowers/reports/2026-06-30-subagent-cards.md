# Sub-agent black-box cards (P1) — implementation record

> Issue: #226 · Branch: `feat/226-subagent-cards` ·
> Plan: [`../plans/2026-06-30-subagent-cards.md`](../plans/2026-06-30-subagent-cards.md) ·
> Spec: [`../specs/2026-06-30-subagent-cards-design.md`](../specs/2026-06-30-subagent-cards-design.md)

Durable per-task record (decisions + deviations a diff can't show). Entries
appended after each clean review; digest synthesized at PR time.

## Ledger

- Task 1: complete (commits 7652357..40c7955, review clean — Approved)
- Task 2: complete (commits 534c19b..310d4ca, review clean — Approved after 1 fix)

---

## Task 1 — `buildSubAgentSummary` + `formatDuration` (pure)

**Intent:** Derive a sub-agent's black-box summary (status/steps/duration/intent/
result/model) from existing node fields + its parsed activity stream — the data
layer for the later viewer header.

**What was built:** New pure module `src/ui/subAgentSummary.ts`: `SubAgentSummary`
interface, `buildSubAgentSummary(node, activities)` (returns `null` when
`!node.agentId`), `formatDuration(ms)`. Unit tests in
`tests/ui/subAgentSummary.test.ts` (5, all green, TDD RED was genuine
module-not-found).

**Key decisions / trade-offs:**
- `result` via a reverse scan for the last `type==="response"` (O(n), no array
  copy).
- `durationMs` = first→last activity span (wall time), `null` when <2 activities.
- Defensive `Math.max(0, …)` in `formatDuration` (harmless, not spec-required).

**Deviations from the plan:** None. (Spec's `name` field already dropped at plan
time — the panel reuses its existing title; recorded in the plan's self-review.)

**Files touched:** `src/ui/subAgentSummary.ts`, `tests/ui/subAgentSummary.test.ts`.

**Follow-ups / known gaps:** None.

---

## Task 2 — Viewer renders the sub-agent summary header

**Intent:** When `subAgentSummary` is set, render a header (chip · intent /
optional Result / `─ activity (↵ drill in)` divider) above the activity stream,
keeping the box `visibleRows` tall; main session unchanged.

**What was built:** `ActivityViewerPanel` gained an optional
`subAgentSummary?: SubAgentSummary | null` prop. In the non-search render tail a
`boxRow` helper builds the header lines; `streamRows = max(1, visibleRows -
headerLines.length)` shrinks the stream slice + pad so total height is unchanged;
`finalLines = [...headerLines, ...padded, ...lines]`. Search path and main-session
path untouched. Tests: header content, no-header for main session, and full-width
alignment.

**Key decisions / trade-offs:**
- Header pinned at top, stream stays bottom-aligned beneath it.
- Result line normalized to one line (`\s+`→space) and omitted when empty.

**Deviations from the plan:** The plan's `boxRow` snippet had an **off-by-one**
(`contentWidth - 1`) that rendered header rows one cell too narrow (right border
misaligned). Caught by task review; fixed to `contentWidth` for both truncate
budget and pad base (commit 310d4ca) — matches the existing `emptyRow`
(`contentWidth + 3` cells). Added a width-alignment test (RED 79 → GREEN 80) so
the class can't regress. Plan code corrected in spirit; the plan file's snippet
is left as the historical record (this report is the correction note).

**Files touched:** `src/ui/ActivityViewerPanel.tsx`, `tests/ui/ActivityViewerPanel.test.tsx`.

**Follow-ups / known gaps:** None.
