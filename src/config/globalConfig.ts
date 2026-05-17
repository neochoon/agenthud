import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { GlobalConfig } from "../types/index.js";

const CONFIG_PATH = join(homedir(), ".agenthud", "config.yaml");
const STATE_PATH = join(homedir(), ".agenthud", "state.yaml");

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  refreshIntervalMs: 2000,
  logDir: join(homedir(), ".agenthud", "logs"),
  hiddenSessions: [],
  hiddenSubAgents: [],
  filterPresets: [[], ["response"], ["commit"]],
  hiddenProjects: [],
};

function parseInterval(value: string): number | null {
  const match = value.match(/^(\d+)(s|m)$/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return match[2] === "m" ? n * 60 * 1000 : n * 1000;
}

function ensureAgenthudDir(): void {
  const dir = join(homedir(), ".agenthud");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeDefaultConfig(): void {
  ensureAgenthudDir();
  const defaultYaml = `# AgentHUD user settings.
# App-managed state (hidden sessions/projects) lives in state.yaml.

# How often to poll for activity updates
refreshInterval: 2s

# Where 's' key saves activity logs
logDir: ~/.agenthud/logs

# Activity filter presets (cycle with 'f' key in viewer)
# Each list is one preset; [] means "all". First preset is the default.
filterPresets:
  - []
  - ["response"]
  - ["commit"]
`;
  try {
    writeFileSync(CONFIG_PATH, defaultYaml, "utf-8");
  } catch {
    // best effort — silent
  }
}

function writeState(
  state: Pick<
    GlobalConfig,
    "hiddenSessions" | "hiddenSubAgents" | "hiddenProjects"
  >,
): void {
  ensureAgenthudDir();
  try {
    writeFileSync(STATE_PATH, stringifyYaml(state), "utf-8");
  } catch {
    // best effort
  }
}

function rewriteConfigWithoutHideFields(raw: Record<string, unknown>): void {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (
      k === "hiddenSessions" ||
      k === "hiddenSubAgents" ||
      k === "hiddenProjects"
    )
      continue;
    cleaned[k] = v;
  }
  try {
    writeFileSync(CONFIG_PATH, stringifyYaml(cleaned), "utf-8");
  } catch {
    // best effort
  }
}

export function loadGlobalConfig(): GlobalConfig {
  const config = { ...DEFAULT_GLOBAL_CONFIG };

  // Read config.yaml (non-hide settings)
  let configRaw: Record<string, unknown> = {};
  let configHadHideFields = false;

  if (existsSync(CONFIG_PATH)) {
    try {
      const text = readFileSync(CONFIG_PATH, "utf-8");
      configRaw = (parseYaml(text) as Record<string, unknown>) ?? {};
    } catch {
      configRaw = {};
    }
  } else {
    // Auto-create config.yaml with defaults so user has a starting point
    writeDefaultConfig();
  }

  if (typeof configRaw.refreshInterval === "string") {
    const ms = parseInterval(configRaw.refreshInterval);
    if (ms !== null) config.refreshIntervalMs = ms;
  }
  if (typeof configRaw.logDir === "string") {
    config.logDir = configRaw.logDir.replace(/^~/, homedir());
  }
  if (Array.isArray(configRaw.filterPresets)) {
    const presets = (configRaw.filterPresets as unknown[])
      .filter(Array.isArray)
      .map((p) =>
        (p as unknown[]).filter((t): t is string => typeof t === "string"),
      );
    if (presets.length > 0) config.filterPresets = presets;
  }

  // Detect legacy hide fields in config.yaml for migration
  const legacyHidden: Partial<
    Pick<GlobalConfig, "hiddenSessions" | "hiddenSubAgents" | "hiddenProjects">
  > = {};
  for (const key of [
    "hiddenSessions",
    "hiddenSubAgents",
    "hiddenProjects",
  ] as const) {
    if (Array.isArray(configRaw[key])) {
      configHadHideFields = true;
      legacyHidden[key] = (configRaw[key] as unknown[]).filter(
        (s): s is string => typeof s === "string",
      );
    }
  }

  // Read state.yaml (hide fields)
  let stateRaw: Record<string, unknown> = {};
  if (existsSync(STATE_PATH)) {
    try {
      const text = readFileSync(STATE_PATH, "utf-8");
      stateRaw = (parseYaml(text) as Record<string, unknown>) ?? {};
    } catch {
      stateRaw = {};
    }
  }

  for (const key of [
    "hiddenSessions",
    "hiddenSubAgents",
    "hiddenProjects",
  ] as const) {
    if (Array.isArray(stateRaw[key])) {
      config[key] = (stateRaw[key] as unknown[]).filter(
        (s): s is string => typeof s === "string",
      );
    }
  }

  // Migration: if config.yaml had hide fields, move them to state.yaml and
  // rewrite config.yaml without them
  if (configHadHideFields) {
    // state.yaml wins for any overlap (it's more recent); fall back to legacy
    const merged: Pick<
      GlobalConfig,
      "hiddenSessions" | "hiddenSubAgents" | "hiddenProjects"
    > = {
      hiddenSessions:
        config.hiddenSessions.length > 0
          ? config.hiddenSessions
          : (legacyHidden.hiddenSessions ?? []),
      hiddenSubAgents:
        config.hiddenSubAgents.length > 0
          ? config.hiddenSubAgents
          : (legacyHidden.hiddenSubAgents ?? []),
      hiddenProjects:
        config.hiddenProjects.length > 0
          ? config.hiddenProjects
          : (legacyHidden.hiddenProjects ?? []),
    };
    writeState(merged);
    rewriteConfigWithoutHideFields(configRaw);
    config.hiddenSessions = merged.hiddenSessions;
    config.hiddenSubAgents = merged.hiddenSubAgents;
    config.hiddenProjects = merged.hiddenProjects;
  }

  return config;
}

function updateState(
  updates: Partial<
    Pick<GlobalConfig, "hiddenSessions" | "hiddenSubAgents" | "hiddenProjects">
  >,
): void {
  // Read existing state
  let state: Pick<
    GlobalConfig,
    "hiddenSessions" | "hiddenSubAgents" | "hiddenProjects"
  > = {
    hiddenSessions: [],
    hiddenSubAgents: [],
    hiddenProjects: [],
  };
  if (existsSync(STATE_PATH)) {
    try {
      const text = readFileSync(STATE_PATH, "utf-8");
      const raw = (parseYaml(text) as Record<string, unknown>) ?? {};
      for (const key of [
        "hiddenSessions",
        "hiddenSubAgents",
        "hiddenProjects",
      ] as const) {
        if (Array.isArray(raw[key])) {
          state[key] = (raw[key] as unknown[]).filter(
            (s): s is string => typeof s === "string",
          );
        }
      }
    } catch {
      // use defaults
    }
  }

  // Apply updates
  for (const key of [
    "hiddenSessions",
    "hiddenSubAgents",
    "hiddenProjects",
  ] as const) {
    if (updates[key] !== undefined) {
      state[key] = updates[key]!;
    }
  }

  writeState(state);
}

export function hideSession(id: string): void {
  const config = loadGlobalConfig();
  if (config.hiddenSessions.includes(id)) return;
  updateState({ hiddenSessions: [...config.hiddenSessions, id] });
}

export function hideSubAgent(id: string): void {
  const config = loadGlobalConfig();
  if (config.hiddenSubAgents.includes(id)) return;
  updateState({ hiddenSubAgents: [...config.hiddenSubAgents, id] });
}

export function hideProject(name: string): void {
  const config = loadGlobalConfig();
  if (config.hiddenProjects.includes(name)) return;
  updateState({ hiddenProjects: [...config.hiddenProjects, name] });
}

export function ensureLogDir(logDir: string): void {
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

export function hasProjectLevelConfig(): boolean {
  return existsSync(join(process.cwd(), ".agenthud", "config.yaml"));
}
