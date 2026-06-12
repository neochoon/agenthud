/**
 * Build a chronological activity report for one date, scoped to a
 * given set of sessions. Two output formats: Markdown (human-/
 * LLM-readable) and JSON (script-readable). Drives both `agenthud
 * report` and the LLM payload that feeds `agenthud summary`.
 *
 * Design decisions:
 * - JSON nests sub-agent activities under their parent session;
 *   Markdown does *not*. Reason: sub-agent activity is high-volume
 *   exploratory output. JSON consumers can filter, but a markdown
 *   report aimed at human reading would balloon by 10× per day.
 *   Subagent results still reach the LLM via the parent's Task row
 *   (see `formatTaskBody`).
 * - `activityMatchesInclude` is a hand-written switch on label,
 *   not a label→type map. The fan-in is small (~10 labels) and
 *   the explicit branches double as documentation of what each
 *   include type captures.
 * - Markdown deliberately omits `detailBody` for every tool
 *   *except* Task. Edit/Write/Read bodies stay TUI-only to keep
 *   the LLM payload bounded; Task's body is the subagent's
 *   returned text, which is the entire point of including Task.
 *
 * Gotcha:
 * - `sessionIsOnDate` checks BOTH file mtime AND activity
 *   timestamps. mtime alone misclassifies cases where today's
 *   only activity was a small tool result that didn't bump mtime
 *   visibly, and timestamps alone misclassify sessions that
 *   touched today but whose tail entries are still parsing.
 */

import { statSync } from "node:fs";
import type { ActivityEntry, SessionNode } from "../types/index.js";
import { parseGitCommits } from "./gitCommits.js";
import { parseSessionHistory } from "./sessionHistory.js";

export interface ReportOptions {
  date: Date; // local midnight of target day
  include: string[]; // activity types: "response" | "bash" | "edit" | "thinking" | "read" | "glob" | "user"
  format?: "markdown" | "json"; // default: "markdown"
  detailLimit?: number; // max chars for detail field; 0 = unlimited; default: 120
  withGit?: boolean; // merge git commits into activity timeline per session
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
  if (include.includes("task") && label === "task") return true;
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

/**
 * For Task activities, expose the subagent's returned text on its own
 * lines as an XML-tagged block. XML tags (over fenced code blocks or
 * `---` separators) survive the kind of content subagent results
 * typically contain — code fences, horizontal rules, yaml frontmatter
 * — without ambiguity.
 *
 * Returns null for any other tool. The markdown report deliberately
 * keeps `detailBody` out of the LLM payload elsewhere: a full Edit
 * diff or Read body would balloon the input without adding
 * proportional signal. Task is the exception because its row summary
 * is otherwise just the task description — the actual result is the
 * only signal.
 */
function formatTaskBody(activity: ActivityEntry, limit: number): string | null {
  if (activity.label !== "Task") return null;
  if (!activity.detailBody) return null;
  const body = truncateRaw(activity.detailBody, limit);
  return `<task-result>\n${body}\n</task-result>`;
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

function flattenForOneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").trim();
}

function truncateDetail(detail: string, limit: number): string {
  const flat = flattenForOneLine(detail);
  if (limit === 0 || flat.length <= limit) return flat;
  return flat.slice(0, limit);
}

function truncateRaw(detail: string, limit: number): string {
  if (limit === 0 || detail.length <= limit) return detail;
  return detail.slice(0, limit);
}

export function generateReport(
  sessions: SessionNode[],
  options: ReportOptions,
): string {
  const {
    date,
    include,
    format = "markdown",
    detailLimit = 120,
    withGit = false,
  } = options;
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

    const commits = withGit ? parseGitCommits(session.projectPath, date) : [];
    const dayActivities = [
      ...allActivities
        .filter((a) => isSameLocalDay(a.timestamp, date))
        .filter((a) => activityMatchesInclude(a, include)),
      ...commits,
    ].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

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
            detail: truncateRaw(a.detail, detailLimit),
          })),
        };
      });

      return {
        project: session.projectName,
        provider: session.provider ?? null,
        model: session.modelName ?? null,
        start: formatTime(acts[0].timestamp),
        end: formatTime(acts[acts.length - 1].timestamp),
        activities: acts.map((a) => ({
          time: formatTime(a.timestamp),
          icon: a.icon,
          label: a.label,
          detail: truncateRaw(a.detail, detailLimit),
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
    // Append provider + model as bullet-separated provenance so the
    // reader (and the downstream summary LLM) knows which CLI / model
    // produced this block. Same labels as the TUI: claude/kiro plus
    // the shortened model id when known.
    const provenance: string[] = [];
    if (session.provider) provenance.push(session.provider);
    if (session.modelName) provenance.push(session.modelName);
    const suffix =
      provenance.length > 0 ? ` · ${provenance.join(" · ")}` : "";
    lines.push(`## ${session.projectName} (${first} – ${last})${suffix}`);
    lines.push("");
    for (const activity of activities) {
      lines.push(formatActivity(activity, detailLimit));
      const taskBody = formatTaskBody(activity, detailLimit);
      if (taskBody) lines.push(taskBody);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
