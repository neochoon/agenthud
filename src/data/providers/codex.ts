/**
 * OpenAI Codex CLI session provider. Codex stores each session as a
 * date-partitioned JSONL "rollout" file:
 *
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<ISO8601>-<uuid>.jsonl
 *
 * (override with CODEX_SESSIONS_DIR). Every line is
 * `{ type, timestamp, payload }` with four `type` values:
 * `session_meta` (line 1), `turn_context`, `event_msg`,
 * `response_item`. Full schema + jq verification commands in
 * docs/schemas/codex-session.md.
 *
 * Version: captured onto SessionNode.version (see the parser
 * version-drift spec, docs/superpowers/specs/2026-06-19-parser-version-drift-design.md).
 *
 * Design decisions:
 * - Discovery walks the YYYY/MM/DD tree and parses each rollout for
 *   the few fields the tree needs (cwd, source/parent, model,
 *   title, context %). Parsed metadata is cached by (path, mtime)
 *   — Codex keeps ALL historical sessions on disk, so a full
 *   re-read of every cold file on each 2s poll would be wasteful;
 *   cold files never change mtime and stay cached.
 * - Sub-agents are SEPARATE rollout files (like Kiro CLI, unlike
 *   Kiro IDE). A file is a sub-agent when its `session_meta.source`
 *   is an object keyed `subagent`; it nests under the session named
 *   by `parent_thread_id`. Older Codex builds wrote
 *   `source: { subagent: "<role>" }` with no `parent_thread_id` —
 *   such orphans surface at top level rather than being dropped.
 * - Context gauge needs no inference: the last `token_count` event
 *   carries `model_context_window` and `last_token_usage
 *   .total_tokens` directly.
 *
 * Gotchas:
 * - `model` lives in `turn_context`, not `session_meta`, and can
 *   change per turn — the LAST turn_context wins.
 * - The first `user_message` is usually a synthetic
 *   `<environment_context>…` block; skip it for the title and the
 *   activity stream.
 * - `function_call.arguments` is JSON encoded as a STRING —
 *   double-parse.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type {
  ActivityEntry,
  GlobalConfig,
  ProjectNode,
  SessionNode,
  SessionStatus,
  SessionTree,
} from "../../types/index.js";
import { ICONS } from "../../types/index.js";
import { ONE_HOUR_MS, THIRTY_MINUTES_MS } from "../../utils/timeConstants.js";
import { pickLatestUserTitle } from "./sessionTitle.js";
import type { ParseResult, SessionProvider } from "./types.js";

export function getCodexSessionsDir(): string {
  return (
    process.env.CODEX_SESSIONS_DIR ?? join(homedir(), ".codex", "sessions")
  );
}

function getSessionStatus(mtimeMs: number): SessionStatus {
  const now = Date.now();
  const age = now - mtimeMs;
  if (age < THIRTY_MINUTES_MS) return "hot";
  if (age < ONE_HOUR_MS) return "warm";
  const mtime = new Date(mtimeMs);
  const nowDate = new Date(now);
  if (
    mtime.getUTCFullYear() === nowDate.getUTCFullYear() &&
    mtime.getUTCMonth() === nowDate.getUTCMonth() &&
    mtime.getUTCDate() === nowDate.getUTCDate()
  ) {
    return "cool";
  }
  return "cold";
}

interface CodexRecord {
  type?: string;
  timestamp?: string;
  payload?: {
    type?: string;
    // session_meta
    id?: string;
    cwd?: string;
    source?: unknown;
    parent_thread_id?: string;
    agent_role?: string;
    agent_nickname?: string;
    cli_version?: string;
    // turn_context
    model?: string;
    // event_msg / user_message
    message?: string;
    // event_msg / token_count
    info?: {
      last_token_usage?: { total_tokens?: number };
      model_context_window?: number;
    };
    // response_item / function_call
    name?: string;
    arguments?: string;
  };
}

function isEnvContext(text: string): boolean {
  return text.trimStart().startsWith("<environment_context>");
}

interface CodexMeta {
  id: string;
  cwd: string;
  isSubagent: boolean;
  parentThreadId: string | null;
  model: string | null;
  title: string | null;
  contextUsage: { used: number; total: number; percent: number } | null;
  version?: string;
}

// Parse cache keyed by (path, mtime). Cold rollout files never
// change, so their metadata stays cached across polls.
const metaCache = new Map<
  string,
  { mtimeMs: number; value: CodexMeta | null }
>();

/** Test hook: the module-level cache collides on fake (path, mtime)
 * pairs across test cases. Production never needs this. */
