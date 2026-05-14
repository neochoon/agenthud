import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
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
    parsed = (parseYaml(raw) as Record<string, unknown>) ?? {};
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
  if (Array.isArray(parsed.hiddenSessions)) {
    config.hiddenSessions = (parsed.hiddenSessions as unknown[]).filter(
      (s): s is string => typeof s === "string",
    );
  }
  if (Array.isArray(parsed.hiddenSubAgents)) {
    config.hiddenSubAgents = (parsed.hiddenSubAgents as unknown[]).filter(
      (s): s is string => typeof s === "string",
    );
  }

  return config;
}

function writeConfig(
  updates: Partial<Pick<GlobalConfig, "hiddenSessions" | "hiddenSubAgents">>,
): void {
  const configDir = join(homedir(), ".agenthud");
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  let raw: Record<string, unknown> = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      raw =
        (parseYaml(readFileSync(CONFIG_PATH, "utf-8")) as Record<
          string,
          unknown
        >) ?? {};
    } catch {
      raw = {};
    }
  }
  if (updates.hiddenSessions !== undefined)
    raw.hiddenSessions = updates.hiddenSessions;
  if (updates.hiddenSubAgents !== undefined)
    raw.hiddenSubAgents = updates.hiddenSubAgents;
  writeFileSync(CONFIG_PATH, stringifyYaml(raw), "utf-8");
}

export function hideSession(id: string): void {
  const config = loadGlobalConfig();
  if (config.hiddenSessions.includes(id)) return;
  writeConfig({ hiddenSessions: [...config.hiddenSessions, id] });
}

export function hideSubAgent(id: string): void {
  const config = loadGlobalConfig();
  if (config.hiddenSubAgents.includes(id)) return;
  writeConfig({ hiddenSubAgents: [...config.hiddenSubAgents, id] });
}

export function ensureLogDir(logDir: string): void {
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

export function hasProjectLevelConfig(): boolean {
  return existsSync(join(process.cwd(), ".agenthud", "config.yaml"));
}
