/**
 * opencode provider — sessions from opencode's SQLite store.
 *
 * Version: captured onto SessionNode.version (see the parser
 * version-drift spec, docs/superpowers/specs/2026-06-19-parser-version-drift-design.md).
 *
 * Design decisions:
 * - Unlike every other provider (per-session JSON/JSONL files), opencode
 *   keeps all sessions in one SQLite DB. We open it READ-ONLY and query;
 *   there is no file to scan. See docs/schemas/opencode-session.md.
 * - `node:sqlite` is loaded through a guarded require so agenthud still
 *   runs on Node < 22 (where the module is absent): the provider simply
 *   reports `isAvailable() === false` instead of crashing the app. No new
 *   dependency, no forced engine bump.
 * - Sessions have no real path, so each `SessionNode.filePath` is a
 *   synthetic `opencode:<sessionId>` token. `sessionHistory` routes that
 *   prefix to `parseOpenCodeSessionActivities` (a DB query) instead of a
 *   file read.
 *
 * Gotcha:
 * - `node:sqlite` emits a one-time ExperimentalWarning on first use; we
 *   filter exactly that warning so it can't corrupt the TUI's stderr.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
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
import type { DiscoverOptions, ParseResult, SessionProvider } from "./types.js";

export const OPENCODE_PATH_PREFIX = "opencode:";

/** Synthetic filePath for an opencode session (no real file exists). */
export function opencodeFilePath(sessionId: string): string {
  return OPENCODE_PATH_PREFIX + sessionId;
}

/** Recover the session id from a synthetic opencode filePath. */
export function sessionIdFromPath(filePath: string): string | null {
  return filePath.startsWith(OPENCODE_PATH_PREFIX)
    ? filePath.slice(OPENCODE_PATH_PREFIX.length)
    : null;
}

export function getOpenCodeDbPath(): string {
  if (process.env.OPENCODE_DB) return process.env.OPENCODE_DB;
  const dataHome =
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "opencode.db");
}

// --- node:sqlite guarded loader -------------------------------------------
// node:sqlite's types vary by Node version (and are absent < 22), so the
// DB handle is loosely typed.
type SqliteDb = any;
let sqliteMod:
  | { DatabaseSync: new (path: string, opts?: object) => SqliteDb }
  | null
  | undefined;

function loadSqlite() {
  if (sqliteMod !== undefined) return sqliteMod;
  // Filter only the SQLite ExperimentalWarning so it can't reach the TUI.
  const originalEmit = process.emitWarning;
  const filtered: typeof process.emitWarning = (warning, ...rest) => {
    const opts = rest[0];
    const type =
      typeof opts === "string"
        ? opts
        : opts && typeof opts === "object" && "type" in opts
          ? (opts as { type?: string }).type
          : undefined;
    if (type === "ExperimentalWarning" && String(warning).includes("SQLite")) {
      return;
    }
    return (originalEmit as (...a: unknown[]) => void)(warning, ...rest);
  };
  process.emitWarning = filtered;
  try {
    // Use require so a missing built-in (Node < 22) throws here, caught below,
    // instead of failing the ESM module graph at import time.
    const req = createRequire(import.meta.url);
    sqliteMod = req("node:sqlite") as typeof sqliteMod;
    // Keep the filter installed on success: the warning fires on first DB
    // use (later), not necessarily here.
  } catch {
    // Unavailable (Node < 22): restore the original handler — nothing in
    // this process will emit the SQLite warning, so leave no global trace.
    process.emitWarning = originalEmit;
    sqliteMod = null;
  }
  return sqliteMod;
}

/** Open the opencode DB read-only, or null if unavailable. Caller closes. */
function openDb(): SqliteDb | null {
  const mod = loadSqlite();
  if (!mod) return null;
  const path = getOpenCodeDbPath();
  if (!existsSync(path)) return null;
  try {
    return new mod.DatabaseSync(path, { readOnly: true });
  } catch {
    return null;
  }
}

// --- status / context helpers ---------------------------------------------

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

// opencode's models.json (XDG cache) carries true context windows, but its
// shape varies; until that lookup lands, assume a conservative window so the
// gauge is directional. Tracked in docs/schemas/opencode-session.md.
const ASSUMED_WINDOW = 200_000;

interface LatestAssistant {
  used: number;
  modelID: string | null;
  working: boolean;
}

function readModelId(modelJson: string | null): string | null {
  if (!modelJson) return null;
  try {
    return (JSON.parse(modelJson) as { id?: string }).id ?? null;
  } catch {
    return null;
  }
}