export function clearCodexMetaCache(): void {
  metaCache.clear();
}

function parseMeta(path: string, mtimeMs: number): CodexMeta | null {
  const cached = metaCache.get(path);
  if (cached && cached.mtimeMs === mtimeMs) return cached.value;

  let value: CodexMeta | null = null;
  try {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n");

    let id: string | null = null;
    let cwd: string | null = null;
    let isSubagent = false;
    let parentThreadId: string | null = null;
    let model: string | null = null;
    let cliVersion: string | null = null;
    const userMessages: string[] = [];
    let contextUsage: CodexMeta["contextUsage"] = null;

    for (const line of lines) {
      if (!line.trim()) continue;
      let rec: CodexRecord;
      try {
        rec = JSON.parse(line) as CodexRecord;
      } catch {
        continue;
      }
      const p = rec.payload;
      if (!p) continue;

      if (rec.type === "session_meta") {
        id = typeof p.id === "string" ? p.id : null;
        cwd = typeof p.cwd === "string" ? p.cwd : null;
        parentThreadId =
          typeof p.parent_thread_id === "string" ? p.parent_thread_id : null;
        cliVersion = typeof p.cli_version === "string" ? p.cli_version : null;
        // source: "cli" (top-level) vs { subagent: ... } (sub-agent)
        isSubagent =
          typeof p.source === "object" &&
          p.source !== null &&
          "subagent" in (p.source as Record<string, unknown>);
      } else if (rec.type === "turn_context") {
        if (typeof p.model === "string" && p.model.length > 0) {
          model = p.model; // last turn wins
        }
      } else if (rec.type === "event_msg") {
        if (p.type === "user_message" && typeof p.message === "string") {
          userMessages.push(p.message);
        } else if (p.type === "token_count" && p.info) {
          const total = p.info.model_context_window;
          const used = p.info.last_token_usage?.total_tokens;
          if (
            typeof total === "number" &&
            typeof used === "number" &&
            total > 0
          ) {
            contextUsage = {
              used,
              total,
              percent: Math.min(100, Math.round((used / total) * 100)),
            };
          }
        }
      }
    }

    if (id && cwd) {
      value = {
        id,
        cwd,
        isSubagent,
        parentThreadId,
        model,
        title: pickLatestUserTitle(userMessages, isEnvContext),
        contextUsage,
        version: cliVersion ?? undefined,
      };
    }
  } catch {
    value = null;
  }
  metaCache.set(path, { mtimeMs, value });
  return value;
}

function listRolloutFiles(root: string): string[] {
  // root/YYYY/MM/DD/rollout-*.jsonl
  const out: string[] = [];
  const safeRead = (dir: string): string[] => {
    try {
      return readdirSync(dir) as unknown as string[];
    } catch {
      return [];
    }
  };
  for (const y of safeRead(root)) {
    const yDir = join(root, y);
    for (const m of safeRead(yDir)) {
      const mDir = join(yDir, m);
      for (const d of safeRead(mDir)) {
        const dDir = join(mDir, d);
        for (const f of safeRead(dDir)) {
          if (f.endsWith(".jsonl")) out.push(join(dDir, f));
        }
      }
    }
  }
  return out;
}

