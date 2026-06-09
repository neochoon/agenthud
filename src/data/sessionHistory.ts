/**
 * Filesystem wrapper: read a session JSONL file from disk and
 * return the complete activity history in chronological order.
 *
 * Design decision:
 * - Pure I/O. All parsing logic stays in `activityParser.ts`. This
 *   split lets the parser be unit-tested with synthetic lines
 *   without touching the filesystem, while callers that already
 *   have a path can stay one-liner.
 */

import { existsSync, readFileSync } from "node:fs";
import type { ActivityEntry } from "../types/index.js";
import { parseActivitiesFromLines } from "./activityParser.js";

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
  const { activities } = parseActivitiesFromLines(lines);

  return activities;
}