function parseLatestAssistant(dataJson: string): LatestAssistant | null {
  try {
    const d = JSON.parse(dataJson) as {
      role?: string;
      modelID?: string;
      tokens?: { input?: number; cache?: { read?: number } };
      time?: { completed?: number };
    };
    if (d.role !== "assistant") return null;
    const used = (d.tokens?.input ?? 0) + (d.tokens?.cache?.read ?? 0);
    return {
      used,
      modelID: d.modelID ?? null,
      working: d.time?.completed == null,
    };
  } catch {
    return null;
  }
}

// --- schema version --------------------------------------------------------

/**
 * OpenCode's schema version = the latest applied migration id (the ids are
 * timestamp-prefixed, so the lexical max is the newest). DB-wide; read once
 * per discovery. Undefined when the table is absent or empty.
 */
function readSchemaVersion(db: SqliteDb): string | undefined {
  try {
    const row = db
      .prepare("SELECT id FROM migration ORDER BY id DESC LIMIT 1")
      .get() as { id?: string } | undefined;
    return typeof row?.id === "string" ? row.id : undefined;
  } catch {
    return undefined; // table may not exist on older installs
  }
}

// --- discovery -------------------------------------------------------------

interface SessionRow {
  id: string;
  parent_id: string | null;
  directory: string;
  title: string;
  model: string | null;
  time_updated: number;
}

function makeNode(
  row: SessionRow,
  latest: LatestAssistant | undefined,
  hidden: boolean,
  schemaVersion: string | undefined,
): SessionNode {
  const projectName = basename(row.directory);
  const model = readModelId(row.model) ?? latest?.modelID ?? null;
  const node: SessionNode = {
    id: row.id,
    hideKey: `${projectName}/${row.id}`,
    filePath: opencodeFilePath(row.id),
    projectPath: row.directory,
    projectName,
    lastModifiedMs: row.time_updated,
    status: getSessionStatus(row.time_updated),
    modelName: model,
    subAgents: [],
    nonInteractive: false,
    firstUserPrompt: row.title || null,
    liveState: latest?.working ? "working" : null,
    provider: "opencode",
    version: schemaVersion,
  };
  if (latest && latest.used > 0) {
    node.contextUsage = {
      used: latest.used,
      total: ASSUMED_WINDOW,
      percent: Math.min(100, Math.round((latest.used / ASSUMED_WINDOW) * 100)),
    };
  }
  if (hidden) node.hidden = true;
  return node;
}

function emptyTree(): SessionTree {
  return {
    projects: [],
    coldProjects: [],
    totalCount: 0,
    timestamp: new Date().toISOString(),
    hiddenStats: { total: 0, active: 0 },
  };
}

