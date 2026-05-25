import type { LiveState } from "../types/index.js";
import { THIRTY_MINUTES_MS } from "../ui/constants.js";

interface ContentBlock {
  type?: string;
  name?: string;
}

interface ParsedEntry {
  type?: string;
  message?: { content?: unknown };
}

/**
 * Classify a session as `working` or `waiting` from the structure of its
 * JSONL tail. The tail structure is the primary signal — a long-running tool
 * leaves mtime stale while the pending tool_use still reads as `working`.
 * Returns null when the session is older than the recency window or the tail
 * yields no meaningful entry.
 */
export function detectLiveState(
  tailLines: string[],
  mtimeMs: number,
  now: number,
): LiveState | null {
  if (now - mtimeMs > THIRTY_MINUTES_MS) return null;

  for (let i = tailLines.length - 1; i >= 0; i--) {
    const line = tailLines[i];
    if (!line || !line.trim()) continue;

    let entry: ParsedEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "assistant") {
      const content = entry.message?.content;
      const blocks: ContentBlock[] = Array.isArray(content) ? content : [];
      const toolUses = blocks.filter((b) => b && b.type === "tool_use");
      if (toolUses.length === 0) return "waiting"; // turn yielded (text only)
      if (toolUses.some((b) => b.name === "AskUserQuestion")) return "waiting";
      return "working"; // pending tool_use
    }

    if (entry.type === "user") {
      return "working"; // prompt or tool_result → Claude is processing
    }
    // system / other → keep scanning backwards
  }

  return null;
}
