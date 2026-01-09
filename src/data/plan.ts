import { readFileSync as nodeReadFileSync } from "fs";
import { join } from "path";
import type { Plan, Decision, PlanData } from "../types/index.js";

type ReadFileFn = (path: string) => string;

const AGENT_DIR = ".agent";
const PLAN_FILE = "plan.json";
const DECISIONS_FILE = "decisions.json";
const MAX_DECISIONS = 3;

let readFileFn: ReadFileFn = (path) => nodeReadFileSync(path, "utf-8");

export function setReadFileFn(fn: ReadFileFn): void {
  readFileFn = fn;
}

export function resetReadFileFn(): void {
  readFileFn = (path) => nodeReadFileSync(path, "utf-8");
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
