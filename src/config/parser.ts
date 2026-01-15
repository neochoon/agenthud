import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
} from "fs";
import { parse as parseYaml } from "yaml";
import {
  DEFAULT_PANEL_WIDTH,
  MIN_TERMINAL_WIDTH,
  MAX_TERMINAL_WIDTH,
} from "../ui/constants.js";

export interface FsMock {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string) => string;
}

let fs: FsMock = {
  existsSync: nodeExistsSync,
  readFileSync: (path: string) => nodeReadFileSync(path, "utf-8"),
};

export function setFsMock(mock: FsMock): void {
  fs = mock;
}

export function resetFsMock(): void {
  fs = {
    existsSync: nodeExistsSync,
    readFileSync: (path: string) => nodeReadFileSync(path, "utf-8"),
  };
}

export interface PanelConfig {
  enabled: boolean;
  interval: number | null; // null = manual
}

export interface GitPanelConfig extends PanelConfig {
  command?: {
    branch?: string;
    commits?: string;
    stats?: string;
  };
}

export interface TestsPanelConfig extends PanelConfig {
  command?: string;
  source?: string;
}

export interface ProjectPanelConfig extends PanelConfig {
  // Project panel has no special config, just enabled and interval
}

export interface ClaudePanelConfig extends PanelConfig {
  maxActivities?: number;
}

export interface OtherSessionsPanelConfig extends PanelConfig {
  activeThreshold?: number; // in milliseconds
  messageMaxLength?: number;
}

export interface CustomPanelConfig extends PanelConfig {
  command?: string;
  source?: string;
  renderer: "list" | "progress" | "status";
}

export interface PanelsConfig {
  project: ProjectPanelConfig;
  git: GitPanelConfig;
  tests: TestsPanelConfig;
  claude: ClaudePanelConfig;
  other_sessions: OtherSessionsPanelConfig;
}

export interface Config {
  panels: PanelsConfig;
  customPanels?: Record<string, CustomPanelConfig>;
  panelOrder: string[];
  width: number;
}

// Use centralized constants from ui/constants.ts
const DEFAULT_WIDTH = DEFAULT_PANEL_WIDTH;
const MIN_WIDTH = MIN_TERMINAL_WIDTH;
const MAX_WIDTH = MAX_TERMINAL_WIDTH;

export interface ParseResult {
  config: Config;
  warnings: string[];
}

const CONFIG_PATH = ".agenthud/config.yaml";

