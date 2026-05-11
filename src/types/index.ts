// Session status
export type SessionStatus = "running" | "idle" | "done";

// A single Claude session node (top-level or sub-agent)
export interface SessionNode {
  id: string;               // UUID from JSONL filename (without .jsonl)
  filePath: string;         // absolute path to .jsonl file
  projectPath: string;      // decoded project path (e.g. /Users/neo/myproject)
  projectName: string;      // basename(projectPath)
  lastModifiedMs: number;   // file mtime in ms
  status: SessionStatus;
  modelName: string | null; // e.g. "sonnet-4.6", null if not yet known
  subAgents: SessionNode[]; // direct sub-agents of this session
}

// Full session tree returned by discoverSessions()
export interface SessionTree {
  sessions: SessionNode[];  // top-level sessions only (sub-agents are nested)
  totalCount: number;       // total including all sub-agents
  timestamp: string;        // ISO timestamp of discovery
}

// Global config (~/.agenthud/config.yaml)
export interface GlobalConfig {
  refreshIntervalMs: number;  // default: 2000
  sessionTimeoutMs: number;   // sessions older than this are "done"; default: 30 * 60 * 1000
  logDir: string;             // default: ~/.agenthud/logs
}

// Centralized icon definitions
export const ICONS = {
  User: ">",
  Response: "<",
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
  Default: "$",
} as const;

// Activity entry (single item in a session's history)
export interface ActivityEntry {
  timestamp: Date;
  type: "tool" | "response" | "user";
  icon: string;
  label: string;
  detail: string;
  count?: number;
}
