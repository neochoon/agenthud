import { execSync as nodeExecSync, exec as nodeExec } from "child_process";
import { promisify } from "util";
import type { Commit, GitStats } from "../types/index.js";
import type { GitPanelConfig } from "../config/parser.js";

type ExecFn = (command: string, options?: { encoding: string; shell?: string }) => string;
type AsyncExecFn = (command: string, options?: { encoding: string; shell?: string }) => Promise<string>;

const execAsync = promisify(nodeExec);

// Strip BOM and surrounding quotes from output (Windows compatibility)
function cleanOutput(str: string): string {
  // Remove UTF-8 BOM
  let result = str.replace(/^\uFEFF/, "");
  // Remove surrounding double quotes (Windows cmd may include them)
  result = result.replace(/^"|"$/g, "");
  return result.trim();
}

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
    const filesSet = new Set<string>();

    for (const line of lines) {
      const [addedStr, deletedStr, filename] = line.split("\t");
      // Skip binary files (shown as "-" in numstat)
      if (addedStr === "-" || deletedStr === "-") {
        if (filename) filesSet.add(filename);
        continue;
      }
      added += parseInt(addedStr, 10) || 0;
      deleted += parseInt(deletedStr, 10) || 0;
      if (filename) filesSet.add(filename);
    }

    return { added, deleted, files: filesSet.size };
  } catch {
    return { added: 0, deleted: 0, files: 0 };
  }
}

export function getUncommittedCount(): number {
  try {
    const result = execFn("git status --porcelain", {
      encoding: "utf-8",
    });

    const lines = result.trim().split("\n").filter(Boolean);
    return lines.length;
  } catch {
    return 0;
  }
}

// Default commands
const DEFAULT_COMMANDS = {
  branch: "git branch --show-current",
  commits: 'git log --since=midnight --format="%h|%aI|%s"',
  stats: 'git log --since=midnight --numstat --format=""',
};

export interface GitData {
  branch: string | null;
  commits: Commit[];
  stats: GitStats;
  uncommitted: number;
}

export function getGitData(config: GitPanelConfig): GitData {
  const commands = {
    branch: config.command?.branch || DEFAULT_COMMANDS.branch,
    commits: config.command?.commits || DEFAULT_COMMANDS.commits,
    stats: config.command?.stats || DEFAULT_COMMANDS.stats,
  };

  // Get branch
  let branch: string | null = null;
  try {
    const result = execFn(commands.branch, { encoding: "utf-8" });
    branch = result.trim();
  } catch {
    branch = null;
  }

  // Get commits
  let commits: Commit[] = [];
  try {
    const result = execFn(commands.commits, { encoding: "utf-8" });
    const lines = result.trim().split("\n").filter(Boolean);
    commits = lines.map((line) => {
      const [hash, timestamp, ...messageParts] = line.split("|");
      return {
        hash,
        message: messageParts.join("|"),
        timestamp: new Date(timestamp),
      };
    });
  } catch {
    commits = [];
  }

  // Get stats
  let stats: GitStats = { added: 0, deleted: 0, files: 0 };
  try {
    const result = execFn(commands.stats, { encoding: "utf-8" });
    const lines = result.trim().split("\n").filter(Boolean);

    let added = 0;
    let deleted = 0;
    const filesSet = new Set<string>();

    for (const line of lines) {
      const [addedStr, deletedStr, filename] = line.split("\t");
      if (addedStr === "-" || deletedStr === "-") {
        if (filename) filesSet.add(filename);
        continue;
      }
      added += parseInt(addedStr, 10) || 0;
      deleted += parseInt(deletedStr, 10) || 0;
      if (filename) filesSet.add(filename);
    }

    stats = { added, deleted, files: filesSet.size };
  } catch {
    stats = { added: 0, deleted: 0, files: 0 };
  }

  // Get uncommitted count
  const uncommitted = getUncommittedCount();

  return { branch, commits, stats, uncommitted };
}

// Async version for non-blocking UI updates
export async function getGitDataAsync(config: GitPanelConfig): Promise<GitData> {
  const commands = {
    branch: config.command?.branch || DEFAULT_COMMANDS.branch,
    commits: config.command?.commits || DEFAULT_COMMANDS.commits,
    stats: config.command?.stats || DEFAULT_COMMANDS.stats,
  };

  // Get branch
  let branch: string | null = null;
  try {
    const { stdout } = await execAsync(commands.branch);
    branch = stdout.trim();
  } catch {
    branch = null;
  }

  // Get commits
  let commits: Commit[] = [];
  try {
    const { stdout } = await execAsync(commands.commits);
    const lines = cleanOutput(stdout).split("\n").filter(Boolean);
    commits = lines.map((line) => {
      const cleanLine = cleanOutput(line);
      const [hash, timestamp, ...messageParts] = cleanLine.split("|");
      return {
        hash: cleanOutput(hash),
        message: messageParts.join("|"),
        timestamp: new Date(timestamp),
      };
    });
  } catch {
    commits = [];
  }

  // Get stats
  let stats: GitStats = { added: 0, deleted: 0, files: 0 };
  try {
    const { stdout } = await execAsync(commands.stats);
    const lines = stdout.trim().split("\n").filter(Boolean);

    let added = 0;
    let deleted = 0;
    const filesSet = new Set<string>();

    for (const line of lines) {
      const [addedStr, deletedStr, filename] = line.split("\t");
      if (addedStr === "-" || deletedStr === "-") {
        if (filename) filesSet.add(filename);
        continue;
      }
      added += parseInt(addedStr, 10) || 0;
      deleted += parseInt(deletedStr, 10) || 0;
      if (filename) filesSet.add(filename);
    }

    stats = { added, deleted, files: filesSet.size };
  } catch {
    stats = { added: 0, deleted: 0, files: 0 };
  }

  // Get uncommitted count (using sync for simplicity, it's fast)
  const uncommitted = getUncommittedCount();

  return { branch, commits, stats, uncommitted };
}
