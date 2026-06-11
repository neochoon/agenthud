/**
 * Read/write the global config at `~/.agenthud/config.yaml` and the
 * sibling app-managed state at `~/.agenthud/state.yaml`. Owns the
 * canonical default sets (`DEFAULT_INCLUDE_TYPES`,
 * `ALLOWED_INCLUDE_TYPES`, `DEFAULT_GLOBAL_CONFIG`) — every other
 * module reads from these instead of redefining defaults locally.
 *
 * Design decisions:
 * - Config / state are SPLIT into two files. `config.yaml` holds
 *   user-edited preferences (filter presets, defaults, refresh
 *   interval). `state.yaml` holds app-managed UI state (hidden
 *   sessions / sub-agents / projects toggled by the `h` key).
 *   Reason: with one combined file, `git diff` on dotfiles churns
 *   constantly as the user hides/unhides items at runtime. Split
 *   in v0.9.0 with one-time auto-migration of the merged shape.
 * - `summary.*` keys INHERIT from `report.*` at the call site
 *   (not at parse time). An empty `summary:` block in the user's
 *   config means "use everything from report"; explicit summary
 *   keys override per-field. This lets users pin one defaults
 *   block under `report:` and have summary follow.
 * - `ALLOWED_INCLUDE_TYPES` is the validation gate (what's a
 *   *legal* type); `DEFAULT_INCLUDE_TYPES` is the default subset
 *   (what's ON by default). The two are not the same — `read`,
 *   `glob`, `commit` are allowed but not default-on.
 *
 * Gotcha:
 * - Auto-migration runs once on first load; the migrated file is
 *   then re-saved with the new schema. Editing the old schema
 *   after migration won't take effect — read the current shape
 *   from the actual file, not from old docs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { GlobalConfig } from "../types/index.js";

const CONFIG_PATH = join(homedir(), ".agenthud", "config.yaml");
const STATE_PATH = join(homedir(), ".agenthud", "state.yaml");

// The canonical built-in include set. report and summary both lean on
// this when neither the CLI flag nor the user config narrows it down.
export const DEFAULT_INCLUDE_TYPES = [
  "user",
  "response",
  "bash",
  "edit",
  "thinking",
  "task",
];

const ALLOWED_INCLUDE_TYPES = new Set([
  "user",
  "response",
  "bash",
  "edit",
  "thinking",
  "read",
  "glob",
  "commit",
  "task",
]);

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  refreshIntervalMs: 2000,
  hiddenSessions: [],
  hiddenSubAgents: [],
  // [] means "show all"; conversation preset bundles assistant + user;
  // commits-only preset filters down to git activity.
  filterPresets: [[], ["response", "user"], ["commit"]],
  hiddenProjects: [],
  report: {
    include: [...DEFAULT_INCLUDE_TYPES],
    detailLimit: 120,
    withGit: false,
    format: "markdown",
  },
  summary: {},
};

const ALL_PRESET_KEYWORDS = new Set(["all", "*", "any"]);

function normalizePreset(tokens: string[]): string[] {
  if (tokens.some((t) => ALL_PRESET_KEYWORDS.has(t.toLowerCase()))) return [];
  return tokens;
}

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

# Activity filter presets (cycle with 'f' key in viewer)
# Each list is one preset. Use "all" (or "*") to show everything.
# Types: response, user, bash, edit, thinking, read, glob, commit
filterPresets:
  - ["all"]
  - ["response", "user"]
  - ["commit"]

# Defaults for \`agenthud report\` (CLI flags still win per-invocation).
# include: activity types to keep. Types: user, response, bash, edit,
#          thinking, read, glob.
# detailLimit: max chars per activity detail (0 = unlimited).
# withGit: merge git commits from each session's project.
# format: markdown | json.
report:
  include: [user, response, bash, edit, thinking]
  detailLimit: 120
  withGit: false
  format: markdown

# Defaults for \`agenthud summary\`. Any field omitted here is inherited
# from \`report\` above. \`model\` is summary-specific and passed to
# \`claude --model\` (e.g. sonnet, haiku, or a full model id).
summary:
  withGit: true
  detailLimit: 0
  # model: sonnet
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
  // Deep-clone the defaults so per-call mutations (e.g. assigning
  // config.report.withGit) don't leak into the shared default record.
  const config: GlobalConfig = {
    ...DEFAULT_GLOBAL_CONFIG,
    hiddenSessions: [...DEFAULT_GLOBAL_CONFIG.hiddenSessions],
    hiddenSubAgents: [...DEFAULT_GLOBAL_CONFIG.hiddenSubAgents],
    hiddenProjects: [...DEFAULT_GLOBAL_CONFIG.hiddenProjects],
    filterPresets: DEFAULT_GLOBAL_CONFIG.filterPresets.map((p) => [...p]),
    report: {
      ...DEFAULT_GLOBAL_CONFIG.report,
      include: [...DEFAULT_GLOBAL_CONFIG.report.include],
    },
    summary: { ...DEFAULT_GLOBAL_CONFIG.summary },
  };

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
  if (Array.isArray(configRaw.filterPresets)) {
    const presets = (configRaw.filterPresets as unknown[])
      .filter(Array.isArray)
      .map((p) => {
        const tokens = (p as unknown[]).filter(
          (t): t is string => typeof t === "string",
        );
        return normalizePreset(tokens);
      });
    if (presets.length > 0) config.filterPresets = presets;
  }

  if (configRaw.report && typeof configRaw.report === "object") {
    const r = configRaw.report as Record<string, unknown>;
    // Each field is validated independently — a single bogus key drops
    // back to the built-in default for that field, leaving the rest of
    // the section intact.
    if (Array.isArray(r.include)) {
      const tokens = (r.include as unknown[]).filter(
        (t): t is string => typeof t === "string",
      );
      const cleaned = tokens.filter((t) => ALLOWED_INCLUDE_TYPES.has(t));
      if (cleaned.length > 0) config.report.include = cleaned;
    }
    if (typeof r.detailLimit === "number" && Number.isInteger(r.detailLimit) && r.detailLimit >= 0) {
      config.report.detailLimit = r.detailLimit;
    }
    if (typeof r.withGit === "boolean") config.report.withGit = r.withGit;
    if (r.format === "markdown" || r.format === "json") config.report.format = r.format;
  }

  if (configRaw.summary && typeof configRaw.summary === "object") {
    const s = configRaw.summary as Record<string, unknown>;
    if (Array.isArray(s.include)) {
      const tokens = (s.include as unknown[]).filter(
        (t): t is string => typeof t === "string",
      );
      const cleaned = tokens.filter((t) => ALLOWED_INCLUDE_TYPES.has(t));
      if (cleaned.length > 0) config.summary.include = cleaned;
    }
    if (typeof s.detailLimit === "number" && Number.isInteger(s.detailLimit) && s.detailLimit >= 0) {
      config.summary.detailLimit = s.detailLimit;
    }
    if (typeof s.withGit === "boolean") config.summary.withGit = s.withGit;
    if (s.format === "markdown" || s.format === "json") config.summary.format = s.format;
    if (typeof s.model === "string" && s.model.trim().length > 0) {
      config.summary.model = s.model.trim();
    }
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

export function unhideSession(id: string): void {
  const config = loadGlobalConfig();
  if (!config.hiddenSessions.includes(id)) return;
  updateState({
    hiddenSessions: config.hiddenSessions.filter((s) => s !== id),
  });
}

export function unhideSubAgent(id: string): void {
  const config = loadGlobalConfig();
  if (!config.hiddenSubAgents.includes(id)) return;
  updateState({
    hiddenSubAgents: config.hiddenSubAgents.filter((s) => s !== id),
  });
}

export function unhideProject(name: string): void {
  const config = loadGlobalConfig();
  if (!config.hiddenProjects.includes(name)) return;
  updateState({
    hiddenProjects: config.hiddenProjects.filter((p) => p !== name),
  });
}

export function hasProjectLevelConfig(): boolean {
  const candidate = join(process.cwd(), ".agenthud", "config.yaml");
  // When cwd is the user's home directory, candidate resolves to the global
  // config — that's not a "project-level" file at all.
  if (candidate === join(homedir(), ".agenthud", "config.yaml")) return false;
  return existsSync(candidate);
}
