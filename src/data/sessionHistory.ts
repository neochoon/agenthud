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

import { existsSync, readFileSync } from "node:fs";
import type { ActivityEntry } from "../types/index.js";
import { claudeProvider } from "./providers/claude.js";
import { kiroProvider } from "./providers/kiro.js";
import { kiroIdeProvider } from "./providers/kiro-ide.js";
import type { SessionProvider } from "./providers/types.js";

// Provider routing by path segment. Each check normalizes
// backslashes first so Windows paths match too. Order matters only
// in that Claude is the default fallback.
function providerForPath(filePath: string): SessionProvider {
  const p = filePath.replace(/\\/g, "/");
  if (p.includes("/.kiro/sessions/")) return kiroProvider;
  if (p.includes("kiro.kiroagent/workspace-sessions/")) return kiroIdeProvider;
  return claudeProvider;
}

// Parse the full, untruncated activity history from a session file.
// Returns entries in chronological order (oldest first).
export function parseSessionHistory(filePath: string): ActivityEntry[] {
  if (!existsSync(filePath)) return [];

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const lines = content.trim().split("\n").filter(Boolean);
  const { activities } = providerForPath(filePath).parseActivities(lines);

  return activities;
}
