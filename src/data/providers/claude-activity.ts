/**
 * Parse Claude Code session JSONL lines into typed `ActivityEntry[]`:
 * user prompts, assistant responses, thinking blocks, tool calls
 * (with their results), and token usage.
 *
 * Design decisions:
 * - Two-pass parser. The first pass walks every line to build a
 *   `tool_use_id → tool_result` map; the second pass walks again
 *   to build the activity timeline. A tool_result lands in a
 *   *later* JSONL entry than its tool_use, so the lookahead has
 *   to happen up front — otherwise we'd attach the result to the
 *   next tool call, not the current one.
 * - Adjacent identical activities (same `label + detail`) are
 *   collapsed into a single entry with a `count` field rather
 *   than rendered as separate rows. Keeps `"Edit foo.ts ×3"`
 *   instead of three Edit lines for a rapid back-to-back retry.
 * - `TodoWrite` is silently dropped — surfaced only via task
 *   status changes (`TaskUpdate`), not as a row of its own.
 *
 * Gotchas:
 * - `entry.toolUseResult` lives on the *user* entry that contains
 *   the tool_result content block; the entry's `message.content`
 *   array is what we match `tool_use_id` against.
 * - Model name parsing keys off hard-coded patterns
 *   (`claude-opus-X-Y`, `claude-sonnet-X`, `claude-X-Y-haiku`).
 *   New model families need new patterns added here.
 */

import type { ActivityEntry } from "../../types/index.js";
import { ICONS } from "../../types/index.js";
import type { ToolInput, ToolUseResult } from "../toolDetails.js";
import {
  buildToolDetailBody,
  getToolDetail,
  summarizeToolDetail,
} from "../toolDetails.js";

export { getToolDetail };

export function parseModelName(modelId: string): string {
  const opusMatch = modelId.match(/claude-opus-(\d+)-(\d+)/);
  if (opusMatch) return `opus-${opusMatch[1]}.${opusMatch[2]}`;

  const sonnetMatch = modelId.match(/claude-sonnet-(\d+)/);
  if (sonnetMatch) return `sonnet-${sonnetMatch[1]}`;

  const haikuMatch = modelId.match(/claude-(\d+)-(\d+)-haiku/);
  if (haikuMatch) return `haiku-${haikuMatch[1]}.${haikuMatch[2]}`;

  // Mythos-class tier (Claude 5 family): fable / mythos. Minor
  // version is optional — `claude-fable-5` → `fable-5`,
  // `claude-fable-5-1-20260601` → `fable-5.1`. The date guard
  // (\d{8}) keeps a date segment from being misread as a minor.
  const mythosMatch = modelId.match(
    /claude-(fable|mythos)-(\d+)(?:-(\d{1,3}))?(?=-\d{8}|$)/,
  );
  if (mythosMatch) {
    const minor = mythosMatch[3] ? `.${mythosMatch[3]}` : "";
    return `${mythosMatch[1]}-${mythosMatch[2]}${minor}`;
  }

  return modelId.replace(/-\d{8}$/, "");
}

interface ParseResult {
  activities: ActivityEntry[];
  tokenCount: number;
  modelName: string | null;
  sessionStartTime: Date | null;
}

interface JsonlAssistantEntry {
  type: "assistant";
  message: {
    model?: string;
    content: Array<{
      type: string;
      id?: string;
      text?: string;
      thinking?: string;
      name?: string;
      input?: ToolInput;
    }>;
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens?: number;
    };
  };
  timestamp: string;
}

interface JsonlUserEntry {
  type: "user";
  message: { role: string; content: string | unknown[] };
  timestamp: string;
}

export function parseActivitiesFromLines(lines: string[]): ParseResult {
  const activities: ActivityEntry[] = [];
  let tokenCount = 0;
  let modelName: string | null = null;
  let sessionStartTime: Date | null = null;

  // Pre-pass: map tool_use_id → its result. A tool_result lands in a *later*
  // JSONL entry than its tool_use, so we need full lookahead before the main
  // pass below — hence the second walk over `lines`. Claude Code emits exactly
  // one tool_result per user entry (even for parallel tool calls each result
  // is its own entry), so the entry's single `toolUseResult` covers it.
  const resultsById = new Map<string, ToolUseResult>();
  for (const line of lines) {
    let entry: {
      type?: string;
      toolUseResult?: unknown;
      message?: { content?: unknown };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "user") continue;
    const tur = entry.toolUseResult;
    if (!tur || typeof tur !== "object") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content as Array<{ type?: string; tool_use_id?: string }>) {
      if (b?.type === "tool_result" && typeof b.tool_use_id === "string") {
        resultsById.set(b.tool_use_id, tur as ToolUseResult);
      }
    }
  }

  for (const line of lines) {
    let entry: { type: string; timestamp?: string };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();

    if (!sessionStartTime && entry.timestamp) {
      sessionStartTime = timestamp;
    }

    if (entry.type === "user") {
      const userEntry = entry as JsonlUserEntry;
      const msgContent = userEntry.message?.content;
      let userText = "";
      if (typeof msgContent === "string") {
        userText = msgContent;
      } else if (Array.isArray(msgContent)) {
        const textBlock = (
          msgContent as Array<{ type: string; text?: string }>
        ).find((c) => c.type === "text" && c.text);
        if (textBlock?.text) userText = textBlock.text;
      }
      if (userText) {
        activities.push({
          timestamp,
          type: "user",
          icon: ICONS.User,
          label: "User",
          detail: userText,
        });
      }
    }

    if (entry.type === "assistant") {
      const assistantEntry = entry as JsonlAssistantEntry;

      if (assistantEntry.message?.model && !modelName) {
        modelName = parseModelName(assistantEntry.message.model);
      }

      const usage = assistantEntry.message?.usage;
      if (usage) {
        tokenCount +=
          (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.output_tokens ?? 0);
      }

      const content = assistantEntry.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "thinking" && block.thinking) {
            activities.push({
              timestamp,
              type: "thinking",
              icon: ICONS.Thinking,
              label: "Thinking",
              detail: block.thinking,
            });
          } else if (block.type === "tool_use" && block.name) {
            if (block.name === "TodoWrite") continue;
            const icon =
              (ICONS as Record<string, string>)[block.name] ?? ICONS.Default;
            const result = block.id ? resultsById.get(block.id) : undefined;
            const detail = summarizeToolDetail(block.name, block.input, result);
            const body = buildToolDetailBody(block.name, block.input, result);
            const last = activities[activities.length - 1];
            if (
              last &&
              last.type === "tool" &&
              last.label === block.name &&
              last.detail === detail
            ) {
              last.count = (last.count ?? 1) + 1;
              last.timestamp = timestamp;
            } else {
              const entry: ActivityEntry = {
                timestamp,
                type: "tool",
                icon,
                label: block.name,
                detail,
              };
              if (body) {
                entry.detailBody = body.text;
                entry.detailKind = body.kind;
                if (body.numbered) entry.detailNumbered = true;
              }
              activities.push(entry);
            }
          } else if (
            block.type === "text" &&
            block.text &&
            block.text.length > 10
          ) {
            activities.push({
              timestamp,
              type: "response",
              icon: ICONS.Response,
              label: "Response",
              detail: block.text,
            });
          }
        }
      }
    }
  }

  return { activities, tokenCount, modelName, sessionStartTime };
}
