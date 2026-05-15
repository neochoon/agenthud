import { statSync } from "node:fs";
import type { ActivityEntry, SessionNode } from "../types/index.js";
import { parseSessionHistory } from "./sessionHistory.js";

export interface ReportOptions {
  date: Date; // local midnight of target day
  include: string[]; // activity types: "response" | "bash" | "edit" | "thinking" | "read" | "glob" | "user"
  format?: "markdown" | "json"; // default: "markdown"
  detailLimit?: number; // max chars for detail field; 0 = unlimited; default: 120
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

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatActivity(activity: ActivityEntry, limit: number): string {
  const time = formatTime(activity.timestamp);
  const detail = truncateDetail(activity.detail, limit);
  const suffix = detail ? `: ${detail}` : "";
  return `[${time}] ${activity.icon} ${activity.label}${suffix}`;
}

function formatDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function sessionIsOnDate(
  session: SessionNode,
  date: Date,
  activities: ActivityEntry[],
): boolean {
  try {
    const mtime = new Date(statSync(session.filePath).mtimeMs);
    if (isSameLocalDay(mtime, date)) return true;
  } catch {
    // ignore stat errors
  }
  return activities.some((a) => isSameLocalDay(a.timestamp, date));
}

function truncateDetail(detail: string, limit: number): string {
  if (limit === 0 || detail.length <= limit) return detail;
  return detail.slice(0, limit);
}

export function generateReport(
  sessions: SessionNode[],
  options: ReportOptions,
): string {
  const { date, include, format = "markdown", detailLimit = 120 } = options;
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
      .filter((a) => isSameLocalDay(a.timestamp, date))
      .filter((a) => activityMatchesInclude(a, include));

    if (dayActivities.length === 0) continue;

    blocks.push({
      session,
      activities: dayActivities,
      firstTime: dayActivities[0].timestamp.getTime(),
    });
  }

  if (blocks.length === 0) {
    if (format === "json") {
      return JSON.stringify({ date: dateStr, sessions: [] }, null, 2);
    }
    return `No activity found for ${dateStr}.`;
  }

  blocks.sort((a, b) => a.firstTime - b.firstTime);

  if (format === "json") {
    const buildJsonSession = (session: SessionNode, acts: ActivityEntry[]) => {
      const subAgentBlocks = session.subAgents.map((sa) => {
        const saActivities = parseSessionHistory(sa.filePath)
          .filter((a) => isSameLocalDay(a.timestamp, date))
          .filter((a) => activityMatchesInclude(a, include));
        return {
          agentId: sa.agentId,
          taskDescription: sa.taskDescription,
          activities: saActivities.map((a) => ({
            time: formatTime(a.timestamp),
            icon: a.icon,
            label: a.label,
            detail: truncateDetail(a.detail, detailLimit),
          })),
        };
      });

      return {
        project: session.projectName,
        start: formatTime(acts[0].timestamp),
        end: formatTime(acts[acts.length - 1].timestamp),
        activities: acts.map((a) => ({
          time: formatTime(a.timestamp),
          icon: a.icon,
          label: a.label,
          detail: truncateDetail(a.detail, detailLimit),
        })),
        subAgents: subAgentBlocks,
      };
    };

    return JSON.stringify(
      {
        date: dateStr,
        sessions: blocks.map(({ session, activities }) =>
          buildJsonSession(session, activities),
        ),
      },
      null,
      2,
    );
  }

  const lines: string[] = [`# AgentHUD Report: ${dateStr}`, ""];

  for (const { session, activities } of blocks) {
    const first = formatTime(activities[0].timestamp);
    const last = formatTime(activities[activities.length - 1].timestamp);
    lines.push(`## ${session.projectName} (${first} – ${last})`);
    lines.push("");
    for (const activity of activities) {
      lines.push(formatActivity(activity, detailLimit));
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
