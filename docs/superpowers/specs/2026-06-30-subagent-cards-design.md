# Sub-agent black-box cards — design (P1)

> Issue: #226 · Branch: `feat/226-subagent-cards`

## Context

The hero is the live HUD; the goal is its **retention**, not npm-download trials.
The dominant usage pattern shifted: users rarely hand-spawn one sub-agent — skills
and workflows (SDD, deep-research, `Workflow`, …) emit **fleets** of sub-agents.
agenthud currently renders each sub-agent at **full detail, on par with a main
session**, so a fleet floods the viewer with step-by-step noise.

Treat a sub-agent as a **black box**: intent **in** → (status / steps / duration /
result) → final result **out**. This spec covers **P1** only.

## Goals (P1)

When the selected node is a **sub-agent**, the Activity Viewer shows a **summary
header first**, with the step-by-step activity stream kept below it (demoted, but
still visible and drillable). A **main session is unchanged** — it is the hero and
keeps its full-detail view.

Out of scope for P1 (tracked on #226 for later):
- **Cost** field + task/PR cost aggregation (P2).
- **Skill-fleet roll-up** on the parent (`SDD 5/7 done · 2 running · $1.40`) (P3).
- **Failed** status. No reliable failure signal exists today (`LiveState` is only
  `working | waiting`; a finished sub-agent is just `liveState = null`). Status is
  **running / done** only; failure detection is deferred (see Open questions).
- Per-row step/duration on **every tree row** — that needs parsing every
  sub-agent file each poll (perf). Tree rows stay as they are today.

## Layout (chosen: header + stream below)

```text
┌─ » <name>   [running|done] · N steps · <duration> ────────────┐
│ Intent: <taskDescription, truncated>                          │
│ Result: <last response text, truncated>                       │
├─ activity (↵ drill in) ───────────────────────────────────────┤
│ ○ Read foo.ts                                                 │
│ $ npm test                                                    │
│ ○ Write notes.md                                              │
│ …                                                             │
```

The activity stream below the header is the **existing** viewer stream —
scrolling and `↵`-to-drill-into-a-row's-Detail are unchanged. The header is
additive, rendered only for sub-agents.

## Data — all existing (selected file already parsed)

`isSubAgent` = the selected node has `agentId` (main sessions don't).

| Header field | Source |
|---|---|
| name | existing display name (truncated `agentId` / task) |
| status | `running` when `liveState === "working"`; otherwise `done` |
| steps | count of activities with `type === "tool"` |
| duration | last activity `timestamp` − first activity `timestamp` (run length; distinct from the tree row's time-since-last). Omit / `<1s` when < 2 activities or sub-second. |
| Intent | `node.taskDescription` |
| Result | the last activity with `type === "response"` (its text); empty when none |
| model | `node.modelName` (shown in the chip row if width allows) |

No new collection: the viewer already parses the selected node's JSONL into
`activities`; the node carries `taskDescription`, `agentId`, `modelName`,
`liveState`, `status`.

## Architecture / components

- **`buildSubAgentSummary(node, activities)` — pure helper** (new). Input: the
  selected `SessionNode` + its `ActivityEntry[]`. Output:
  `{ name; status: "running" | "done"; steps: number; durationMs: number | null;
  intent: string; result: string; model: string | null } | null` — `null` when
  the node is not a sub-agent (`!node.agentId`). Unit-tested in isolation.
  - Lives next to the viewer (e.g. `src/ui/subAgentSummary.ts`) so the panel and
    tests import it without pulling in `App`.
- **`App.tsx`** computes the summary from the already-resolved selected node +
  `mergedActivities` and passes it to the viewer as a new optional prop
  `subAgentSummary?: SubAgentSummary | null`. No change to how the stream itself
  is built.
- **`ActivityViewerPanel`** renders a **summary header block** above the stream
  when `subAgentSummary` is set, then the existing stream beneath a
  `─ activity (↵ drill in) ─` divider. When the prop is absent (main session, or
  no selection) it renders exactly as today.
  - The header consumes a few rows of the panel's height budget; the stream's
    `visibleRows` shrinks accordingly so nothing overflows the box.

### 80-column guard / truncation

All header lines pass through the existing `truncateByWidth` (display-cell aware).
Degrade by priority as width shrinks: (1) drop the model from the chip row;
(2) shorten the `Result:` line; (3) keep the title chip down to `N steps`. The
header never wraps — one display line per field.

## Testing (TDD)

- **`buildSubAgentSummary`** unit tests: steps = tool count; duration = first→last
  span; result = last `response` text (and empty when none); intent =
  `taskDescription`; returns `null` for a main session (no `agentId`); edge cases
  of 0 and 1 activities.
- **`ActivityViewerPanel`**: renders Intent / Result / `N steps` when
  `subAgentSummary` is provided; renders the normal stream (no header) when it is
  absent (main-session regression); the activity stream is still present below the
  header.
- **Truncation**: at 80 cols the header lines stay within the box (right border
  aligned), Result degrades before the title chip.

## Open questions (resolved for P1)

- **steps = tool-call count** (per the requirement), not assistant turns.
- **sub-agent-only**; main sessions unchanged.
- **duration = run length** (first→last activity), not time-since-last.
- **failed**: deferred — the only candidate signal is the parent's Task
  `tool_result.is_error` (now captured via #222), which needs parent→sub-agent
  linking and only catches infra crashes (not "bad work"). Revisit after P1.
