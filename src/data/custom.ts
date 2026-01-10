import { execSync as nodeExecSync, exec as nodeExec } from "child_process";
import { readFileSync as nodeReadFileSync, promises as fsPromises } from "fs";
import { promisify } from "util";
import type { GenericPanelData, GenericPanelRenderer } from "../types/index.js";
import type { CustomPanelConfig } from "../config/parser.js";

const execAsync = promisify(nodeExec);

// Allow mocking for tests
let execFn: (cmd: string, options: { encoding: string }) => string = (cmd, options) =>
  nodeExecSync(cmd, options as Parameters<typeof nodeExecSync>[1]) as string;

let readFileFn: (path: string) => string = (path) => nodeReadFileSync(path, "utf-8");

export function setExecFn(fn: typeof execFn): void {
  execFn = fn;
}

export function resetExecFn(): void {
  execFn = (cmd, options) =>
    nodeExecSync(cmd, options as Parameters<typeof nodeExecSync>[1]) as string;
}

export function setReadFileFn(fn: typeof readFileFn): void {
  readFileFn = fn;
}

export function resetReadFileFn(): void {
  readFileFn = (path) => nodeReadFileSync(path, "utf-8");
}

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
  panelConfig: CustomPanelConfig
): CustomPanelResult {
  const timestamp = new Date().toISOString();
  const defaultData: GenericPanelData = {
    title: capitalizeFirst(name),
  };

  // Try command first
  if (panelConfig.command) {
    try {
      const output = execFn(panelConfig.command, { encoding: "utf-8" }).trim();

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
      const content = readFileFn(panelConfig.source);
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
  panelConfig: CustomPanelConfig
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
