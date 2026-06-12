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

import type { GlobalConfig, SessionTree } from "../types/index.js";
import { claudeProvider } from "./providers/claude.js";
import type { DiscoverOptions, SessionProvider } from "./providers/types.js";

export {
  decodeProjectPath,
  findContainingProject,
  getProjectsDir,
} from "./providers/claude.js";
export type { DiscoverOptions } from "./providers/types.js";

const PROVIDERS: SessionProvider[] = [claudeProvider];

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

  return {
    projects: trees.flatMap((t) => t.projects),
    coldProjects: trees.flatMap((t) => t.coldProjects),
    totalCount: trees.reduce((n, t) => n + t.totalCount, 0),
    timestamp: trees[trees.length - 1].timestamp,
    hiddenStats: {
      total: trees.reduce((n, t) => n + t.hiddenStats.total, 0),
      active: trees.reduce((n, t) => n + t.hiddenStats.active, 0),
    },
  };
}
