import { execSync as nodeExecSync } from "child_process";
import type { Commit, GitStats } from "../types/index.js";

type ExecFn = (command: string, options?: { encoding: string; shell?: string }) => string;

// Default executor - can be overridden for testing
let execFn: ExecFn = (command, options) =>
  nodeExecSync(command, options as Parameters<typeof nodeExecSync>[1]) as string;

export function setExecFn(fn: ExecFn): void {
  execFn = fn;
}

export function resetExecFn(): void {
  execFn = (command, options) =>
    nodeExecSync(command, options as Parameters<typeof nodeExecSync>[1]) as string;
}

export function getCurrentBranch(): string | null {
  try {
    const result = execFn("git branch --show-current", {
      encoding: "utf-8",
    });
    return result.trim();
  } catch {
    return null;
  }
}

export function getTodayCommits(): Commit[] {
  try {
    const result = execFn('git log --since=midnight --format="%h|%aI|%s"', {
      encoding: "utf-8",
    });

    const lines = result.trim().split("\n").filter(Boolean);

    return lines.map((line) => {
      const [hash, timestamp, ...messageParts] = line.split("|");
      return {
        hash,
        message: messageParts.join("|"),
        timestamp: new Date(timestamp),
      };
    });
  } catch {
    return [];
  }
}

export function getTodayStats(): GitStats {
  try {
    const result = execFn('git log --since=midnight --numstat --format=""', {
      encoding: "utf-8",
    });

    const lines = result.trim().split("\n").filter(Boolean);

    let added = 0;
    let deleted = 0;

    for (const line of lines) {
      const [addedStr, deletedStr] = line.split("\t");
      // Skip binary files (shown as "-" in numstat)
      if (addedStr === "-" || deletedStr === "-") {
        continue;
      }
      added += parseInt(addedStr, 10) || 0;
      deleted += parseInt(deletedStr, 10) || 0;
    }

    return { added, deleted };
  } catch {
    return { added: 0, deleted: 0 };
  }
}
