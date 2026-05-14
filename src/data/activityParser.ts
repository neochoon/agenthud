import { basename } from "node:path";
import type { ActivityEntry } from "../types/index.js";
import { ICONS } from "../types/index.js";

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function parseModelName(modelId: string): string {
  const opusMatch = modelId.match(/claude-opus-(\d+)-(\d+)/);
  if (opusMatch) return `opus-${opusMatch[1]}.${opusMatch[2]}`;

  const sonnetMatch = modelId.match(/claude-sonnet-(\d+)/);
  if (sonnetMatch) return `sonnet-${sonnetMatch[1]}`;

  const haikuMatch = modelId.match(/claude-(\d+)-(\d+)-haiku/);
  if (haikuMatch) return `haiku-${haikuMatch[1]}.${haikuMatch[2]}`;

  return modelId.replace(/-\d{8}$/, "");
}

export function getToolDetail(
  _toolName: string,
  input?: {
    command?: string;
    file_path?: string;
    pattern?: string;
    query?: string;
    description?: string;
  },
): string {
  if (!input) return "";
  if (input.command) return stripAnsi(input.command.replace(/\n/g, " "));
  if (input.file_path) return basename(input.file_path);
  if (input.pattern) return stripAnsi(input.pattern);
  if (input.query) return stripAnsi(input.query);
  if (input.description) return stripAnsi(input.description);
  return "";
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
      text?: string;
      thinking?: string;
      name?: string;
      input?: {
        command?: string;
        file_path?: string;
        pattern?: string;
        query?: string;
        description?: string;
      };
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
          detail: userText.replace(/\n/g, " "),
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
              detail: block.thinking.replace(/\n/g, " "),
            });
          } else if (block.type === "tool_use" && block.name) {
            if (block.name === "TodoWrite") continue;
            const icon =
              (ICONS as Record<string, string>)[block.name] ?? ICONS.Default;
            const detail = getToolDetail(block.name, block.input);
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
              activities.push({
                timestamp,
                type: "tool",
                icon,
                label: block.name,
                detail,
              });
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
              detail: block.text.replace(/\n/g, " "),
            });
          }
        }
      }
    }
  }

  return { activities, tokenCount, modelName, sessionStartTime };
}
