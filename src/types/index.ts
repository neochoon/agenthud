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
  nonInteractive: boolean; // true when entrypoint === "sdk-cli"
  firstUserPrompt: string | null; // First natural-language user message (system messages skipped)
}

// Project node grouping sessions
export interface ProjectNode {
  name: string; // basename of projectPath
  projectPath: string; // decoded full path
  sessions: SessionNode[]; // sorted: interactive→non-interactive, then status→mtime
  hotness: SessionStatus; // hottest session's status
}

// Full session tree returned by discoverSessions()
export interface SessionTree {
  projects: ProjectNode[]; // active projects (hotness !== "cold")
  coldProjects: ProjectNode[]; // projects where all sessions are cold
  totalCount: number; // total sessions across both arrays + sub-agents
  timestamp: string; // ISO timestamp of discovery
}

// Global config (~/.agenthud/config.yaml)
export interface GlobalConfig {
  refreshIntervalMs: number; // default: 2000
  logDir: string; // default: ~/.agenthud/logs
  hiddenSessions: string[];
  hiddenSubAgents: string[];
  filterPresets: string[][]; // [] = all; default: [[], ["response"], ["commit"]]
  hiddenProjects: string[]; // by projectName
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
