import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
  readdirSync as nodeReaddirSync,
  statSync as nodeStatSync,
} from "fs";
import { homedir } from "os";
import { join, basename } from "path";
import {
  ICONS,
  type ClaudeSessionStatus,
  type ActivityEntry,
  type TodoItem,
  type ClaudeSessionState,
  type ClaudeData,
} from "../types/index.js";
import { THIRTY_SECONDS_MS } from "../ui/constants.js";

// Re-export types for backwards compatibility
export type { ClaudeSessionStatus, ActivityEntry, TodoItem, ClaudeSessionState, ClaudeData };

export interface FsMock {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string) => string;
  readdirSync: (path: string) => string[];
  statSync: (path: string) => { mtimeMs: number; size: number };
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

interface JsonlUserEntry {
  type: "user";
  message: { role: string; content: string | unknown[] };
  timestamp: string;
  toolUseResult?: {
    newTodos?: Array<{
      content: string;
      status: "pending" | "in_progress" | "completed";
      activeForm: string;
    }>;
  };
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
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens?: number;
    };
  };
  timestamp: string;
}

interface JsonlSystemEntry {
  type: "system";
  subtype?: string;
  timestamp: string;
}

type JsonlEntry = JsonlUserEntry | JsonlAssistantEntry | JsonlSystemEntry | { type: string };

const MAX_LINES_TO_SCAN = 200;
const DEFAULT_MAX_ACTIVITIES = 10;
/**
 * Convert project path to Claude session directory path
 * e.g., /Users/neochoon/agenthud → ~/.claude/projects/-Users-neochoon-agenthud
 * e.g., C:\Users\test\project → ~/.claude/projects/-C--Users-test-project (Windows)
 */
export function getClaudeSessionPath(projectPath: string): string {
  // Replace both forward and backslashes for cross-platform support
  const encoded = projectPath.replace(/[/\\]/g, "-");
  return join(homedir(), ".claude", "projects", encoded);
}

/**
 * Find the most recently active session file in the session directory
 * Returns null if no active session exists within the timeout period
 * When multiple files have the same mtime, prefer the larger file (more content = likely active)
 */
export function findActiveSession(sessionDir: string, sessionTimeout: number): string | null {
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
  let latestSize = 0;

  for (const file of jsonlFiles) {
    const filePath = join(sessionDir, file);
    const stat = fs.statSync(filePath);
    // Prefer newer files, or larger files when mtime is equal
    if (stat.mtimeMs > latestMtime || (stat.mtimeMs === latestMtime && stat.size > latestSize)) {
      latestMtime = stat.mtimeMs;
      latestSize = stat.size;
      latestFile = file;
    }
  }

  // Only return if modified within sessionTimeout
  const cutoff = Date.now() - sessionTimeout;
  if (latestMtime > cutoff && latestFile) {
    return join(sessionDir, latestFile);
  }

  return null;
}

function getToolDetail(toolName: string, input?: { command?: string; file_path?: string; pattern?: string; query?: string; description?: string }): string {
  if (!input) return "";

  if (input.command) {
    return input.command.replace(/\n/g, " ");
  }
  if (input.file_path) {
    return basename(input.file_path);
  }
  if (input.pattern) {
    return input.pattern;
  }
  if (input.query) {
    return input.query;
  }
  if (input.description) {
    return input.description;
  }
  return "";
}

/**
 * Parse session state from a JSONL session file
 */
