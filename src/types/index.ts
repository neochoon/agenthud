// Session status
export type SessionStatus = "hot" | "warm" | "cool" | "cold";

// A single Claude session node (top-level or sub-agent)
export interface SessionNode {
  id: string; // UUID from JSONL filename (without .jsonl)
  hideKey: string; // "projectName/uuid" — used for hiddenSessions/hiddenSubAgents config
  filePath: string; // absolute path to .jsonl file
  projectPath: string; // decoded project path (e.g. /Users/neo/myproject)
  projectName: string; // basename(projectPath)
  lastModifiedMs: number; // file mtime in ms
  status: SessionStatus;
  modelName: string | null; // e.g. "sonnet-4.6", null if not yet known
  subAgents: SessionNode[]; // direct sub-agents of this session
  agentId?: string; // short agent ID from JSONL (sub-agents only)
  taskDescription?: string; // extracted task summary from first message (sub-agents only)
}

// Full session tree returned by discoverSessions()
export interface SessionTree {
  sessions: SessionNode[]; // top-level sessions only (sub-agents are nested)
  totalCount: number; // total including all sub-agents
  timestamp: string; // ISO timestamp of discovery
}

// Global config (~/.agenthud/config.yaml)
export interface GlobalConfig {
  refreshIntervalMs: number; // default: 2000
  logDir: string; // default: ~/.agenthud/logs
  hiddenSessions: string[];
  hiddenSubAgents: string[];
}

// Centralized icon definitions
export const ICONS = {
  User: ">",
  Response: "<",
  Thinking: "…",
  Edit: "~",
  Write: "~",
  Read: "○",
  Bash: "$",
  Glob: "*",
  Grep: "*",
  WebFetch: "@",
  WebSearch: "@",
  Task: "»",
  TodoWrite: "~",
  AskUserQuestion: "?",
  Commit: "◆",
  Default: "$",
} as const;

// Activity entry (single item in a session's history)
export interface ActivityEntry {
  timestamp: Date;
  type: "tool" | "response" | "user" | "thinking" | "commit";
  icon: string;
  label: string;
  detail: string;
  count?: number;
}
