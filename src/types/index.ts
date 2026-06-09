/**
 * Shared TypeScript types and constants: session tree
 * (`SessionNode`, `ProjectNode`, `SessionTree`), activity entries
 * (`ActivityEntry`), config (`GlobalConfig`, `ReportConfig`,
 * `SummaryConfig`), and the `ICONS` table.
 *
 * Design decision:
 * - `ICONS` lives here, not under `src/ui/`, so the data layer
 *   (`activityParser`, `reportGenerator`) can use it without
 *   importing UI. Icons are an attribute of the activity, not of
 *   the renderer. Keeps the dep graph clean (data → types →
 *   nothing).
 */

// Session status
export type SessionStatus = "hot" | "warm" | "cool" | "cold";

// Live state derived from the JSONL tail (orthogonal to time-based status)
export type LiveState = "working" | "waiting";

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
  liveState: LiveState | null; // working/waiting from JSONL tail; null = fall back to time-based status
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
/**
 * Defaults shared by `agenthud report` and (via inheritance) by the
 * report half of `agenthud summary`. CLI flags override these per
 * invocation; this struct is what the user puts in
 * `~/.agenthud/config.yaml` under the `report:` key.
 */
export interface ReportConfig {
  include: string[]; // activity types to include
  detailLimit: number; // max chars per activity detail (0 = unlimited)
  withGit: boolean; // merge git commits into the timeline
  format: "markdown" | "json"; // output format
}

/**
 * Per-config overrides for `agenthud summary`. Any field left
 * undefined falls back to the matching `ReportConfig` field — so the
 * user can pin one shape under `report:` and have summary inherit it.
 * The `model` key is summary-specific (no equivalent on report).
 */
export interface SummaryConfig {
  include?: string[];
  detailLimit?: number;
  withGit?: boolean;
  format?: "markdown" | "json";
  model?: string;
}

export interface GlobalConfig {
  refreshIntervalMs: number; // default: 2000
  hiddenSessions: string[];
  hiddenSubAgents: string[];
  filterPresets: string[][]; // [] = all; default: [[], ["response", "user"], ["commit"]]
  hiddenProjects: string[]; // by projectName
  report: ReportConfig;
  summary: SummaryConfig;
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
  detailBody?: string; // full multi-line body for the detail view (diff or file content)
  detailKind?: "diff" | "code"; // how the detail view should color detailBody
  detailNumbered?: boolean; // detailBody lines carry a "NN: " line-number gutter (dim in the view)
}