export function parseSessionState(sessionFile: string, maxActivities: number = DEFAULT_MAX_ACTIVITIES): ClaudeSessionState {
  const defaultState: ClaudeSessionState = {
    status: "none",
    activities: [],
    tokenCount: 0,
    sessionStartTime: null,
    todos: null,
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

  // Extract session start time from first few lines
  let sessionStartTime: Date | null = null;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.timestamp) {
        sessionStartTime = new Date(entry.timestamp);
        break;
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  const activities: ActivityEntry[] = [];
  let tokenCount = 0;
  let lastTimestamp: Date | null = null;
  let lastType: "user" | "tool" | "response" | "stop" | null = null;
  let todos: TodoItem[] | null = null;

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
            icon: ICONS.User,
            label: "User",
            detail: userText.replace(/\n/g, " "),
          });
        }

        // Extract todos from toolUseResult (keep latest)
        if (userEntry.toolUseResult?.newTodos) {
          todos = userEntry.toolUseResult.newTodos.map((t) => ({
            content: t.content,
            status: t.status,
            activeForm: t.activeForm,
          }));
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

              // Skip TodoWrite - already shown in Todo section
              if (toolName === "TodoWrite") {
                lastType = "tool";
                continue;
              }

              const icon = (ICONS as Record<string, string>)[toolName] || ICONS.Default;
              const detail = getToolDetail(toolName, block.input);

              // Check if this is the same as the last activity (aggregate consecutive same operations)
              const lastActivity = activities[activities.length - 1];
              if (
                lastActivity &&
                lastActivity.type === "tool" &&
                lastActivity.label === toolName &&
                lastActivity.detail === detail
              ) {
                // Increment count on existing entry
                lastActivity.count = (lastActivity.count || 1) + 1;
                lastActivity.timestamp = lastTimestamp || new Date();
              } else {
                activities.push({
                  timestamp: lastTimestamp || new Date(),
                  type: "tool",
                  icon,
                  label: toolName,
                  detail,
                });
              }
              lastType = "tool";
            } else if (block.type === "text" && block.text) {
              // Only add text response if it's substantial
              if (block.text.length > 10) {
                activities.push({
                  timestamp: lastTimestamp || new Date(),
                  type: "response",
                  icon: ICONS.Response,
                  label: "Response",
                  detail: block.text.replace(/\n/g, " "),
                });
                lastType = "response";
              }
            }
          }
        }

        // Accumulate token count (input + cache_read + output)
        const usage = assistantEntry.message?.usage;
        if (usage) {
          tokenCount +=
            (usage.input_tokens || 0) +
            (usage.cache_read_input_tokens || 0) +
            (usage.output_tokens || 0);
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
    } else {
      // More than 30 seconds but within sessionTimeout
      status = "completed";
    }
  }

  // Add subagent tokens if subagents folder exists
  // Subagents folder path: {session-file-without-.jsonl}/subagents/
  const subagentsDir = sessionFile.replace(/\.jsonl$/, "") + "/subagents";
  if (fs.existsSync(subagentsDir)) {
    try {
      const subagentFiles = fs.readdirSync(subagentsDir).filter((f) => f.endsWith(".jsonl"));
      for (const file of subagentFiles) {
        const filePath = join(subagentsDir, file);
        try {
          const subContent = fs.readFileSync(filePath);
          const subLines = subContent.trim().split("\n").filter(Boolean);
          for (const line of subLines) {
            try {
              const entry = JSON.parse(line);
              if (entry.type === "assistant" && entry.message?.usage) {
                const usage = entry.message.usage;
                tokenCount +=
                  (usage.input_tokens || 0) +
                  (usage.cache_read_input_tokens || 0) +
                  (usage.output_tokens || 0);
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Ignore errors reading subagents directory
    }
  }

  // Return activities in reverse order (most recent first), limited to maxActivities
  return {
    status,
    activities: activities.slice(-maxActivities).reverse(),
    tokenCount,
    sessionStartTime,
    todos,
  };
}

const DEFAULT_SESSION_TIMEOUT = 60 * 60 * 1000; // 60 minutes

/**
 * Get Claude session data for a project
 */
export function getClaudeData(
  projectPath: string,
  maxActivities?: number,
  sessionTimeout: number = DEFAULT_SESSION_TIMEOUT
): ClaudeData {
  const defaultState: ClaudeSessionState = {
    status: "none",
    activities: [],
    tokenCount: 0,
    sessionStartTime: null,
    todos: null,
  };

  try {
    const sessionDir = getClaudeSessionPath(projectPath);
    const hasSession = fs.existsSync(sessionDir);
    const sessionFile = findActiveSession(sessionDir, sessionTimeout);

    if (!sessionFile) {
      return {
        state: defaultState,
        hasSession,
        timestamp: new Date().toISOString(),
      };
    }

    const state = parseSessionState(sessionFile, maxActivities);
    return {
      state,
      hasSession: true,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      state: defaultState,
      hasSession: false,
      error: message,
      timestamp: new Date().toISOString(),
    };
  }
}
