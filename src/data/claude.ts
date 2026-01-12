import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
  readdirSync as nodeReaddirSync,
  statSync as nodeStatSync,
} from "fs";
import { homedir } from "os";
import { join, basename } from "path";

export interface FsMock {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string) => string;
  readdirSync: (path: string) => string[];
  statSync: (path: string) => { mtimeMs: number };
}

let fs: FsMock = {
  existsSync: nodeExistsSync,
  readFileSync: (path: string) => nodeReadFileSync(path, "utf-8"),
  readdirSync: (path: string) => nodeReaddirSync(path) as string[],
  statSync: nodeStatSync,
};

export function setFsMock(mock: FsMock): void {
  fs = mock;
}

export function resetFsMock(): void {
  fs = {
    existsSync: nodeExistsSync,
    readFileSync: (path: string) => nodeReadFileSync(path, "utf-8"),
    readdirSync: (path: string) => nodeReaddirSync(path) as string[],
    statSync: nodeStatSync,
  };
}

export type ClaudeSessionStatus = "running" | "completed" | "idle" | "none";

export interface ActivityEntry {
  timestamp: Date;
  type: "tool" | "response" | "user";
  icon: string;
  label: string;
  detail: string;
}

export interface ClaudeSessionState {
  status: ClaudeSessionStatus;
  activities: ActivityEntry[];
  tokenCount: number;
}

export interface ClaudeData {
  state: ClaudeSessionState;
  error?: string;
  timestamp: string;
}

interface JsonlUserEntry {
  type: "user";
  message: { role: string; content: string | unknown[] };
  timestamp: string;
}

interface JsonlAssistantEntry {
  type: "assistant";
  message: {
    content: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: { command?: string; file_path?: string; pattern?: string; query?: string };
    }>;
  };
  usage?: { output_tokens: number };
  timestamp: string;
}

interface JsonlSystemEntry {
  type: "system";
  subtype?: string;
  timestamp: string;
}

type JsonlEntry = JsonlUserEntry | JsonlAssistantEntry | JsonlSystemEntry | { type: string };

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const THIRTY_SECONDS_MS = 30 * 1000;
const MAX_LINES_TO_SCAN = 200;
const MAX_ACTIVITIES = 10;
const MAX_DETAIL_LENGTH = 45;

// Tool icons mapping
const TOOL_ICONS: Record<string, string> = {
  Edit: "✏️",
  Write: "✏️",
  Read: "📖",
  Bash: "🔧",
  Glob: "🔍",
  Grep: "🔍",
  WebFetch: "🌐",
  WebSearch: "🌐",
  Task: "📋",
  TodoWrite: "📝",
  AskUserQuestion: "❓",
};

/**
 * Convert project path to Claude session directory path
 * e.g., /Users/neochoon/agenthud → ~/.claude/projects/-Users-neochoon-agenthud
 */
export function getClaudeSessionPath(projectPath: string): string {
  const encoded = projectPath.replace(/\//g, "-");
  return join(homedir(), ".claude", "projects", encoded);
}

/**
 * Find the most recently active session file in the session directory
 * Returns null if no active session (modified within 5 minutes) exists
 */
export function findActiveSession(sessionDir: string): string | null {
  if (!fs.existsSync(sessionDir)) {
    return null;
  }

  const files = fs.readdirSync(sessionDir);
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

  if (jsonlFiles.length === 0) {
    return null;
  }

  let latestFile: string | null = null;
  let latestMtime = 0;

  for (const file of jsonlFiles) {
    const filePath = join(sessionDir, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs > latestMtime) {
      latestMtime = stat.mtimeMs;
      latestFile = file;
    }
  }

  // Only return if modified within 5 minutes
  const fiveMinutesAgo = Date.now() - FIVE_MINUTES_MS;
  if (latestMtime > fiveMinutesAgo && latestFile) {
    return join(sessionDir, latestFile);
  }

  return null;
}

/**
 * Get display width of a string (CJK/emoji = 2, others = 1)
 */
function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0) || 0;
    if (
      (code >= 0x1f300 && code <= 0x1f9ff) ||
      (code >= 0x2600 && code <= 0x26ff) ||
      (code >= 0x2700 && code <= 0x27bf) ||
      (code >= 0x1f600 && code <= 0x1f64f) ||
      (code >= 0x1f680 && code <= 0x1f6ff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x3130 && code <= 0x318f) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      width += 2;
    } else if (code !== 0xfe0f) {
      width += 1;
    }
  }
  return width;
}

function truncate(str: string, maxDisplayWidth: number): string {
  const currentWidth = getDisplayWidth(str);
  if (currentWidth <= maxDisplayWidth) return str;

  let result = "";
  let width = 0;
  for (const char of str) {
    const charWidth = getDisplayWidth(char);
    if (width + charWidth > maxDisplayWidth - 3) {
      return result + "...";
    }
    result += char;
    width += charWidth;
  }
  return result;
}

function getToolDetail(toolName: string, input?: { command?: string; file_path?: string; pattern?: string; query?: string }): string {
  if (!input) return "";

  if (input.command) {
    return truncate(input.command, MAX_DETAIL_LENGTH);
  }
  if (input.file_path) {
    // Show just the filename
    return basename(input.file_path);
  }
  if (input.pattern) {
    return truncate(input.pattern, MAX_DETAIL_LENGTH);
  }
  if (input.query) {
    return truncate(input.query, MAX_DETAIL_LENGTH);
  }
  return "";
}

