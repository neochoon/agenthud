/**
 * Pluggable session-source abstraction. Each provider knows how to
 * discover sessions from one agent CLI's on-disk layout and parse
 * its JSONL record format into the shared `SessionTree` /
 * `ActivityEntry` shapes the rest of agenthud consumes.
 *
 * Design decisions:
 * - The orchestrator in `sessions.ts` enumerates all enabled
 *   providers, skips unavailable ones (no install / empty dir),
 *   calls each `discoverSessions`, and merges results. Per-provider
 *   trees are kept intentionally independent — no cross-provider
 *   parent/child relationships.
 * - `parseActivities` takes raw lines so callers (tail / full read)
 *   can reuse the same parser without re-reading the file. The
 *   return shape includes `tokenCount` etc. matching the existing
 *   Claude parser for transparent backward compat.
 *
 * Gotcha:
 * - Providers MUST NOT throw on missing directory — `isAvailable()`
 *   already guards. The orchestrator trusts that contract; a
 *   provider that throws on a degraded environment will break the
 *   whole tree refresh.
 */

import type {
  ActivityEntry,
  GlobalConfig,
  SessionTree,
} from "../../types/index.js";

export type ProviderName = "claude" | "kiro";

export interface DiscoverOptions {
  // When set, drop every project whose decoded path is not exactly this
  // string. Caller is responsible for resolving symlinks and choosing
  // the matching project (see findContainingProject).
  scopeToProject?: string;
}

export interface ParseResult {
  activities: ActivityEntry[];
  tokenCount: number;
  modelName: string | null;
  sessionStartTime: Date | null;
}

export interface SessionProvider {
  readonly name: ProviderName;
  /** True when the provider's storage location exists and looks
   * usable. Cheap check — no file reads beyond a directory probe. */
  isAvailable(): boolean;
  /** Build the per-provider `SessionTree`. Returns an empty tree
   * (no projects, hiddenStats zeroed) when nothing is discoverable;
   * never throws on a degraded environment. */
  discoverSessions(
    config: GlobalConfig,
    options?: DiscoverOptions,
  ): SessionTree;
  /** Parse the given JSONL lines into the canonical activity list.
   * Lines are passed in instead of a file path so the caller can
   * reuse a single read for both tail and full-history use cases. */
  parseActivities(lines: string[]): ParseResult;
}
