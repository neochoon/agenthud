/**
 * Top-level session discovery — enumerates enabled providers
 * (Claude today; Kiro / OpenCode in follow-up PRs), calls each one's
 * `discoverSessions`, and merges the per-provider `SessionTree`
 * results into a single tree the rest of the app consumes.
 *
 * Design decisions:
 * - Providers self-report availability via `isAvailable()`. An
 *   unavailable provider (no install / empty data dir) is silently
 *   skipped — the tree just omits its projects. No errors bubble up
 *   to the UI.
 * - Public API (`getProjectsDir`, `decodeProjectPath`,
 *   `findContainingProject`) is re-exported from `providers/claude`
 *   so callers don't have to know where the actual implementation
 *   lives. These three are Claude-specific by nature; future
 *   providers don't need analogous helpers at the top level.
 * - The orchestrator preserves Claude-only behavior bit-for-bit
 *   while only one provider is enabled. The merge semantics
 *   (`hiddenStats` summing, `totalCount` summing) will be exercised
 *   the moment PR #2 lands Kiro alongside.
 *
 * Gotcha:
 * - The `timestamp` on the merged tree reflects the most recent
 *   provider tree, not a per-project capture time — refresh callers
 *   should not assume per-project freshness from this field.
 */

import type {
  GlobalConfig,
  ProjectNode,
  SessionNode,
  SessionStatus,
  SessionTree,
} from "../types/index.js";
import { claudeProvider } from "./providers/claude.js";
import { codexProvider } from "./providers/codex.js";
import { kiroProvider } from "./providers/kiro.js";
import { kiroIdeProvider } from "./providers/kiro-ide.js";
import type { DiscoverOptions, SessionProvider } from "./providers/types.js";

export {
  decodeProjectPath,
  findContainingProject,
  getProjectsDir,
} from "./providers/claude.js";
export type { DiscoverOptions } from "./providers/types.js";

const PROVIDERS: SessionProvider[] = [
  claudeProvider,
  kiroProvider,
  kiroIdeProvider,
  codexProvider,
];

/**
 * Walk every enabled provider, build per-provider `SessionTree`s,
 * and merge into one. With a single provider enabled the result is
 * indistinguishable from calling that provider directly — that's the
 * zero-behavior-change contract for PR #1 (the abstraction layer).
 */
export function discoverSessions(
  config: GlobalConfig,
  options?: DiscoverOptions,
): SessionTree {
  const trees: SessionTree[] = [];
  for (const provider of PROVIDERS) {
    if (!provider.isAvailable()) continue;
    trees.push(provider.discoverSessions(config, options));
  }
  return mergeTrees(trees);
}

function mergeTrees(trees: SessionTree[]): SessionTree {
  if (trees.length === 0) {
    return {
      projects: [],
      coldProjects: [],
      totalCount: 0,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
  }
  if (trees.length === 1) return trees[0];

  // Coalesce ProjectNodes by `projectPath` across providers — same
  // directory worked from Claude AND Kiro should render as ONE
  // project row with combined sessions, not two. Without this we
  // produce duplicate keys in the React renderer (same `name` used
  // as key prop) and the user sees the same project twice with the
  // sessions split unpredictably between rows.
  const byPath = new Map<string, ProjectNode>();
  const coldByPath = new Map<string, ProjectNode>();

  const statusRank: Record<string, number> = {
    hot: 0,
    warm: 1,
    cool: 2,
    cold: 3,
  };
  const hotter = (a: SessionStatus, b: SessionStatus) =>
    statusRank[a] <= statusRank[b] ? a : b;

  const merge = (target: Map<string, ProjectNode>, p: ProjectNode) => {
    const existing = target.get(p.projectPath);
    if (!existing) {
      target.set(p.projectPath, { ...p, sessions: [...p.sessions] });
      return;
    }
    existing.sessions = existing.sessions.concat(p.sessions);
    existing.hotness = hotter(existing.hotness, p.hotness);
    if (p.hidden) existing.hidden = true;
  };

  for (const t of trees) {
    for (const p of t.projects) merge(byPath, p);
    for (const p of t.coldProjects) merge(coldByPath, p);
  }

  // A project that was cold from one provider but active from
  // another should appear in the active list, not cold. Promote.
  for (const [path, p] of coldByPath) {
    if (byPath.has(path)) {
      const target = byPath.get(path);
      if (!target) continue;
      target.sessions = target.sessions.concat(p.sessions);
      coldByPath.delete(path);
    }
  }

  // Re-sort after coalescing. Each provider sorted its own tree,
  // but concat order inside merged projects (and the project list
  // itself) would otherwise depend on provider registration order —
  // a Kiro hot session could render below a Claude cool one. Same
  // comparators the providers use.
  const sessionCmp = (a: SessionNode, b: SessionNode) => {
    if (a.nonInteractive !== b.nonInteractive) {
      return a.nonInteractive ? 1 : -1;
    }
    const d = statusRank[a.status] - statusRank[b.status];
    if (d !== 0) return d;
    return b.lastModifiedMs - a.lastModifiedMs;
  };
  for (const p of byPath.values()) p.sessions.sort(sessionCmp);
  for (const p of coldByPath.values()) p.sessions.sort(sessionCmp);

  const projects = [...byPath.values()].sort((a, b) => {
    const d = statusRank[a.hotness] - statusRank[b.hotness];
    if (d !== 0) return d;
    return (
      (b.sessions[0]?.lastModifiedMs ?? 0) -
      (a.sessions[0]?.lastModifiedMs ?? 0)
    );
  });

  return {
    projects,
    coldProjects: [...coldByPath.values()],
    totalCount: trees.reduce((n, t) => n + t.totalCount, 0),
    timestamp: trees[trees.length - 1].timestamp,
    hiddenStats: {
      total: trees.reduce((n, t) => n + t.hiddenStats.total, 0),
      active: trees.reduce((n, t) => n + t.hiddenStats.active, 0),
    },
  };
}