function makeNode(
  meta: CodexMeta,
  filePath: string,
  mtimeMs: number,
  hidden: boolean,
): SessionNode {
  const projectName = basename(meta.cwd);
  const node: SessionNode = {
    id: meta.id,
    hideKey: `${projectName}/${meta.id}`,
    filePath,
    projectPath: meta.cwd,
    projectName,
    lastModifiedMs: mtimeMs,
    status: getSessionStatus(mtimeMs),
    modelName: meta.model,
    subAgents: [],
    nonInteractive: false,
    firstUserPrompt: meta.title,
    liveState: null,
    provider: "codex",
    contextUsage: meta.contextUsage ?? undefined,
    version: meta.version,
  };
  if (hidden) node.hidden = true;
  return node;
}

function discoverCodexSessions(config: GlobalConfig): SessionTree {
  const root = getCodexSessionsDir();
  const empty: SessionTree = {
    projects: [],
    coldProjects: [],
    totalCount: 0,
    timestamp: new Date().toISOString(),
    hiddenStats: { total: 0, active: 0 },
  };
  if (!existsSync(root)) return empty;

  interface Parsed {
    meta: CodexMeta;
    filePath: string;
    mtimeMs: number;
  }
  const parsed: Parsed[] = [];
  for (const filePath of listRolloutFiles(root)) {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(filePath).mtimeMs;
    } catch {
      continue;
    }
    const meta = parseMeta(filePath, mtimeMs);
    if (meta) parsed.push({ meta, filePath, mtimeMs });
  }

  // Split parents (top-level + orphan sub-agents) from linkable
  // children. A child links only when its parent_thread_id matches a
  // discovered session; orphans surface at top level.
  const byId = new Map<string, Parsed>();
  for (const x of parsed) byId.set(x.meta.id, x);

  const parents: Parsed[] = [];
  const children: Parsed[] = [];
  for (const x of parsed) {
    if (
      x.meta.isSubagent &&
      x.meta.parentThreadId &&
      byId.has(x.meta.parentThreadId)
    ) {
      children.push(x);
    } else {
      parents.push(x);
    }
  }

  const nodesById = new Map<string, SessionNode>();
  const byProject = new Map<string, SessionNode[]>();
  let hiddenTotal = 0;
  let hiddenActive = 0;

  for (const { meta, filePath, mtimeMs } of parents) {
    const projectName = basename(meta.cwd);
    const projectHidden = config.hiddenProjects.includes(projectName);
    const sessionHidden = config.hiddenSessions.includes(
      `${projectName}/${meta.id}`,
    );
    const hidden = projectHidden || sessionHidden;
    const node = makeNode(meta, filePath, mtimeMs, hidden);
    nodesById.set(meta.id, node);
    if (hidden) {
      hiddenTotal++;
      if (node.status === "hot" || node.status === "warm") hiddenActive++;
    }
    const arr = byProject.get(meta.cwd) ?? [];
    arr.push(node);
    byProject.set(meta.cwd, arr);
  }

  for (const { meta, filePath, mtimeMs } of children) {
    const parent = meta.parentThreadId
      ? nodesById.get(meta.parentThreadId)
      : undefined;
    if (!parent) continue; // parent filtered out; skip (shouldn't happen)
    const projectName = parent.projectName;
    const projectHidden = config.hiddenProjects.includes(projectName);
    const subHidden = config.hiddenSubAgents.includes(
      `${projectName}/${meta.id}`,
    );
    const hidden = projectHidden || subHidden;
    const node = makeNode(meta, filePath, mtimeMs, hidden);
    // sub-agents show their spawning prompt as the task description.
    node.taskDescription = meta.title ?? undefined;
    if (hidden) {
      hiddenTotal++;
      if (node.status === "hot" || node.status === "warm") hiddenActive++;
    }
    parent.subAgents.push(node);
  }

  const statusOrder: Record<SessionStatus, number> = {
    hot: 0,
    warm: 1,
    cool: 2,
    cold: 3,
  };

  const allProjects: ProjectNode[] = [];
  for (const [projectPath, sessions] of byProject) {
    if (sessions.length === 0) continue;
    const projectName = sessions[0].projectName;
    sessions.sort((a, b) => {
      const d = statusOrder[a.status] - statusOrder[b.status];
      if (d !== 0) return d;
      return b.lastModifiedMs - a.lastModifiedMs;
    });
    allProjects.push({
      name: projectName,
      projectPath,
      sessions,
      hotness: sessions[0].status,
      hidden: config.hiddenProjects.includes(projectName) || undefined,
    });
  }

  const activeProjects = allProjects.filter((p) => p.hotness !== "cold");
  const coldProjects = allProjects.filter((p) => p.hotness === "cold");
  activeProjects.sort((a, b) => {
    const d = statusOrder[a.hotness] - statusOrder[b.hotness];
    if (d !== 0) return d;
    return b.sessions[0].lastModifiedMs - a.sessions[0].lastModifiedMs;
  });

  const count = (projects: ProjectNode[]) =>
    projects.reduce(
      (sum, p) =>
        sum +
        p.sessions.length +
        p.sessions.reduce((s, sn) => s + sn.subAgents.length, 0),
      0,
    );

  return {
    projects: activeProjects,
    coldProjects,
    totalCount: count(activeProjects) + count(coldProjects),
    timestamp: new Date().toISOString(),
    hiddenStats: { total: hiddenTotal, active: hiddenActive },
  };
}

