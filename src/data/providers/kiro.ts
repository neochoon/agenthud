/**
 * Kiro CLI session provider. Discovers sessions at
 * `~/.kiro/sessions/cli/<uuid>.{json,jsonl,history,lock}` (override
 * via `KIRO_SESSIONS_DIR`) and translates them into the shared
 * `SessionTree` shape.
 *
 * Design decisions:
 * - Each session is a pair of files: `.json` is the metadata sidecar
 *   (`cwd`, `title`, `parent_session_id`, etc.) and `.jsonl` is the
 *   conversation log. The `.json` is the primary source for
 *   discovery — `cwd` for project grouping, `parent_session_id` for
 *   sub-agent linkage, `title` for the row description. The `.jsonl`
 *   is opened only for `lastModifiedMs` (its mtime is what tracks
 *   real activity, not the `.json` mtime which can lag).
 * - Sub-agents live in the SAME flat directory as parents. The
 *   `parent_session_id` field (null vs uuid) is the only reliable
 *   distinguisher — `session_created_reason` is `"subagent"` even
 *   on fresh top-level sessions (verified empirically), so it can't
 *   be used as a signal.
 * - `.lock` file presence ≡ session process is alive → `liveState`
 *   becomes `waiting` by default. The richer `working` vs `waiting`
 *   distinction (pending tool_use vs assistant turn yielded) would
 *   require parsing the JSONL tail with Kiro's record shape — left
 *   for a follow-up.
 * - `hideKey` is `${projectName}/${uuid}` matching Claude's scheme,
 *   so the existing `hiddenSessions` config works across both
 *   providers without a Kiro-specific list.
 *
 * Gotchas:
 * - The Kiro CLI also writes `~/Library/Application Support/kiro-cli/
 *   data.sqlite3` as a secondary store (conversations table). We
 *   treat the JSONL files as the source of truth since they hold
 *   full content; the SQLite is currently ignored.
 * - `KIRO_SESSIONS_DIR` env var override mirrors `CLAUDE_PROJECTS_DIR`
 *   for the Claude provider — useful for tests and mounted volumes.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type {
  GlobalConfig,
  LiveState,
  ProjectNode,
  SessionNode,
  SessionStatus,
  SessionTree,
} from "../../types/index.js";
import { ONE_HOUR_MS, THIRTY_MINUTES_MS } from "../../ui/constants.js";
import { parseKiroActivitiesFromLines } from "./kiro-activity.js";
import type { DiscoverOptions, SessionProvider } from "./types.js";

export function getKiroSessionsDir(): string {
  return (
    process.env.KIRO_SESSIONS_DIR ??
    join(homedir(), ".kiro", "sessions", "cli")
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

interface KiroSessionMeta {
  session_id: string;
  cwd: string;
  title?: string;
  parent_session_id?: string | null;
  updated_at?: string;
  created_at?: string;
  // Kiro stores the chosen model under
  // `session_state.rts_model_state.model_info.model_id`. Common
  // value is `"auto"` (Kiro picks dynamically); concrete IDs like
  // `"anthropic.claude-sonnet-4-20250514-v1:0"` also show up when
  // the user pins a model. Sub-agents inherit from the parent and
  // typically have `model_info: null` in their own sidecar.
  session_state?: {
    rts_model_state?: {
      model_info?: {
        model_id?: string | null;
        context_window_tokens?: number | null;
      } | null;
      // Float 0..1 in observed corpora (verify with the
      // verification jq in docs/schemas/kiro-session.md).
      context_usage_percentage?: number | null;
    } | null;
  } | null;
}

function readMeta(jsonPath: string): KiroSessionMeta | null {
  if (!existsSync(jsonPath)) return null;
  try {
    const raw = readFileSync(jsonPath, "utf-8");
    const parsed = JSON.parse(raw) as KiroSessionMeta;
    if (typeof parsed.session_id !== "string") return null;
    if (typeof parsed.cwd !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

interface RawSession {
  id: string;
  hideKey: string;
  filePath: string; // .jsonl path
  projectPath: string;
  projectName: string;
  lastModifiedMs: number;
  title: string | null;
  parentSessionId: string | null;
  hasLock: boolean;
  modelId: string | null;
  contextUsage: { used: number; total: number; percent: number } | null;
}

function shortenModelId(raw: string): string {
  // Concrete Kiro model IDs look like
  // `anthropic.claude-sonnet-4-20250514-v1:0` — strip the
  // `<vendor>.` prefix, drop the date suffix, drop the version
  // tail so the model column stays readable. `auto` stays as-is.
  if (raw === "auto") return raw;
  const noVendor = raw.replace(/^[a-z0-9-]+\./, "");
  const noVersion = noVendor.replace(/-v\d+:\d+$/, "");
  const noDate = noVersion.replace(/-\d{8}$/, "");
  return noDate;
}

function readRawSessions(
  sessionsDir: string,
  options?: DiscoverOptions,
): RawSession[] {
  let entries: string[];
  try {
    entries = readdirSync(sessionsDir) as unknown as string[];
  } catch {
    return [];
  }

  const jsonIds = entries
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));

  const out: RawSession[] = [];
  for (const id of jsonIds) {
    const jsonPath = join(sessionsDir, `${id}.json`);
    const jsonlPath = join(sessionsDir, `${id}.jsonl`);
    const lockPath = join(sessionsDir, `${id}.lock`);

    const meta = readMeta(jsonPath);
    if (!meta) continue;
    if (
      options?.scopeToProject !== undefined &&
      meta.cwd !== options.scopeToProject
    ) {
      continue;
    }

    let mtimeMs: number;
    try {
      mtimeMs = statSync(jsonlPath).mtimeMs;
    } catch {
      // Fall back to the .json mtime if the .jsonl hasn't been
      // written yet (very fresh sessions). Don't drop the row.
      try {
        mtimeMs = statSync(jsonPath).mtimeMs;
      } catch {
        continue;
      }
    }

    const projectName = basename(meta.cwd);
    const rts = meta.session_state?.rts_model_state;
    const rawModelId = rts?.model_info?.model_id;
    const modelId =
      typeof rawModelId === "string" && rawModelId.length > 0
        ? shortenModelId(rawModelId)
        : null;
    // Kiro stores percent (float 0..100) and the absolute window
    // separately. Both nullable on brand-new sessions; we only
    // surface the gauge when we have a real percentage value.
    const pct = rts?.context_usage_percentage;
    const total = rts?.model_info?.context_window_tokens;
    let contextUsage: {
      used: number;
      total: number;
      percent: number;
    } | null = null;
    if (typeof pct === "number" && pct >= 0 && typeof total === "number") {
      contextUsage = {
        used: Math.round((pct / 100) * total),
        total,
        percent: Math.min(100, Math.round(pct)),
      };
    }
    out.push({
      id,
      hideKey: `${projectName}/${id}`,
      filePath: jsonlPath,
      projectPath: meta.cwd,
      projectName,
      lastModifiedMs: mtimeMs,
      title:
        typeof meta.title === "string" && meta.title.trim().length > 0
          ? meta.title
          : null,
      parentSessionId: meta.parent_session_id ?? null,
      hasLock: existsSync(lockPath),
      modelId,
      contextUsage,
    });
  }
  return out;
}

function toSessionNode(raw: RawSession, hidden: boolean): SessionNode {
  const liveState: LiveState | null = raw.hasLock ? "waiting" : null;
  const node: SessionNode = {
    id: raw.id,
    hideKey: raw.hideKey,
    filePath: raw.filePath,
    projectPath: raw.projectPath,
    projectName: raw.projectName,
    lastModifiedMs: raw.lastModifiedMs,
    status: getSessionStatus(raw.lastModifiedMs),
    modelName: raw.modelId,
    subAgents: [],
    nonInteractive: false,
    firstUserPrompt: raw.title,
    liveState,
    provider: "kiro",
    contextUsage: raw.contextUsage ?? undefined,
  };
  if (hidden) node.hidden = true;
  return node;
}

function discoverKiroSessions(
  config: GlobalConfig,
  options?: DiscoverOptions,
): SessionTree {
  const sessionsDir = getKiroSessionsDir();
  if (!existsSync(sessionsDir)) {
    return {
      projects: [],
      coldProjects: [],
      totalCount: 0,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
  }

  const raws = readRawSessions(sessionsDir, options);

  // Separate parents from sub-agents by parent_session_id.
  const parents: RawSession[] = [];
  const children: RawSession[] = [];
  for (const r of raws) {
    if (r.parentSessionId) children.push(r);
    else parents.push(r);
  }

  // Build parent SessionNodes keyed by id, attach sub-agents.
  const parentNodes = new Map<string, SessionNode>();
  const byProject = new Map<string, SessionNode[]>();
  let hiddenTotal = 0;
  let hiddenActive = 0;

  for (const r of parents) {
    const projectHidden = config.hiddenProjects.includes(r.projectName);
    const sessionHidden = config.hiddenSessions.includes(r.hideKey);
    const hidden = projectHidden || sessionHidden;
    const node = toSessionNode(r, hidden);
    parentNodes.set(r.id, node);
    if (hidden) {
      hiddenTotal++;
      if (node.status === "hot" || node.status === "warm") hiddenActive++;
    }
    const arr = byProject.get(r.projectPath) ?? [];
    arr.push(node);
    byProject.set(r.projectPath, arr);
  }

  for (const r of children) {
    // Sub-agents inherit visibility from their parent's project plus
    // the hiddenSubAgents config list.
    const projectHidden = config.hiddenProjects.includes(r.projectName);
    const subHidden = config.hiddenSubAgents.includes(r.hideKey);
    const hidden = projectHidden || subHidden;
    const node = toSessionNode(r, hidden);
    // Kiro sub-agents carry the spawning prompt as their title.
    if (r.title) node.taskDescription = r.title;
    if (hidden) {
      hiddenTotal++;
      if (node.status === "hot" || node.status === "warm") hiddenActive++;
    }
    const parent = parentNodes.get(r.parentSessionId ?? "");
    if (parent) {
      parent.subAgents.push(node);
    } else {
      // Orphan sub-agent (parent missing or unreadable) — surface as
      // a top-level row so it isn't silently lost.
      const arr = byProject.get(r.projectPath) ?? [];
      arr.push(node);
      byProject.set(r.projectPath, arr);
    }
  }

  // Sort + partition projects (identical rules to the Claude provider).
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
    const projectHidden = config.hiddenProjects.includes(projectName);
    sessions.sort((a, b) => {
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return b.lastModifiedMs - a.lastModifiedMs;
    });
    allProjects.push({
      name: projectName,
      projectPath,
      sessions,
      hotness: sessions[0].status,
      hidden: projectHidden || undefined,
    });
  }

  const activeProjects = allProjects.filter((p) => p.hotness !== "cold");
  const coldProjects = allProjects.filter((p) => p.hotness === "cold");

  activeProjects.sort((a, b) => {
    const statusDiff = statusOrder[a.hotness] - statusOrder[b.hotness];
    if (statusDiff !== 0) return statusDiff;
    return b.sessions[0].lastModifiedMs - a.sessions[0].lastModifiedMs;
  });

  const countSessions = (projects: ProjectNode[]) =>
    projects.reduce(
      (sum, p) =>
        sum +
        p.sessions.length +
        p.sessions.reduce((s, sn) => s + sn.subAgents.length, 0),
      0,
    );
  const totalCount =
    countSessions(activeProjects) + countSessions(coldProjects);

  return {
    projects: activeProjects,
    coldProjects,
    totalCount,
    timestamp: new Date().toISOString(),
    hiddenStats: { total: hiddenTotal, active: hiddenActive },
  };
}

export const kiroProvider: SessionProvider = {
  name: "kiro",
  isAvailable: () => existsSync(getKiroSessionsDir()),
  discoverSessions: discoverKiroSessions,
  parseActivities: parseKiroActivitiesFromLines,
};
