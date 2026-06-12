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

function isKiroPath(filePath: string): boolean {
  // Match both the default `~/.kiro/sessions/` location and
  // the test/override path via `KIRO_SESSIONS_DIR`. Looking for
  // the literal segment is robust against home-directory variations.
  return filePath.includes("/.kiro/sessions/");
}

// Parse the full, untruncated activity history from a JSONL file.
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
  const provider = isKiroPath(filePath) ? kiroProvider : claudeProvider;
  const { activities } = provider.parseActivities(lines);

  return activities;
}