function execDetail(args: string | undefined): string {
  if (!args) return "";
  try {
    const parsed = JSON.parse(args) as { cmd?: string; message?: string };
    return parsed.cmd ?? parsed.message ?? "";
  } catch {
    return "";
  }
}

function spawnDetail(args: string | undefined): string {
  if (!args) return "";
  try {
    const parsed = JSON.parse(args) as { message?: string };
    return (parsed.message ?? "").split("\n")[0] ?? "";
  } catch {
    return "";
  }
}

export function parseCodexActivities(lines: string[]): ParseResult {
  const activities: ActivityEntry[] = [];
  let modelName: string | null = null;
  let sessionStartTime: Date | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: CodexRecord;
    try {
      rec = JSON.parse(line) as CodexRecord;
    } catch {
      continue;
    }
    const p = rec.payload;
    if (!p) continue;
    const ts = rec.timestamp ? new Date(rec.timestamp) : new Date(0);
    if (!sessionStartTime && rec.timestamp) sessionStartTime = ts;

    if (rec.type === "turn_context" && typeof p.model === "string") {
      modelName = p.model;
    } else if (rec.type === "event_msg") {
      if (p.type === "user_message" && typeof p.message === "string") {
        if (!p.message.trim() || isEnvContext(p.message)) continue;
        activities.push({
          timestamp: ts,
          type: "user",
          icon: ICONS.User,
          label: "User",
          detail: p.message.split("\n")[0] ?? "",
          detailBody: p.message,
        });
      } else if (p.type === "agent_message" && typeof p.message === "string") {
        if (!p.message.trim()) continue;
        activities.push({
          timestamp: ts,
          type: "response",
          icon: ICONS.Response,
          label: "Response",
          detail: p.message.split("\n")[0] ?? "",
          detailBody: p.message,
        });
      }
    } else if (rec.type === "response_item" && p.type === "function_call") {
      if (p.name === "exec_command") {
        activities.push({
          timestamp: ts,
          type: "tool",
          icon: ICONS.Bash,
          label: "Bash",
          detail: execDetail(p.arguments),
        });
      } else if (p.name === "spawn_agent") {
        activities.push({
          timestamp: ts,
          type: "tool",
          icon: ICONS.Task,
          label: "Task",
          detail: spawnDetail(p.arguments),
        });
      }
      // wait_agent / close_agent are bookkeeping — skip.
    }
  }

  return { activities, tokenCount: 0, modelName, sessionStartTime };
}

export const codexProvider: SessionProvider = {
  name: "codex",
  lineDelimited: true,
  isTurnBoundary: (line) => {
    try {
      return JSON.parse(line).type === "turn_context";
    } catch {
      return false;
    }
  },
  isAvailable: () => existsSync(getCodexSessionsDir()),
  discoverSessions: discoverCodexSessions,
  parseActivities: parseCodexActivities,
};
