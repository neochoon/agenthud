export interface Commit {
  hash: string;
  message: string;
  timestamp: Date;
}

export interface GitStats {
  added: number;
  deleted: number;
  files: number;
}

export interface PlanStep {
  step: string;
  status: "done" | "in-progress" | "pending";
}

export interface Plan {
  goal: string;
  updatedAt?: string;
  steps: PlanStep[];
}

export interface Decision {
  timestamp: string;
  decision: string;
  reason?: string;
}

export interface PlanData {
  plan: Plan | null;
  decisions: Decision[];
  error?: string;
}

export interface TestFailure {
  file: string;
  name: string;
}

export interface TestResults {
  hash: string;
  timestamp: string;
  passed: number;
  failed: number;
  skipped: number;
  failures: TestFailure[];
}

export interface TestData {
  results: TestResults | null;
  isOutdated: boolean;
  commitsBehind: number;
  error?: string;
}

// Generic panel data format
export interface GenericPanelItem {
  text: string;
  status?: "done" | "pending" | "failed";
}

export interface GenericPanelData {
  title: string;
  summary?: string;
  items?: GenericPanelItem[];
  progress?: { done: number; total: number };
  stats?: { passed: number; failed: number; skipped?: number };
}

export type GenericPanelRenderer = "list" | "progress" | "status";

// Claude session types
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