function discoverSessions(
  config: GlobalConfig,
  options?: DiscoverOptions,
): SessionTree {
  const db = openDb();
  if (!db) return emptyTree();

  try {
    const schemaVersion = readSchemaVersion(db);

    const rows = db
      .prepare(
        `SELECT id, parent_id, directory, title, model, time_updated
         FROM session WHERE time_archived IS NULL
         ORDER BY time_updated DESC`,
      )
      .all() as SessionRow[];

    // Latest assistant message per session → context + liveness + model.
    const latestById = new Map<string, LatestAssistant>();
    const msgRows = db
      .prepare(
        `SELECT m.session_id AS sid, m.data AS data FROM message m
         JOIN (SELECT session_id, MAX(time_created) mt FROM message
               WHERE json_extract(data,'$.role')='assistant'
               GROUP BY session_id) x
         ON m.session_id = x.session_id AND m.time_created = x.mt`,
      )
      .all() as Array<{ sid: string; data: string }>;
    for (const r of msgRows) {
      const la = parseLatestAssistant(r.data);
      if (la) latestById.set(r.sid, la);
    }

    const byId = new Map<string, SessionRow>();
    for (const r of rows) byId.set(r.id, r);

    const nodesById = new Map<string, SessionNode>();
    const byProject = new Map<string, SessionNode[]>();
    let hiddenTotal = 0;
    let hiddenActive = 0;

    // Top-level sessions first.
    for (const row of rows) {
      if (row.parent_id && byId.has(row.parent_id)) continue; // child
      if (options?.scopeToProject && row.directory !== options.scopeToProject) {
        continue;
      }
      const projectName = basename(row.directory);
      const hidden =
        config.hiddenProjects.includes(projectName) ||
        config.hiddenSessions.includes(`${projectName}/${row.id}`);
      const node = makeNode(row, latestById.get(row.id), hidden, schemaVersion);
      nodesById.set(row.id, node);
      if (hidden) {
        hiddenTotal++;
        if (node.status === "hot" || node.status === "warm") hiddenActive++;
      }
      const arr = byProject.get(row.directory) ?? [];
      arr.push(node);
      byProject.set(row.directory, arr);
    }

    // Child sessions → sub-agents.
    for (const row of rows) {
      if (!row.parent_id || !byId.has(row.parent_id)) continue;
      const parent = nodesById.get(row.parent_id);
      if (!parent) continue; // parent scoped/hidden out
      const projectName = parent.projectName;
      const hidden =
        config.hiddenProjects.includes(projectName) ||
        config.hiddenSubAgents.includes(`${projectName}/${row.id}`);
      const node = makeNode(row, latestById.get(row.id), hidden, schemaVersion);
      node.agentId = row.id;
      node.taskDescription = row.title || undefined;
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
        return d !== 0 ? d : b.lastModifiedMs - a.lastModifiedMs;
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
      return d !== 0
        ? d
        : b.sessions[0].lastModifiedMs - a.sessions[0].lastModifiedMs;
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
  } catch {
    return emptyTree();
  } finally {
    db.close();
  }
}

// --- activities ------------------------------------------------------------

/** One line = a JSON envelope `{ role, t, part }` (part = a `part.data`
 * object). Kept line-shaped so the mapper is unit-testable with synthetic
 * input, mirroring the other providers' `parseXActivities(lines)`. */
interface PartEnvelope {
  role?: string;
  t?: number;
  part?: {
    type?: string;
    tool?: string;
    text?: string;
    state?: { title?: string; status?: string };
  };
}

export function parseActivities(lines: string[]): ParseResult {
  const activities: ActivityEntry[] = [];
  let sessionStartTime: Date | null = null;

  for (const line of lines) {
    let env: PartEnvelope;
    try {
      env = JSON.parse(line) as PartEnvelope;
    } catch {
      continue;
    }
    const part = env.part;
    if (!part) continue;
    const ts = new Date(env.t ?? 0);
    if (!sessionStartTime) sessionStartTime = ts;

    switch (part.type) {
      case "text": {
        const text = (part.text ?? "").trim();
        if (!text) continue;
        if (env.role === "user") {
          activities.push({
            timestamp: ts,
            type: "user",
            icon: ICONS.User,
            label: "User",
            detail: text.split("\n")[0] ?? "",
            detailBody: text.includes("\n") ? text : undefined,
          });
        } else {
          activities.push({
            timestamp: ts,
            type: "response",
            icon: ICONS.Response,
            label: "Response",
            detail: text.split("\n")[0] ?? "",
            detailBody: text.includes("\n") ? text : undefined,
          });
        }
        break;
      }
      case "reasoning": {
        const text = (part.text ?? "").trim();
        if (!text) continue;
        activities.push({
          timestamp: ts,
          type: "thinking",
          icon: ICONS.Thinking,
          label: "Thinking",
          detail: text.split("\n")[0] ?? "",
        });
        break;
      }
      case "tool": {
        const tool = part.tool ?? "tool";
        activities.push({
          timestamp: ts,
          type: "tool",
          icon: ICONS.Default,
          label: tool,
          detail: part.state?.title ?? "",
        });
        break;
      }
      // step-start / step-finish are turn boundaries — skipped.
    }
  }

  return { activities, tokenCount: 0, modelName: null, sessionStartTime };
}

/** Build the full activity history for one opencode session via the DB. */
export function parseOpenCodeSessionActivities(
  sessionId: string,
): ActivityEntry[] {
  const db = openDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT p.data AS pdata, p.time_created AS t,
                json_extract(m.data,'$.role') AS role
         FROM part p JOIN message m ON p.message_id = m.id
         WHERE p.session_id = ?
         ORDER BY p.time_created ASC`,
      )
      .all(sessionId) as Array<{ pdata: string; t: number; role: string }>;
    // Per-row guard: one malformed part.data must not blank the whole
    // timeline (parseActivities guards each line too, but the pre-parse
    // here would otherwise throw for the entire session).
    const lines: string[] = [];
    for (const r of rows) {
      try {
        lines.push(
          JSON.stringify({ role: r.role, t: r.t, part: JSON.parse(r.pdata) }),
        );
      } catch {
        // skip this malformed part
      }
    }
    return parseActivities(lines).activities;
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function isAvailable(): boolean {
  return loadSqlite() != null && existsSync(getOpenCodeDbPath());
}

export const opencodeProvider: SessionProvider = {
  name: "opencode",
  lineDelimited: false,
  isAvailable,
  discoverSessions,
  parseActivities,
};