export function parseInterval(interval: string): number | null {
  if (!interval || interval === "manual") {
    return null;
  }

  const match = interval.match(/^(\d+)(s|m)$/);
  if (!match) {
    return null;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  if (unit === "s") {
    return value * 1000;
  } else if (unit === "m") {
    return value * 60 * 1000;
  }

  return null;
}

export function getDefaultConfig(): Config {
  return {
    panels: {
      project: {
        enabled: true,
        interval: 300000, // 5 minutes (doesn't change often)
      },
      git: {
        enabled: true,
        interval: 30000, // 30s
      },
      tests: {
        enabled: true,
        interval: null, // manual
      },
      claude: {
        enabled: true,
        interval: 10000, // 10 seconds default
      },
      other_sessions: {
        enabled: true,
        interval: 10000, // 10 seconds default
        activeThreshold: 5 * 60 * 1000, // 5 minutes
        messageMaxLength: 50,
      },
    },
    panelOrder: ["project", "git", "tests", "claude", "other_sessions"],
    width: DEFAULT_WIDTH,
  };
}

const BUILTIN_PANELS = ["project", "git", "tests", "claude", "other_sessions"];
const VALID_RENDERERS = ["list", "progress", "status"];

// Helper to parse common enabled/interval fields for all panels
function parseBasePanelConfig(
  panelConfig: Record<string, unknown>,
  targetConfig: PanelConfig,
  panelName: string,
  warnings: string[]
): void {
  if (typeof panelConfig.enabled === "boolean") {
    targetConfig.enabled = panelConfig.enabled;
  }
  if (typeof panelConfig.interval === "string") {
    const interval = parseInterval(panelConfig.interval);
    if (interval === null && panelConfig.interval !== "manual") {
      warnings.push(`Invalid interval '${panelConfig.interval}' for ${panelName} panel, using default`);
    } else {
      targetConfig.interval = interval;
    }
  }
}

export function parseConfig(): ParseResult {
  const warnings: string[] = [];
  const defaultConfig = getDefaultConfig();

  if (!fs.existsSync(CONFIG_PATH)) {
    return { config: defaultConfig, warnings };
  }

  let rawConfig: unknown;
  try {
    const content = fs.readFileSync(CONFIG_PATH);
    rawConfig = parseYaml(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`Failed to parse config: ${message}`);
    return { config: defaultConfig, warnings };
  }

  if (!rawConfig || typeof rawConfig !== "object") {
    return { config: defaultConfig, warnings };
  }

  const parsed = rawConfig as Record<string, unknown>;
  const config = getDefaultConfig();

  // Parse width
  if (typeof parsed.width === "number") {
    if (parsed.width < MIN_WIDTH) {
      warnings.push(`Width ${parsed.width} is too small, using minimum of ${MIN_WIDTH}`);
      config.width = MIN_WIDTH;
    } else if (parsed.width > MAX_WIDTH) {
      warnings.push(`Width ${parsed.width} is too large, using maximum of ${MAX_WIDTH}`);
      config.width = MAX_WIDTH;
    } else {
      config.width = parsed.width;
    }
  }

  const panels = parsed.panels as Record<string, unknown> | undefined;

  if (!panels || typeof panels !== "object") {
    return { config, warnings };
  }

  const customPanels: Record<string, CustomPanelConfig> = {};
  const panelOrder: string[] = [];

  for (const panelName of Object.keys(panels)) {
    panelOrder.push(panelName);
    const panelConfig = panels[panelName] as Record<string, unknown> | undefined;
    if (!panelConfig || typeof panelConfig !== "object") {
      continue;
    }

    // Handle built-in panels
    if (panelName === "project") {
      parseBasePanelConfig(panelConfig, config.panels.project, panelName, warnings);
      continue;
    }

    if (panelName === "git") {
      parseBasePanelConfig(panelConfig, config.panels.git, panelName, warnings);
      continue;
    }

    if (panelName === "tests") {
      parseBasePanelConfig(panelConfig, config.panels.tests, panelName, warnings);
      if (typeof panelConfig.command === "string") {
        config.panels.tests.command = panelConfig.command;
      }
      continue;
    }

    if (panelName === "claude") {
      parseBasePanelConfig(panelConfig, config.panels.claude, panelName, warnings);
      if (typeof panelConfig.max_activities === "number") {
        config.panels.claude.maxActivities = panelConfig.max_activities;
      }
      continue;
    }

    if (panelName === "other_sessions") {
      parseBasePanelConfig(panelConfig, config.panels.other_sessions, panelName, warnings);
      if (typeof panelConfig.active_threshold === "string") {
        const threshold = parseInterval(panelConfig.active_threshold);
        if (threshold !== null) {
          config.panels.other_sessions.activeThreshold = threshold;
        }
      }
      if (typeof panelConfig.message_max_length === "number") {
        config.panels.other_sessions.messageMaxLength = panelConfig.message_max_length;
      }
      continue;
    }

    // Handle custom panels (not a built-in panel)
    const customPanel: CustomPanelConfig = {
      enabled: typeof panelConfig.enabled === "boolean" ? panelConfig.enabled : true,
      interval: 30000, // default 30s
      renderer: "list", // default
    };

    // Parse interval
    if (typeof panelConfig.interval === "string") {
      const interval = parseInterval(panelConfig.interval);
      customPanel.interval = interval;
    }

    // Parse command
    if (typeof panelConfig.command === "string") {
      customPanel.command = panelConfig.command;
    }

    // Parse source
    if (typeof panelConfig.source === "string") {
      customPanel.source = panelConfig.source;
    }

    // Parse renderer
    if (typeof panelConfig.renderer === "string") {
      if (VALID_RENDERERS.includes(panelConfig.renderer)) {
        customPanel.renderer = panelConfig.renderer as "list" | "progress" | "status";
      } else {
        warnings.push(`Invalid renderer '${panelConfig.renderer}' for custom panel, using 'list'`);
      }
    }

    customPanels[panelName] = customPanel;
  }

  // Only add customPanels if there are any
  if (Object.keys(customPanels).length > 0) {
    config.customPanels = customPanels;
  }

  // Set panel order from config, adding missing built-in panels at the end
  for (const builtIn of BUILTIN_PANELS) {
    if (!panelOrder.includes(builtIn)) {
      panelOrder.push(builtIn);
    }
  }
  config.panelOrder = panelOrder;

  return { config, warnings };
}