/**
 * Parse session state from a JSONL session file
 */
export function parseSessionState(sessionFile: string): ClaudeSessionState {
  const defaultState: ClaudeSessionState = {
    status: "none",
    activities: [],
    tokenCount: 0,
  };

  if (!fs.existsSync(sessionFile)) {
    return defaultState;
  }

  let content: string;
  try {
    content = fs.readFileSync(sessionFile);
  } catch {
    return defaultState;
  }

  const lines = content.trim().split("\n").filter(Boolean);
  if (lines.length === 0) {
    return defaultState;
  }

  const activities: ActivityEntry[] = [];
  let tokenCount = 0;
  let lastTimestamp: Date | null = null;
  let lastType: "user" | "tool" | "response" | "stop" | null = null;

  // Parse recent lines (up to MAX_LINES_TO_SCAN)
  const recentLines = lines.slice(-MAX_LINES_TO_SCAN);

  for (const line of recentLines) {
    try {
      const entry = JSON.parse(line) as JsonlEntry;

      if (entry.type === "user") {
        const userEntry = entry as JsonlUserEntry;
        if (userEntry.timestamp) {
          lastTimestamp = new Date(userEntry.timestamp);
        }

        // Extract user message text
        const msgContent = userEntry.message?.content;
        let userText = "";
        if (typeof msgContent === "string") {
          userText = msgContent;
        } else if (Array.isArray(msgContent)) {
          const textBlock = msgContent.find(
            (c): c is { type: "text"; text: string } =>
              typeof c === "object" && c !== null && c.type === "text" && typeof c.text === "string"
          );
          if (textBlock) {
            userText = textBlock.text;
          }
        }

        // Only add if there's actual user text (not just tool results)
        if (userText) {
          activities.push({
            timestamp: lastTimestamp || new Date(),
            type: "user",
            icon: "👤",
            label: "User",
            detail: truncate(userText.replace(/\n/g, " "), MAX_DETAIL_LENGTH),
          });
        }
        lastType = "user";
      }

      if (entry.type === "assistant") {
        const assistantEntry = entry as JsonlAssistantEntry;
        if (assistantEntry.timestamp) {
          lastTimestamp = new Date(assistantEntry.timestamp);
        }

        const messageContent = assistantEntry.message?.content;
        if (Array.isArray(messageContent)) {
          for (const block of messageContent) {
            if (block.type === "tool_use") {
              const toolName = block.name || "Tool";
              const icon = TOOL_ICONS[toolName] || "🔧";
              const detail = getToolDetail(toolName, block.input);

              activities.push({
                timestamp: lastTimestamp || new Date(),
                type: "tool",
                icon,
                label: toolName,
                detail,
              });
              lastType = "tool";
            } else if (block.type === "text" && block.text) {
              // Only add text response if it's substantial
              if (block.text.length > 10) {
                activities.push({
                  timestamp: lastTimestamp || new Date(),
                  type: "response",
                  icon: "🤖",
                  label: "Response",
                  detail: truncate(block.text.replace(/\n/g, " "), MAX_DETAIL_LENGTH),
                });
                lastType = "response";
              }
            }
          }
        }

        // Accumulate token count
        if (assistantEntry.usage?.output_tokens) {
          tokenCount += assistantEntry.usage.output_tokens;
        }
      }

      if (entry.type === "system") {
        const systemEntry = entry as JsonlSystemEntry;
        if (systemEntry.subtype === "stop_hook_summary") {
          lastType = "stop";
          if (systemEntry.timestamp) {
            lastTimestamp = new Date(systemEntry.timestamp);
          }
        }
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  // Determine status based on last activity
  let status: ClaudeSessionStatus = "none";
  if (lastTimestamp) {
    const elapsed = Date.now() - lastTimestamp.getTime();
    if (elapsed < THIRTY_SECONDS_MS) {
      // Within 30 seconds
      if (lastType === "stop" || lastType === "response") {
        status = "completed";
      } else {
        status = "running";
      }
    } else if (elapsed < FIVE_MINUTES_MS) {
      // Between 30 seconds and 5 minutes
      status = "completed";
    } else {
      // More than 5 minutes
      status = "idle";
    }
  }

  // Return activities in reverse order (most recent first), limited to MAX_ACTIVITIES
  return {
    status,
    activities: activities.slice(-MAX_ACTIVITIES).reverse(),
    tokenCount,
  };
}

/**
 * Get Claude session data for a project
 */
export function getClaudeData(projectPath: string): ClaudeData {
  const defaultState: ClaudeSessionState = {
    status: "none",
    activities: [],
    tokenCount: 0,
  };

  try {
    const sessionDir = getClaudeSessionPath(projectPath);
    const sessionFile = findActiveSession(sessionDir);

    if (!sessionFile) {
      return {
        state: defaultState,
        timestamp: new Date().toISOString(),
      };
    }

    const state = parseSessionState(sessionFile);
    return {
      state,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      state: defaultState,
      error: message,
      timestamp: new Date().toISOString(),
    };
  }
}
