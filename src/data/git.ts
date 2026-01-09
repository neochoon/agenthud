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
    const result = execFn(
      "git diff --stat HEAD~$(git log --since=midnight --oneline | wc -l) 2>/dev/null || echo ''",
      { encoding: "utf-8", shell: "/bin/bash" }
    );

    const match = result.match(
      /(\d+) insertions?\(\+\).*?(\d+) deletions?\(-\)|(\d+) insertions?\(\+\)|(\d+) deletions?\(-\)/
    );

    if (!match) {
      return { added: 0, deleted: 0 };
    }

    if (match[1] && match[2]) {
      return { added: parseInt(match[1], 10), deleted: parseInt(match[2], 10) };
    } else if (match[3]) {
      return { added: parseInt(match[3], 10), deleted: 0 };
    } else if (match[4]) {
      return { added: 0, deleted: parseInt(match[4], 10) };
    }

    return { added: 0, deleted: 0 };
  } catch {
    return { added: 0, deleted: 0 };
  }
}
