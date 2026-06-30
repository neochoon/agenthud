# Sub-agent black-box cards (P1) — implementation record

> Issue: #226 · Branch: `feat/226-subagent-cards` ·
> Plan: [`../plans/2026-06-30-subagent-cards.md`](../plans/2026-06-30-subagent-cards.md) ·
> Spec: [`../specs/2026-06-30-subagent-cards-design.md`](../specs/2026-06-30-subagent-cards-design.md)

Durable per-task record (decisions + deviations a diff can't show). Entries
appended after each clean review; digest synthesized at PR time.

## Ledger

- Task 1: complete (commits 7652357..40c7955, review clean — Approved)

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
