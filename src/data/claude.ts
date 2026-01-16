import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
  type ActivityEntry,
  type ClaudeData,
  type ClaudeSessionState,
  type ClaudeSessionStatus,
  ICONS,
  type TodoItem,
} from "../types/index.js";
import { THIRTY_SECONDS_MS } from "../ui/constants.js";

// Strip ANSI escape codes from text
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

// Re-export types for backwards compatibility
export type {
  ClaudeSessionStatus,
  ActivityEntry,
  TodoItem,
  ClaudeSessionState,
  ClaudeData,
};

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
      input?: {
        command?: string;
        file_path?: string;
        pattern?: string;
        query?: string;
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

interface JsonlSystemEntry {
  type: "system";
  subtype?: string;
  timestamp: string;
}

type JsonlEntry =
  | JsonlUserEntry
  | JsonlAssistantEntry
  | JsonlSystemEntry
  | { type: string };

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
export function findActiveSession(
  sessionDir: string,
  sessionTimeout: number,
): string | null {
  if (!existsSync(sessionDir)) {
    return null;
  }

  const files = readdirSync(sessionDir) as string[];
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

  if (jsonlFiles.length === 0) {
    return null;
  }

  let latestFile: string | null = null;
  let latestMtime = 0;
  let latestSize = 0;

  for (const file of jsonlFiles) {
    const filePath = join(sessionDir, file);
    const stat = statSync(filePath);
    // Prefer newer files, or larger files when mtime is equal
    if (
      stat.mtimeMs > latestMtime ||
      (stat.mtimeMs === latestMtime && stat.size > latestSize)
    ) {
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

function getToolDetail(
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

  if (input.command) {
    return stripAnsi(input.command.replace(/\n/g, " "));
  }
  if (input.file_path) {
    return basename(input.file_path);
  }
  if (input.pattern) {
    return stripAnsi(input.pattern);
  }
  if (input.query) {
    return stripAnsi(input.query);
  }
  if (input.description) {
    return stripAnsi(input.description);
  }
  return "";
}

const MAX_SUB_ACTIVITIES = 3;

interface SubagentFileInfo {
  filePath: string;
  mtimeMs: number;
}

/**
 * Get sorted list of subagent files (most recent first)
 */
function getSubagentFiles(sessionFile: string): SubagentFileInfo[] {
  const subagentsDir = join(sessionFile.replace(/\.jsonl$/, ""), "subagents");

  if (!existsSync(subagentsDir)) {
    return [];
  }

  try {
    const files = (readdirSync(subagentsDir) as string[]).filter((f) =>
      f.endsWith(".jsonl"),
    );

    const fileInfos: SubagentFileInfo[] = files.map((file) => {
      const filePath = join(subagentsDir, file);
      const stat = statSync(filePath);
      return { filePath, mtimeMs: stat.mtimeMs };
    });

    // Sort by modification time descending (most recent first)
    fileInfos.sort((a, b) => b.mtimeMs - a.mtimeMs);

    return fileInfos;
  } catch {
    return [];
  }
}

/**
 * Parse activities from a single subagent file
 */
function parseSubagentFile(filePath: string): {
  activities: ActivityEntry[];
  totalCount: number;
} {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const allActivities: ActivityEntry[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "assistant" && entry.message?.content) {
          const messageContent = entry.message.content;
          if (Array.isArray(messageContent)) {
            for (const block of messageContent) {
              if (block.type === "tool_use" && block.name) {
                const toolName = block.name;
                // Skip TodoWrite in subagent too
                if (toolName === "TodoWrite") continue;

                const icon =
                  (ICONS as Record<string, string>)[toolName] || ICONS.Default;
                const detail = getToolDetail(toolName, block.input);
                const timestamp = entry.timestamp
                  ? new Date(entry.timestamp)
                  : new Date();

                allActivities.push({
                  timestamp,
                  type: "tool",
                  icon,
                  label: toolName,
                  detail,
                });
              }
            }
          }
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    // Sort by timestamp descending (most recent first)
    allActivities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return {
      activities: allActivities.slice(0, MAX_SUB_ACTIVITIES),
      totalCount: allActivities.length,
    };
  } catch {
    return { activities: [], totalCount: 0 };
  }
}

/**
 * Parse session state from a JSONL session file
 */
export function parseSessionState(
  sessionFile: string,
  maxActivities: number = DEFAULT_MAX_ACTIVITIES,
): ClaudeSessionState {
  const defaultState: ClaudeSessionState = {
    status: "none",
    activities: [],
    tokenCount: 0,
    sessionStartTime: null,
    todos: null,
  };

  if (!existsSync(sessionFile)) {
    return defaultState;
  }

  let content: string;
  try {
    content = readFileSync(sessionFile, "utf-8");
  } catch {
    return defaultState;
  }

  const lines = content.trim().split("\n").filter(Boolean);
  if (lines.length === 0) {
    return defaultState;
  }

  // Extract session start time from first entry with a valid timestamp
  // Skip summary/file-history-snapshot entries at the beginning
  let sessionStartTime: Date | null = null;
  for (let i = 0; i < Math.min(50, lines.length); i++) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.timestamp && typeof entry.timestamp === "string") {
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
              typeof c === "object" &&
              c !== null &&
              c.type === "text" &&
              typeof c.text === "string",
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

              const icon =
                (ICONS as Record<string, string>)[toolName] || ICONS.Default;
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
                const activity: ActivityEntry = {
                  timestamp: lastTimestamp || new Date(),
                  type: "tool",
                  icon,
                  label: toolName,
                  detail,
                };

                activities.push(activity);
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
  const subagentsDir = join(sessionFile.replace(/\.jsonl$/, ""), "subagents");
  if (existsSync(subagentsDir)) {
    try {
      const subagentFiles = (readdirSync(subagentsDir) as string[]).filter(
        (f) => f.endsWith(".jsonl"),
      );
      for (const file of subagentFiles) {
        const filePath = join(subagentsDir, file);
        try {
          const subContent = readFileSync(filePath, "utf-8");
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

  // Get the final activities (most recent first)
  const finalActivities = activities.slice(-maxActivities).reverse();

  // Post-process: Add subagent activities to Task entries
  // Each Task gets its corresponding subagent file (matched by recency order)
  const subagentFiles = getSubagentFiles(sessionFile);
  let taskIndex = 0;
  for (const activity of finalActivities) {
    if (activity.label === "Task" && taskIndex < subagentFiles.length) {
      const subagentData = parseSubagentFile(subagentFiles[taskIndex].filePath);
      if (subagentData.totalCount > 0) {
        activity.subActivities = subagentData.activities;
        activity.subActivityCount = subagentData.totalCount;
      }
      taskIndex++;
    }
  }

  return {
    status,
    activities: finalActivities,
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
  sessionTimeout: number = DEFAULT_SESSION_TIMEOUT,
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
    const hasSession = existsSync(sessionDir);
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
