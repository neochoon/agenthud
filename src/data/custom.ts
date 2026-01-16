import { exec, execSync } from "node:child_process";
import { promises as fsPromises, readFileSync } from "node:fs";
import { promisify } from "node:util";
import type { CustomPanelConfig } from "../config/parser.js";
import type { GenericPanelData } from "../types/index.js";

const execAsync = promisify(exec);

export interface CustomPanelResult {
  data: GenericPanelData;
  error?: string;
  timestamp: string;
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function getCustomPanelData(
  name: string,
  panelConfig: CustomPanelConfig,
): CustomPanelResult {
  const timestamp = new Date().toISOString();
  const defaultData: GenericPanelData = {
    title: capitalizeFirst(name),
  };

  // Try command first
  if (panelConfig.command) {
    try {
      const output = (
        execSync(panelConfig.command, { encoding: "utf-8" }) as string
      ).trim();

      // Try to parse as JSON
      try {
        const parsed = JSON.parse(output);
        return {
          data: {
            title: parsed.title || capitalizeFirst(name),
            summary: parsed.summary,
            items: parsed.items,
            progress: parsed.progress,
            stats: parsed.stats,
          },
          timestamp,
        };
      } catch {
        // Not JSON, treat as line-separated list
        const lines = output.split("\n").filter((l) => l.trim());
        return {
          data: {
            title: capitalizeFirst(name),
            items: lines.map((text) => ({ text })),
          },
          timestamp,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        data: defaultData,
        error: `Command failed: ${message.split("\n")[0]}`,
        timestamp,
      };
    }
  }

  // Try source file
  if (panelConfig.source) {
    try {
      const content = readFileSync(panelConfig.source, "utf-8");
      const parsed = JSON.parse(content);
      return {
        data: {
          title: parsed.title || capitalizeFirst(name),
          summary: parsed.summary,
          items: parsed.items,
          progress: parsed.progress,
          stats: parsed.stats,
        },
        timestamp,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        return {
          data: defaultData,
          error: "File not found",
          timestamp,
        };
      }
      return {
        data: defaultData,
        error: "Invalid JSON",
        timestamp,
      };
    }
  }

  return {
    data: defaultData,
    error: "No command or source configured",
    timestamp,
  };
}

// Async version for non-blocking UI updates
export async function getCustomPanelDataAsync(
  name: string,
  panelConfig: CustomPanelConfig,
): Promise<CustomPanelResult> {
  const timestamp = new Date().toISOString();
  const defaultData: GenericPanelData = {
    title: capitalizeFirst(name),
  };

  // Try command first
  if (panelConfig.command) {
    try {
      const { stdout } = await execAsync(panelConfig.command);
      const output = stdout.trim();

      // Try to parse as JSON
      try {
        const parsed = JSON.parse(output);
        return {
          data: {
            title: parsed.title || capitalizeFirst(name),
            summary: parsed.summary,
            items: parsed.items,
            progress: parsed.progress,
            stats: parsed.stats,
          },
          timestamp,
        };
      } catch {
        // Not JSON, treat as line-separated list
        const lines = output.split("\n").filter((l) => l.trim());
        return {
          data: {
            title: capitalizeFirst(name),
            items: lines.map((text) => ({ text })),
          },
          timestamp,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        data: defaultData,
        error: `Command failed: ${message.split("\n")[0]}`,
        timestamp,
      };
    }
  }

  // Try source file
  if (panelConfig.source) {
    try {
      const content = await fsPromises.readFile(panelConfig.source, "utf-8");
      const parsed = JSON.parse(content);
      return {
        data: {
          title: parsed.title || capitalizeFirst(name),
          summary: parsed.summary,
          items: parsed.items,
          progress: parsed.progress,
          stats: parsed.stats,
        },
        timestamp,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        return {
          data: defaultData,
          error: "File not found",
          timestamp,
        };
      }
      return {
        data: defaultData,
        error: "Invalid JSON",
        timestamp,
      };
    }
  }

  return {
    data: defaultData,
    error: "No command or source configured",
    timestamp,
  };
}
