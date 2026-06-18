/**
 * Type contract for `agenthud follow`: the emitted `FollowEvent` (the
 * stable NDJSON shape consumers pin to), the flattened `NodeSnapshot`
 * the diff engine compares, and the per-node cursor state
 * (`NodeCursor` / `FollowState`) that remembers what was already
 * emitted.
 *
 * Design decisions:
 * - One snapshot per session AND per sub-agent (flattened) so the
 *   engine diffs a flat list rather than a tree.
 * - `FollowEvent` is additive-only: the supervisor contract must not
 *   break when fields are added.
 */

import type { ActivityEntry, LiveState } from "../types/index.js";

/** One emitted event. Stable NDJSON contract — additive-only. */
export interface FollowEvent {
  ts: number; // epoch ms
  type: "activity" | "state" | "lifecycle";
  provider: string;
  project: string;
  projectPath: string;
  session: string; // owning top-level session id
  subagent: string | null; // sub-agent's own id when this is its event
  label?: string; // activity
  detail?: string; // activity
  from?: LiveState | null; // state
  to?: LiveState | null; // state
  kind?: "session_start" | "session_end" | "subagent_spawn" | "subagent_done"; // lifecycle
}

/** Flattened per-node view the engine diffs (one per session AND per sub-agent). */
export interface NodeSnapshot {
  session: string;
  subagent: string | null;
  provider: string;
  project: string;
  projectPath: string;
  liveState: LiveState | null;
  activities: ActivityEntry[]; // full chronological list
}

export interface NodeCursor {
  emittedCount: number; // activities already emitted for this node
  lastLiveState: LiveState | null;
  meta: Omit<NodeSnapshot, "liveState" | "activities">; // to build a session_end/subagent_done event after the node disappears
}

export type FollowState = Map<string, NodeCursor>; // key = nodeKey(snapshot)
