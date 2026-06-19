/**
 * Runner for `agenthud follow`: `buildSnapshots()` flattens a
 * discovery `SessionTree` into the per-node snapshots the diff engine
 * consumes, and `runFollow()` drives discovery on an interval, seeds
 * backfill from `--since`, formats, and writes lines.
 *
 * Design decisions:
 * - `buildSnapshots` takes the parser as a parameter (default
 *   `parseSessionHistory`) so it is testable without touching the
 *   filesystem.
 * - On seed, pre-existing sessions/sub-agents are NOT announced
 *   (no session_start / subagent_spawn) and activities older than
 *   `sinceMs` are dropped — startup is a backfill floor, not a replay
 *   of all history.
 */

import type {
  ActivityEntry,
  GlobalConfig,
  SessionNode,
  SessionTree,
} from "../types/index.js";
import { formatHuman, formatJson } from "./followFormat.js";
import { diffSnapshots } from "./followStream.js";
import type { FollowState, NodeSnapshot } from "./followTypes.js";
import { parseSessionHistory } from "./sessionHistory.js";
import { discoverSessions } from "./sessions.js";

export function buildSnapshots(
  tree: SessionTree,
  parse: (filePath: string) => ActivityEntry[] = parseSessionHistory,
): NodeSnapshot[] {
  const out: NodeSnapshot[] = [];
  const all = [...tree.projects, ...tree.coldProjects];
  for (const project of all) {
    for (const top of project.sessions) {
      out.push(nodeOf(top, top, null, project.name, parse));
      for (const sub of top.subAgents) {
        out.push(nodeOf(sub, top, sub.agentId ?? sub.id, project.name, parse));
      }
    }
  }
  return out;
}

function nodeOf(
  node: SessionNode,
  top: SessionNode,
  subagent: string | null,
  project: string,
  parse: (filePath: string) => ActivityEntry[],
): NodeSnapshot {
  return {
    session: top.id,
    subagent,
    provider: node.provider ?? top.provider ?? "claude",
    project,
    // Always the top-level session's cwd — a sub-agent SessionNode may
    // not carry one, and the contract guarantees a non-empty projectPath.
    projectPath: top.projectPath,
    liveState: node.liveState,
    activities: parse(node.filePath),
  };
}

export interface RunFollowOptions {
  config: GlobalConfig;
  sinceMs: number;
  json: boolean;
  include: Set<string> | null;
  intervalMs?: number;
  now?: () => number;
  write?: (line: string) => void;
  /** One-shot: emit the seed backfill and return without streaming. */
  once?: boolean;
}

/** The loop. Seeds cursors from `sinceMs`, then diffs every interval. */
export function runFollow(opts: RunFollowOptions): { stop: () => void } {
  const now = opts.now ?? Date.now;
  const write = opts.write ?? ((l: string) => process.stdout.write(`${l}\n`));
  const interval = opts.intervalMs ?? opts.config.refreshIntervalMs ?? 2000;
  const fmt = opts.json ? formatJson : formatHuman;

  // Seed: backfill activities with ts >= sinceMs, then set cursors to "current".
  let state: FollowState = new Map();
  const seedTree = discoverSessions(opts.config);
  const seedSnaps = buildSnapshots(seedTree);
  {
    const t = now();
    const { events, nextState } = diffSnapshots(
      new Map(),
      seedSnaps,
      opts.include,
      t,
    );
    state = nextState;
    for (const e of events) {
      if (e.type === "activity" && e.ts < opts.sinceMs) continue; // backfill floor
      if (e.type === "lifecycle" && e.kind === "session_start") continue; // don't announce pre-existing sessions at startup
      if (e.type === "lifecycle" && e.kind === "subagent_spawn") continue;
      write(fmt(e));
    }
  }

  // One-shot: the seed is the whole output. Don't schedule the loop so the
  // process exits naturally once stdout flushes (no `process.exit` that could
  // truncate buffered output).
  if (opts.once) return { stop: () => {} };

  const tick = () => {
    const snaps = buildSnapshots(discoverSessions(opts.config));
    const { events, nextState } = diffSnapshots(
      state,
      snaps,
      opts.include,
      now(),
    );
    state = nextState;
    for (const e of events) write(fmt(e));
  };
  const handle = setInterval(tick, interval);
  return { stop: () => clearInterval(handle) };
}
