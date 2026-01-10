import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
} from "fs";
import { parse as parseYaml } from "yaml";

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

export interface GitPanelConfig extends PanelConfig {}

export interface PlanPanelConfig extends PanelConfig {
  source: string;
}

export interface TestsPanelConfig extends PanelConfig {
  command?: string;
}

export interface PanelsConfig {
  git: GitPanelConfig;
  plan: PlanPanelConfig;
  tests: TestsPanelConfig;
}

export interface Config {
  panels: PanelsConfig;
}

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
      git: {
        enabled: true,
        interval: 30000, // 30s
      },
      plan: {
        enabled: true,
        interval: 10000, // 10s
        source: ".agenthud/plan.json",
      },
      tests: {
        enabled: true,
        interval: null, // manual
      },
    },
  };
}

const VALID_PANELS = ["git", "plan", "tests"];

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
  const panels = parsed.panels as Record<string, unknown> | undefined;

  if (!panels || typeof panels !== "object") {
    return { config: defaultConfig, warnings };
  }

  const config = getDefaultConfig();

  for (const panelName of Object.keys(panels)) {
    if (!VALID_PANELS.includes(panelName)) {
      warnings.push(`Unknown panel '${panelName}' in config`);
      continue;
    }

    const panelConfig = panels[panelName] as Record<string, unknown> | undefined;
    if (!panelConfig || typeof panelConfig !== "object") {
      continue;
    }

    if (panelName === "git") {
      if (typeof panelConfig.enabled === "boolean") {
        config.panels.git.enabled = panelConfig.enabled;
      }
      if (typeof panelConfig.interval === "string") {
        const interval = parseInterval(panelConfig.interval);
        if (interval === null && panelConfig.interval !== "manual") {
          warnings.push(`Invalid interval '${panelConfig.interval}' for git panel, using default`);
        } else {
          config.panels.git.interval = interval;
        }
      }
    }

    if (panelName === "plan") {
      if (typeof panelConfig.enabled === "boolean") {
        config.panels.plan.enabled = panelConfig.enabled;
      }
      if (typeof panelConfig.interval === "string") {
        const interval = parseInterval(panelConfig.interval);
        if (interval === null && panelConfig.interval !== "manual") {
          warnings.push(`Invalid interval '${panelConfig.interval}' for plan panel, using default`);
        } else {
          config.panels.plan.interval = interval;
        }
      }
      if (typeof panelConfig.source === "string") {
        config.panels.plan.source = panelConfig.source;
      }
    }

    if (panelName === "tests") {
      if (typeof panelConfig.enabled === "boolean") {
        config.panels.tests.enabled = panelConfig.enabled;
      }
      if (typeof panelConfig.interval === "string") {
        const interval = parseInterval(panelConfig.interval);
        if (interval === null && panelConfig.interval !== "manual") {
          warnings.push(`Invalid interval '${panelConfig.interval}' for tests panel, using default`);
        } else {
          config.panels.tests.interval = interval;
        }
      }
      if (typeof panelConfig.command === "string") {
        config.panels.tests.command = panelConfig.command;
      }
    }
  }

  return { config, warnings };
}
