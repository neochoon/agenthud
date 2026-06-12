/**
 * Filesystem wrapper: read a session JSONL file from disk and
 * return the complete activity history in chronological order.
 *
 * Design decisions:
 * - Pure I/O. All parsing logic stays in the per-provider parsers.
 *   This split lets parsers be unit-tested with synthetic lines
 *   without touching the filesystem, while callers that already
 *   have a path stay one-liners.
 * - Provider routing happens here, not in the parser. We sniff the
 *   path: `~/.kiro/sessions/cli/` → Kiro, otherwise → Claude. The
 *   default-to-Claude lets unmodified callers (sessionHistory tests,
 *   reportGenerator, etc.) work unchanged for Claude paths.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { ActivityEntry } from "../types/index.js";
import { claudeProvider } from "./providers/claude.js";
import { codexProvider, getCodexSessionsDir } from "./providers/codex.js";
import { getKiroSessionsDir, kiroProvider } from "./providers/kiro.js";
import {
  getKiroIdeSessionsDir,
  kiroIdeProvider,
} from "./providers/kiro-ide.js";
import type { SessionProvider } from "./providers/types.js";

const norm = (p: string) => p.replace(/\\/g, "/");

// Provider routing by path. Primary check is a prefix match against
// each provider's ACTUAL configured root (so KIRO_SESSIONS_DIR /
// KIRO_IDE_SESSIONS_DIR overrides route correctly — a hardcoded
// segment check alone would silently send overridden Kiro paths to
// the Claude parser). The well-known segments stay as fallbacks for
// nodes constructed before an env change. Claude is the default.
function providerForPath(filePath: string): SessionProvider {
  const p = norm(filePath);
  if (
    p.startsWith(`${norm(getKiroSessionsDir())}/`) ||
    p.includes("/.kiro/sessions/")
  ) {
    return kiroProvider;
  }
  // The IDE root env points at workspace-sessions; execution docs
  // (sub-agent filePaths) live under its PARENT, so prefix on the
  // parent covers both.
  if (
    p.startsWith(`${norm(dirname(getKiroIdeSessionsDir()))}/`) ||
    p.includes("kiro.kiroagent/")
  ) {
    return kiroIdeProvider;
  }
  if (
    p.startsWith(`${norm(getCodexSessionsDir())}/`) ||
    p.includes("/.codex/sessions/")
  ) {
    return codexProvider;
  }
  return claudeProvider;
}

// Parsed-history cache keyed by path → { mtime, activities }. The
// activity viewer in LIVE mode re-asks for the selected session's
// history on every ~2s poll. For a long-running session the file is
// huge (this conversation's JSONL is 25 MB) and a full re-parse runs
// ~150 ms — every poll, even while the user is just reading or
// navigating and the file hasn't changed. Caching by mtime makes the
// no-change polls free; a re-parse only happens when new content was
// actually appended (mtime advances).
const historyCache = new Map<
  string,
  { mtimeMs: number; activities: ActivityEntry[] }
>();

/** Test/maintenance hook: drop the parsed-history cache. */
export function clearSessionHistoryCache(): void {
  historyCache.clear();
}

// Parse the full, untruncated activity history from a session file.
// Returns entries in chronological order (oldest first).
export function parseSessionHistory(filePath: string): ActivityEntry[] {
  if (!existsSync(filePath)) return [];

  let mtimeMs: number | undefined;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch {
    mtimeMs = undefined;
  }

  if (mtimeMs !== undefined) {
    const cached = historyCache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) return cached.activities;
  }

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const lines = content.trim().split("\n").filter(Boolean);
  // mtime rides along for formats whose records carry no timestamps
  // (Kiro IDE history[]). Providers that don't need it ignore it.
  const { activities } = providerForPath(filePath).parseActivities(lines, {
    mtimeMs,
  });

  if (mtimeMs !== undefined) {
    historyCache.set(filePath, { mtimeMs, activities });
  }
  return activities;
}
