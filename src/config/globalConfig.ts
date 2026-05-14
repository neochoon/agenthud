import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { GlobalConfig } from "../types/index.js";

const CONFIG_PATH = join(homedir(), ".agenthud", "config.yaml");

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  refreshIntervalMs: 2000,
  logDir: join(homedir(), ".agenthud", "logs"),
  hiddenSessions: [],
  hiddenSubAgents: [],
};

function parseInterval(value: string): number | null {
  const match = value.match(/^(\d+)(s|m)$/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return match[2] === "m" ? n * 60 * 1000 : n * 1000;
}

export function loadGlobalConfig(): GlobalConfig {
  const config = { ...DEFAULT_GLOBAL_CONFIG };

  if (!existsSync(CONFIG_PATH)) {
    return config;
  }

  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    return config;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(raw) as Record<string, unknown>;
  } catch {
    return config;
  }

  if (typeof parsed.refreshInterval === "string") {
    const ms = parseInterval(parsed.refreshInterval);
    if (ms !== null) config.refreshIntervalMs = ms;
  }
  if (typeof parsed.logDir === "string") {
    config.logDir = parsed.logDir.replace(/^~/, homedir());
  }

  return config;
}

export function ensureLogDir(logDir: string): void {
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

export function hasProjectLevelConfig(): boolean {
  return existsSync(join(process.cwd(), ".agenthud", "config.yaml"));
}
