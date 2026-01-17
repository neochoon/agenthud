import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";
import type { GitPanelConfig } from "../config/parser.js";
import type { Commit, GitStats } from "../types/index.js";

const execAsync = promisify(exec);

// Strip BOM and surrounding quotes from output (Windows compatibility)
function cleanOutput(str: string): string {
  // Remove UTF-8 BOM
  let result = str.replace(/^\uFEFF/, "");
  // Remove surrounding double quotes (Windows cmd may include them)
  result = result.replace(/^"|"$/g, "");
  return result.trim();
}

export function getCurrentBranch(): string | null {
  try {
    const result = execSync("git branch --show-current", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return null;
  }
}

export function getTodayCommits(): Commit[] {
  try {
    const result = execSync('git log --since=midnight --format="%h|%aI|%s"', {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
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
    const result = execSync('git log --since=midnight --numstat --format=""', {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
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
    const result = execSync("git status --porcelain", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
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

// Shared parsing functions to avoid sync/async duplication
function parseCommitsOutput(output: string): Commit[] {
  const lines = cleanOutput(output).split("\n").filter(Boolean);
  return lines.map((line) => {
    const cleanLine = cleanOutput(line);
    const [hash, timestamp, ...messageParts] = cleanLine.split("|");
    return {
      hash: cleanOutput(hash),
      message: messageParts.join("|"),
      timestamp: new Date(timestamp),
    };
  });
}

function parseStatsOutput(output: string): GitStats {
  const lines = output.trim().split("\n").filter(Boolean);

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

  return { added, deleted, files: filesSet.size };
}

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
    const result = execSync(commands.branch, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    branch = result.trim();
  } catch {
    branch = null;
  }

  // Get commits
  let commits: Commit[] = [];
  try {
    const result = execSync(commands.commits, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    commits = parseCommitsOutput(result);
  } catch {
    commits = [];
  }

  // Get stats
  let stats: GitStats = { added: 0, deleted: 0, files: 0 };
  try {
    const result = execSync(commands.stats, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    stats = parseStatsOutput(result);
  } catch {
    stats = { added: 0, deleted: 0, files: 0 };
  }

  // Get uncommitted count
  const uncommitted = getUncommittedCount();

  return { branch, commits, stats, uncommitted };
}

// Async version for non-blocking UI updates
export async function getGitDataAsync(
  config: GitPanelConfig,
): Promise<GitData> {
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
    commits = parseCommitsOutput(stdout);
  } catch {
    commits = [];
  }

  // Get stats
  let stats: GitStats = { added: 0, deleted: 0, files: 0 };
  try {
    const { stdout } = await execAsync(commands.stats);
    stats = parseStatsOutput(stdout);
  } catch {
    stats = { added: 0, deleted: 0, files: 0 };
  }

  // Get uncommitted count (using sync for simplicity, it's fast)
  const uncommitted = getUncommittedCount();

  return { branch, commits, stats, uncommitted };
}
