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

export type ProviderName = "claude" | "kiro" | "kiro-ide" | "codex";

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

/** Optional out-of-band context for parsers whose record format
 * lacks information the activities need. Kiro IDE history entries
 * carry no timestamps, so the caller supplies the session file's
 * mtime as the best available stand-in. */
export interface ParseContext {
  mtimeMs?: number;
}

export interface SessionProvider {
  readonly name: ProviderName;
  /** True when every line of the session file is an independent
   * record (real JSONL) — Claude / Kiro CLI / Codex. The history
   * cache uses this to parse only the newly-appended tail when such
   * a file grows, instead of re-parsing the whole (possibly huge)
   * file. False for formats where the file is a single JSON
   * document (Kiro IDE), which must always be parsed whole. */
  readonly lineDelimited: boolean;
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
   * reuse a single read for both tail and full-history use cases.
   * `context` carries out-of-band info (e.g. file mtime) for
   * formats that lack it inline; providers may ignore it. */
  parseActivities(lines: string[], context?: ParseContext): ParseResult;
  /** Line-delimited providers only: true when `line` STARTS a new
   * turn (a user prompt). The history cache splits its frozen
   * prefix from the re-parsed tail ONLY at such lines, so a
   * cross-line dependency that lives within one turn — Claude's
   * tool_use→tool_result enrichment and consecutive-call merge —
   * never straddles the seam. Optional; when absent the cache falls
   * back to any line boundary (a rare tool may lose its detail at
   * the seam). */
  isTurnBoundary?(line: string): boolean;
}
