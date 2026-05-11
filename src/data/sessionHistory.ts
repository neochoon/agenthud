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
