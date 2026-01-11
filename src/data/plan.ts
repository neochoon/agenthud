import { readFileSync as nodeReadFileSync, existsSync as nodeExistsSync } from "fs";
import { join, dirname } from "path";
import type { Plan, Decision, PlanData } from "../types/index.js";
import type { PlanPanelConfig } from "../config/parser.js";

type ReadFileFn = (path: string) => string;
type FileExistsFn = (path: string) => boolean;

const AGENT_DIR = ".agenthud";
const PLAN_DIR = "plan";
const PLAN_FILE = "plan.json";
const DECISIONS_FILE = "decisions.json";
const MAX_DECISIONS = 3;

// Old flat structure paths (for backwards compatibility)
const OLD_PLAN_PATH = join(AGENT_DIR, PLAN_FILE);
const OLD_DECISIONS_PATH = join(AGENT_DIR, DECISIONS_FILE);

// New panel-based structure paths
const NEW_PLAN_PATH = join(AGENT_DIR, PLAN_DIR, PLAN_FILE);
const NEW_DECISIONS_PATH = join(AGENT_DIR, PLAN_DIR, DECISIONS_FILE);

let readFileFn: ReadFileFn = (path) => nodeReadFileSync(path, "utf-8");
let fileExistsFn: FileExistsFn = nodeExistsSync;

export function setReadFileFn(fn: ReadFileFn): void {
  readFileFn = fn;
}

export function resetReadFileFn(): void {
  readFileFn = (path) => nodeReadFileSync(path, "utf-8");
}

export function setFileExistsFn(fn: FileExistsFn): void {
  fileExistsFn = fn;
}

export function resetFileExistsFn(): void {
  fileExistsFn = nodeExistsSync;
}

export function getPlanData(dir: string = process.cwd()): PlanData {
  const planPath = join(dir, AGENT_DIR, PLAN_FILE);
  const decisionsPath = join(dir, AGENT_DIR, DECISIONS_FILE);

  let plan: Plan | null = null;
  let decisions: Decision[] = [];
  let error: string | undefined;

  // Read plan.json
  try {
    const content = readFileFn(planPath);
    plan = JSON.parse(content) as Plan;
  } catch (e) {
    if (e instanceof SyntaxError) {
      error = "Invalid plan.json";
    } else {
      error = "No plan found";
    }
    plan = null;
  }

  // Read decisions.json (optional - no error if missing/invalid)
  try {
    const content = readFileFn(decisionsPath);
    const parsed = JSON.parse(content) as { decisions: Decision[] };
    decisions = (parsed.decisions || []).slice(0, MAX_DECISIONS);
  } catch {
    decisions = [];
  }

  return { plan, decisions, error };
}

export function getPlanDataWithConfig(config: PlanPanelConfig): PlanData {
  const configSource = config.source;
  const configDir = dirname(configSource);
  const configDecisionsPath = join(configDir, "decisions.json");

  // Determine actual paths with fallback support
  // Check if new location exists, otherwise fall back to old location
  let planPath = configSource;
  let decisionsPath = configDecisionsPath;

  // If config points to new location but it doesn't exist, try old location
  if (configSource === NEW_PLAN_PATH && !fileExistsFn(configSource)) {
    if (fileExistsFn(OLD_PLAN_PATH)) {
      planPath = OLD_PLAN_PATH;
      decisionsPath = OLD_DECISIONS_PATH;
    }
  }

  let plan: Plan | null = null;
  let decisions: Decision[] = [];
  let error: string | undefined;

  // Read plan.json from determined path
  try {
    const content = readFileFn(planPath);
    plan = JSON.parse(content) as Plan;
  } catch (e) {
    if (e instanceof SyntaxError) {
      error = "Invalid plan.json";
    } else {
      error = "No plan found";
    }
    plan = null;
  }

  // Read decisions.json from same directory as plan
  // Also support fallback for decisions
  let actualDecisionsPath = decisionsPath;
  if (!fileExistsFn(decisionsPath) && fileExistsFn(OLD_DECISIONS_PATH)) {
    actualDecisionsPath = OLD_DECISIONS_PATH;
  }

  try {
    const content = readFileFn(actualDecisionsPath);
    const parsed = JSON.parse(content) as { decisions: Decision[] };
    decisions = (parsed.decisions || []).slice(0, MAX_DECISIONS);
  } catch {
    decisions = [];
  }

  return { plan, decisions, error };
}
