import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
  readdirSync as nodeReaddirSync,
  statSync as nodeStatSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

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

export interface ClaudeSessionState {
  status: ClaudeSessionStatus;
  lastUserMessage: string | null;
  currentAction: string | null;
  lastTimestamp: Date | null;
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
      input?: { command?: string; file_path?: string };
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
const MAX_LINES_FOR_STATUS = 50;
const MAX_LINES_FOR_USER_MESSAGE = 500; // Scan more lines to find user message
const MAX_ACTION_LENGTH = 50;

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

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/**
 * Parse session state from a JSONL session file
 */
export function parseSessionState(sessionFile: string): ClaudeSessionState {
  const defaultState: ClaudeSessionState = {
    status: "none",
    lastUserMessage: null,
    currentAction: null,
    lastTimestamp: null,
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

  let lastUserMessage: string | null = null;
  let currentAction: string | null = null;
  let lastTimestamp: Date | null = null;
  let tokenCount = 0;
  let lastType: "user" | "tool" | "response" | "stop" | null = null;

  // First pass: scan backwards to find the most recent user message (up to 500 lines)
  const linesForUserMessage = lines.slice(-MAX_LINES_FOR_USER_MESSAGE);
  for (let i = linesForUserMessage.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(linesForUserMessage[i]) as JsonlEntry;
      if (entry.type === "user") {
        const userEntry = entry as JsonlUserEntry;
        const msgContent = userEntry.message?.content;
        if (typeof msgContent === "string") {
          lastUserMessage = msgContent;
          break;
        } else if (Array.isArray(msgContent)) {
          const textBlock = msgContent.find(
            (c): c is { type: "text"; text: string } =>
              typeof c === "object" && c !== null && c.type === "text" && typeof c.text === "string"
          );
          if (textBlock) {
            lastUserMessage = textBlock.text;
            break;
          }
        }
      }
    } catch {
      // Skip invalid JSON
    }
  }

  // Second pass: parse recent lines for status, action, tokens (50 lines for performance)
  const recentLines = lines.slice(-MAX_LINES_FOR_STATUS);
  for (const line of recentLines) {
    try {
      const entry = JSON.parse(line) as JsonlEntry;

      if (entry.type === "user") {
        const userEntry = entry as JsonlUserEntry;
        if (userEntry.timestamp) {
          lastTimestamp = new Date(userEntry.timestamp);
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
          // Check for tool_use
          const toolUse = messageContent.find((c) => c.type === "tool_use");
          if (toolUse) {
            const toolInput =
              toolUse.input?.command || toolUse.input?.file_path || "";
            currentAction = `${toolUse.name}: ${truncate(toolInput, MAX_ACTION_LENGTH)}`;
            lastType = "tool";
          } else {
            currentAction = null;
            lastType = "response";
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

  return {
    status,
    lastUserMessage,
    currentAction,
    lastTimestamp,
    tokenCount,
  };
}

/**
 * Get Claude session data for a project
 */
export function getClaudeData(projectPath: string): ClaudeData {
  const defaultState: ClaudeSessionState = {
    status: "none",
    lastUserMessage: null,
    currentAction: null,
    lastTimestamp: null,
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
