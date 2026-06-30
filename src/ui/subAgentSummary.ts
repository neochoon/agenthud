/**
 * Derive a sub-agent's "black-box" summary (intent → status/steps/duration →
 * result) from data already on the node and its parsed activity stream. Pure;
 * returns null for main sessions (which have no agentId and keep full detail).
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
  return {
    status: node.liveState === "working" ? "running" : "done",
    steps,
    durationMs,
    intent: node.taskDescription ?? "",
    result,
    model: node.modelName,
  };
}

export function formatDuration(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}
