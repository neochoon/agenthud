import { statSync } from "node:fs";
import type { ActivityEntry, SessionNode } from "../types/index.js";
import { parseSessionHistory } from "./sessionHistory.js";

export interface ReportOptions {
  date: Date; // UTC midnight of target day
  include: string[]; // activity types: "response" | "bash" | "edit" | "thinking" | "read" | "glob" | "user"
}

function activityMatchesInclude(
  activity: ActivityEntry,
  include: string[],
): boolean {
  const label = activity.label.toLowerCase();
  const type = activity.type;
  if (include.includes("response") && type === "response") return true;
  if (include.includes("thinking") && type === "thinking") return true;
  if (include.includes("user") && type === "user") return true;
  if (include.includes("bash") && label === "bash") return true;
  if (
    include.includes("edit") &&
    (label === "edit" || label === "write" || label === "todowrite")
  )
    return true;
  if (
    include.includes("read") &&
    (label === "read" || label === "glob" || label === "grep")
  )
    return true;
  if (include.includes("glob") && (label === "glob" || label === "grep"))
    return true;
  return false;
}

function isSameUTCDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function formatTime(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function formatActivity(activity: ActivityEntry): string {
  const time = formatTime(activity.timestamp);
  const detail =
    activity.detail.length > 120
      ? activity.detail.slice(0, 120)
      : activity.detail;
  const suffix = detail ? `: ${detail}` : "";
  return `[${time}] ${activity.icon} ${activity.label}${suffix}`;
}

function formatDateString(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function sessionIsOnDate(
  session: SessionNode,
  date: Date,
  activities: ActivityEntry[],
): boolean {
  try {
    const mtime = new Date(statSync(session.filePath).mtimeMs);
    if (isSameUTCDay(mtime, date)) return true;
  } catch {
    // ignore stat errors
  }
  return activities.some((a) => isSameUTCDay(a.timestamp, date));
}

export function generateReport(
  sessions: SessionNode[],
  options: ReportOptions,
): string {
  const { date, include } = options;
  const dateStr = formatDateString(date);

  type SessionBlock = {
    session: SessionNode;
    activities: ActivityEntry[];
    firstTime: number;
  };
  const blocks: SessionBlock[] = [];

  for (const session of sessions) {
    const allActivities = parseSessionHistory(session.filePath);
    if (!sessionIsOnDate(session, date, allActivities)) continue;

    const dayActivities = allActivities
      .filter((a) => isSameUTCDay(a.timestamp, date))
      .filter((a) => activityMatchesInclude(a, include));

    if (dayActivities.length === 0) continue;

    blocks.push({
      session,
      activities: dayActivities,
      firstTime: dayActivities[0].timestamp.getTime(),
    });
  }

  if (blocks.length === 0) {
    return `No activity found for ${dateStr}.`;
  }

  blocks.sort((a, b) => a.firstTime - b.firstTime);

  const lines: string[] = [`# AgentHUD Report: ${dateStr}`, ""];

  for (const { session, activities } of blocks) {
    const first = formatTime(activities[0].timestamp);
    const last = formatTime(activities[activities.length - 1].timestamp);
    lines.push(`## ${session.projectName} (${first} – ${last})`);
    lines.push("");
    for (const activity of activities) {
      lines.push(formatActivity(activity));
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
