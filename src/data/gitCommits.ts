import { execSync } from "node:child_process";
import type { ActivityEntry } from "../types/index.js";
import { ICONS } from "../types/index.js";

function formatDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getCommitDetail(
  projectPath: string,
  hash: string,
): string | null {
  try {
    return execSync(`git show --stat --no-color ${hash}`, {
      cwd: projectPath,
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

export function parseGitCommits(
  projectPath: string,
  startDate: Date,
  endDate?: Date,
): ActivityEntry[] {
  if (!projectPath) return [];

  const start = formatDateString(startDate);
  const end = formatDateString(endDate ?? startDate);
  let raw: string;
  try {
    raw = execSync(
      `git log --format="%ct|%h|%s" --after="${start} 00:00:00" --before="${end} 23:59:59"`,
      { cwd: projectPath, encoding: "utf-8" },
    ).trim();
  } catch {
    return [];
  }

  if (!raw) return [];

  const entries: ActivityEntry[] = [];
  for (const line of raw.split("\n")) {
    const parts = line.trim().split("|");
    if (parts.length < 3) continue;
    const [tsStr, hash, ...rest] = parts;
    const ts = Number(tsStr);
    if (Number.isNaN(ts)) continue;
    entries.push({
      timestamp: new Date(ts * 1000),
      type: "commit",
      icon: ICONS.Commit,
      label: hash,
      detail: rest.join("|"),
    });
  }

  return entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
