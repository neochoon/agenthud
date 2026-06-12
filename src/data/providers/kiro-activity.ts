/**
 * Kiro CLI JSONL → `ActivityEntry[]` parser. Kiro records have shape
 * `{version, kind, data}` where `kind ∈ "Prompt" | "AssistantMessage"
 * | "ToolResults"`, which is structurally different from Claude's
 * `{type, uuid, message}` records. This file owns the translation.
 *
 * Mapping rules:
 * - `Prompt` → user activity (`type: "user"`). `data.content[]`
 *   carries the prompt; the first `{kind: "text"}` block is the
 *   prompt body.
 * - `AssistantMessage` → fan out:
 *   - Each `{kind: "text"}` content becomes a `response` entry.
 *   - Each `{kind: "toolUse"}` content becomes a `tool` entry with
 *     name + summarized input.
 * - `ToolResults` → currently swallowed. The tool entry produced
 *   for the preceding `toolUse` already shows the call; surfacing
 *   the result body is a follow-up (would need symbol-id matching
 *   between toolUseId and the prior entry's metadata).
 *
 * Timestamp source:
 * - `Prompt.data.meta.timestamp` is a unix seconds value (verified
 *   on real Kiro fixtures). Multiply by 1000.
 * - `AssistantMessage` records often omit a timestamp; fall back to
 *   the previous activity's timestamp (linear in time, JSONL is
 *   append-only).
 *
 * Gotcha:
 * - The `tool_use_purpose` field that Kiro injects into tool inputs
 *   is metadata for its UI, not user-visible. Strip it before
 *   summarizing so it doesn't pollute the activity label.
 */

import type { ActivityEntry } from "../../types/index.js";
import { ICONS } from "../../types/index.js";
import { canonicalKiroToolLabel } from "./toolLabels.js";
import type { ParseResult } from "./types.js";

interface KiroContentBlock {
  kind?: string;
  data?: unknown;
}

interface KiroToolUseData {
  toolUseId?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface KiroRecord {
  version?: string;
  kind?: string;
  data?: {
    message_id?: string;
    content?: KiroContentBlock[];
    meta?: { timestamp?: number };
  };
}

function iconForCanonicalLabel(label: string): string {
  // Canonical labels match the keys of the shared ICONS table, so
  // this is a straight lookup. Anything we don't recognize falls
  // back to ICONS.Default (still a printable glyph, not blank).
  const known = (ICONS as Record<string, string>)[label];
  return known ?? ICONS.Default;
}

function summarizeToolInput(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const filtered = { ...input };
  delete filtered.__tool_use_purpose;

  // Common keys we'd want to surface inline. Same heuristic as the
  // Claude provider but kept Kiro-specific for now — easy enough to
  // generalize later if both diverge cleanly.
  const path = filtered.path ?? filtered.file_path;
  if (typeof path === "string") return path;
  const cmd = filtered.command ?? filtered.cmd;
  if (typeof cmd === "string") return cmd;
  const pattern = filtered.pattern ?? filtered.query;
  if (typeof pattern === "string") return pattern;
  const url = filtered.url;
  if (typeof url === "string") return url;
  // Operations array (Kiro `read` tool uses this).
  if (Array.isArray(filtered.operations) && filtered.operations.length > 0) {
    const op = filtered.operations[0] as Record<string, unknown>;
    const p = op?.path;
    if (typeof p === "string") return p;
  }
  return "";
}

export function parseKiroActivitiesFromLines(lines: string[]): ParseResult {
  const activities: ActivityEntry[] = [];
  let modelName: string | null = null;
  let sessionStartTime: Date | null = null;
  let lastTimestamp: Date | null = null;
  let tokenCount = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry: KiroRecord;
    try {
      entry = JSON.parse(line) as KiroRecord;
    } catch {
      continue;
    }
    const kind = entry.kind;
    const data = entry.data;
    if (!kind || !data) continue;

    // Resolve timestamp: Prompt records have unix-seconds meta.timestamp.
    let ts: Date;
    const metaTs = data.meta?.timestamp;
    if (typeof metaTs === "number" && Number.isFinite(metaTs)) {
      ts = new Date(metaTs * 1000);
    } else if (lastTimestamp) {
      ts = lastTimestamp;
    } else {
      ts = new Date(0);
    }
    if (!sessionStartTime) sessionStartTime = ts;
    lastTimestamp = ts;

    const content = Array.isArray(data.content) ? data.content : [];

    if (kind === "Prompt") {
      const text = content.find((b) => b.kind === "text")?.data;
      if (typeof text === "string" && text.trim().length > 0) {
        activities.push({
          timestamp: ts,
          type: "user",
          icon: ICONS.User,
          label: "User",
          detail: text.split("\n")[0] ?? "",
          detailBody: text,
        });
      }
    } else if (kind === "AssistantMessage") {
      for (const block of content) {
        if (block.kind === "text") {
          const text = block.data;
          if (typeof text !== "string" || text.trim().length === 0) continue;
          activities.push({
            timestamp: ts,
            type: "response",
            icon: ICONS.Response,
            label: "Response",
            detail: text.split("\n")[0] ?? "",
            detailBody: text,
          });
        } else if (block.kind === "toolUse") {
          const tu = block.data as KiroToolUseData;
          const rawName = typeof tu?.name === "string" ? tu.name : "tool";
          const label = canonicalKiroToolLabel(rawName);
          const summary = summarizeToolInput(tu?.input);
          activities.push({
            timestamp: ts,
            type: "tool",
            icon: iconForCanonicalLabel(label),
            label,
            detail: summary,
          });
        }
      }
    }
    // ToolResults: deliberately skipped for now — the tool entry
    // produced above already names the call. Surfacing the result
    // body needs toolUseId ↔ entry linkage which is a follow-up.
  }

  return { activities, tokenCount, modelName, sessionStartTime };
}
