/**
 * Pure derivation of a sub-agent's black-box summary (intent, status, steps,
 * duration, result) from session node + activity stream, for the Activity
 * Viewer panel header and detail view chip.
 *
 * Design decisions:
 * - Backward scan for result: the last `response` activity carries the final
 *   answer; stops on first match (most recent = most relevant). O(n) worst-case,
 *   but response entries are rare in most agent runs.
 * - Duration as span (last - first) not age: captures the agent's active window,
 *   not wall-clock elapsed; null when <2 activities (no span). Meaningful even
 *   when timestamps are stale.
 * - Status fold: both "working" and "waiting" liveStates map to "running" so a
 *   blocked-on-approval agent doesn't falsely appear done.
 * - Null for main sessions: avoids summary overhead for non-agents (isSubAgent
 *   ≡ `node.agentId` is set).
 *
 * Gotchas:
 * - formatDuration intentionally differs from formatElapsed (SessionTreePanel):
 *   duration is a span (e.g., "2m14s"), elapsed is age (e.g., "3d"). Separate
 *   concerns, separate formats.
 * - A sub-agent with zero activities returns a summary with steps=0,
 *   durationMs=null, result=""; intentional (no activity to show yet, but still
 *   a valid sub-agent).
 */
import type { ActivityEntry, SessionNode } from "../types/index.js";

export interface SubAgentSummary {
  status: "running" | "done";
  steps: number;
  durationMs: number | null;
  intent: string;
  result: string;
  model: string | null;
}

export function buildSubAgentSummary(
  node: SessionNode,
  activities: ActivityEntry[],
): SubAgentSummary | null {
  if (!node.agentId) return null;
  const steps = activities.filter((a) => a.type === "tool").length;
  const durationMs =
    activities.length >= 2
      ? activities[activities.length - 1].timestamp.getTime() -
        activities[0].timestamp.getTime()
      : null;
  let result = "";
  for (let i = activities.length - 1; i >= 0; i--) {
    if (activities[i].type === "response") {
      result = activities[i].detail;
      break;
    }
  }
  // "working" and "waiting" both mean the agent is alive/in-progress; only a
  // missing live signal (null) reads as done. Mapping "waiting" → "done" would
  // show an agent that's blocked on a tool/approval as finished.
  return {
    status:
      node.liveState === "working" || node.liveState === "waiting"
        ? "running"
        : "done",
    steps,
    durationMs,
    intent: node.taskDescription ?? "",
    result,
    model: node.modelName,
  };
}

/**
 * How many rows the viewer's sub-agent header occupies: a chip line + an
 * optional Result line + the divider (0 when there is no summary). The panel
 * renders exactly this many header rows, and App subtracts it from the viewer
 * row budget so scroll/cursor/selection stay in sync with the shorter stream.
 * Single source of truth for both sides.
 */
export function subAgentHeaderRowCount(
  summary: SubAgentSummary | null | undefined,
): number {
  if (!summary) return 0;
  return 2 + (summary.result ? 1 : 0); // chip + [result] + divider
}

/**
 * Format a *span* (start→end duration) compactly: `5s`, `2m14s`, `1h1m`.
 * Distinct on purpose from SessionTreePanel's `formatElapsed`, which formats
 * *time-since-now* as a single coarse unit (`49m`, `3d`, `2mo`). A span reads
 * better compound; an age reads better as one bucket — do not merge them.
 */
export function formatDuration(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}
