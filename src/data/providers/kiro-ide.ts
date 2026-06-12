/**
 * Kiro IDE session provider. The IDE (a VSCode fork) stores agent
 * sessions under its extension globalStorage — a different layout
 * and record format from Kiro CLI:
 *
 *   <storage>/workspace-sessions/<base64-of-workspace-path>/
 *   ├── sessions.json        index: [{sessionId, title, dateCreated,
 *   │                                 workspaceDirectory}]
 *   └── <session-uuid>.json  full session state as ONE JSON document
 *                            (not JSONL) — history[], model, context
 *
 * Design decisions:
 * - Discovery iterates workspace dirs and reads each `sessions.json`
 *   index, then the per-session file for model/context/history. The
 *   `workspaceDirectory` field is used for project grouping (the
 *   base64 directory name decodes to the same value but the field
 *   is authoritative and cheaper).
 * - `history[]` entries carry NO timestamps. Activities therefore
 *   all carry the session file's mtime — good enough for "what
 *   happened in this session", wrong for intra-session ordering by
 *   wall-clock. Documented limitation; execution files have real
 *   timestamps and are the planned follow-up source.
 * - `liveState` stays null in this MVP. The `active` field in the
 *   session file is stale during a run (the file is only rewritten
 *   at turn end), so it can't drive a working/waiting badge.
 *   Execution-index parsing (status: "running" + PendingAction
 *   detection) is the follow-up that makes this provider live.
 * - Sub-agents are NOT separate sessions in the IDE — they're
 *   actions inside the parent's execution log tagged with
 *   `subExecutionId`. This MVP shows none; follow-up will surface
 *   them from execution files.
 *
 * Gotchas:
 * - `contextUsagePercentage` is a percent with no window size in
 *   the file. `used`/`total` are synthesized against an assumed
 *   200K window (Kiro CLI reports 200_000 for the same models);
 *   the renderer only displays `percent`, so the assumption is
 *   cosmetic.
 * - Default storage root is platform-dependent (VSCode-fork
 *   convention). `KIRO_IDE_SESSIONS_DIR` overrides — point it at
 *   the `workspace-sessions` directory itself.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type {
  ActivityEntry,
  GlobalConfig,
  LiveState,
  ProjectNode,
  SessionNode,
  SessionStatus,
  SessionTree,
} from "../../types/index.js";
import { ICONS } from "../../types/index.js";
import { ONE_HOUR_MS, THIRTY_MINUTES_MS } from "../../ui/constants.js";
import type { ParseContext, ParseResult, SessionProvider } from "./types.js";

export function getKiroIdeSessionsDir(): string {
  if (process.env.KIRO_IDE_SESSIONS_DIR) {
    return process.env.KIRO_IDE_SESSIONS_DIR;
  }
  const sub = join(
    "Kiro",
    "User",
    "globalStorage",
    "kiro.kiroagent",
    "workspace-sessions",
  );
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", sub);
  }
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      sub,
    );
  }
  return join(homedir(), ".config", sub);
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

interface IdeIndexEntry {
  sessionId?: string;
  title?: string;
  dateCreated?: string;
  workspaceDirectory?: string;
}

interface IdeHistoryEntry {
  message?: {
    role?: string;
    content?: unknown;
    id?: string;
  };
}

interface IdeSessionFile {
  sessionId?: string;
  title?: string;
  workspaceDirectory?: string;
  selectedModel?: unknown;
  contextUsagePercentage?: number | null;
  history?: IdeHistoryEntry[];
}

// Kiro CLI reports context_window_tokens: 200000 for the same
// model family; the IDE file carries only the percentage, so we
// synthesize used/total against that assumption. Only `percent`
// is rendered.
const ASSUMED_WINDOW = 200_000;

function readSessionFile(path: string): IdeSessionFile | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as IdeSessionFile;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function toNode(
  meta: IdeIndexEntry,
  file: IdeSessionFile | null,
  jsonPath: string,
  mtimeMs: number,
  hidden: boolean,
): SessionNode | null {
  const id = meta.sessionId ?? file?.sessionId;
  const workspace = meta.workspaceDirectory ?? file?.workspaceDirectory;
  if (!id || !workspace) return null;
  const projectName = basename(workspace);

  const pct = file?.contextUsagePercentage;
  const contextUsage =
    typeof pct === "number" && pct >= 0
      ? {
          used: Math.round((pct / 100) * ASSUMED_WINDOW),
          total: ASSUMED_WINDOW,
          percent: Math.min(100, Math.round(pct)),
        }
      : undefined;

  const model = file?.selectedModel;
  const node: SessionNode = {
    id,
    hideKey: `${projectName}/${id}`,
    filePath: jsonPath,
    projectPath: workspace,
    projectName,
    lastModifiedMs: mtimeMs,
    status: getSessionStatus(mtimeMs),
    modelName: typeof model === "string" && model.length > 0 ? model : null,
    subAgents: [],
    nonInteractive: false,
    firstUserPrompt: meta.title ?? file?.title ?? null,
    liveState: null,
    provider: "kiro-ide",
    contextUsage,
  };
  if (hidden) node.hidden = true;
  return node;
}

interface IdeExecutionAction {
  actionType?: string;
  actionState?: string;
  subExecutionId?: string;
  input?: { prompt?: string; command?: string };
  output?: { response?: string; subExecutionId?: string };
  emittedAt?: number;
  endTime?: number;
}

interface IdeExecution {
  executionId?: string;
  status?: string;
  startTime?: number;
  endTime?: number;
  chatSessionId?: string;
  actions?: IdeExecutionAction[];
}

// Execution-file parse cache keyed by path → {mtime, value}. The
// files are rewritten constantly while a turn runs but stay
// untouched afterward; without the cache every 2s poll re-reads
// and re-parses every historical execution (some are 200KB+).
const execCache = new Map<
  string,
  { mtimeMs: number; value: IdeExecution | null }
>();

/** Test hook: the cache is module-level and keyed by (path, mtime),
 * which collides across test cases that mock the same fake path
 * with the same fake mtime. Production never needs this. */
export function clearKiroIdeExecutionCache(): void {
  execCache.clear();
}

function readExecutionFile(path: string, mtimeMs: number): IdeExecution | null {
  const cached = execCache.get(path);
  if (cached && cached.mtimeMs === mtimeMs) return cached.value;
  let value: IdeExecution | null = null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as IdeExecution;
    // Identify execution files structurally — profile dirs also
    // hold index files and other JSON we don't care about.
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.chatSessionId === "string" &&
      Array.isArray(parsed.actions)
    ) {
      value = parsed;
    }
  } catch {
    value = null;
  }
  execCache.set(path, { mtimeMs, value });
  return value;
}

/**
 * Walk the agent root's profile directories for execution files and
 * synthesize sub-agent SessionNodes, grouped by the parent session's
 * uuid (`chatSessionId`).
 *
 * IDE sub-agents aren't separate session files (unlike the CLI) —
 * they exist as actions inside the parent's execution log:
 *   - `invokeSubAgent` carries the spawning prompt (input.prompt)
 *     and the child's id (output.subExecutionId)
 *   - subsequent actions tagged with that subExecutionId are the
 *     child's own steps; their timestamps drive recency
 *   - any action still in `PendingAction` ⇒ the child is parked on
 *     the IDE's approval gate ⇒ liveState "waiting" (the user-facing
 *     answer to "is it even running?")
 */
function buildSubAgentsBySession(
  agentRoot: string,
  config: GlobalConfig,
): Map<string, SessionNode[]> {
  const out = new Map<string, SessionNode[]>();
  let profileDirs: string[];
  try {
    profileDirs = readdirSync(agentRoot) as unknown as string[];
  } catch {
    return out;
  }

  for (const profile of profileDirs) {
    if (profile === "workspace-sessions" || profile === "dev_data") continue;
    const profilePath = join(agentRoot, profile);
    let entries: string[];
    try {
      if (!statSync(profilePath).isDirectory()) continue;
      entries = readdirSync(profilePath) as unknown as string[];
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = join(profilePath, entry);
      let isDir: boolean;
      try {
        isDir = statSync(entryPath).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue; // top-level files are indexes, skip
      let execFiles: string[];
      try {
        execFiles = readdirSync(entryPath) as unknown as string[];
      } catch {
        continue;
      }
      for (const f of execFiles) {
        const execPath = join(entryPath, f);
        let mtimeMs: number;
        try {
          mtimeMs = statSync(execPath).mtimeMs;
        } catch {
          continue;
        }
        const exec = readExecutionFile(execPath, mtimeMs);
        if (!exec?.chatSessionId || !exec.actions) continue;

        // Collect sub-agent groups within this execution.
        for (const action of exec.actions) {
          if (action.actionType !== "invokeSubAgent") continue;
          const subId = action.output?.subExecutionId ?? action.subExecutionId;
          if (!subId) continue;

          const groupActions = exec.actions.filter(
            (a) => a.subExecutionId === subId,
          );
          const timestamps = groupActions
            .flatMap((a) => [a.emittedAt, a.endTime])
            .filter((t): t is number => typeof t === "number");
          const lastMs =
            timestamps.length > 0
              ? Math.max(...timestamps)
              : (exec.endTime ?? exec.startTime ?? mtimeMs);

          const pending = groupActions.some(
            (a) => a.actionState === "PendingAction",
          );
          const running =
            exec.status === "running" &&
            !groupActions.some((a) => a.actionType === "subagent_response");
          // Recency gate (same 30m rule as the other providers): a
          // quit IDE leaves executions parked in "running" /
          // "PendingAction" forever — without the gate those dead
          // approvals would wear a live badge indefinitely.
          const recentlyActive = Date.now() - lastMs < THIRTY_MINUTES_MS;
          const liveState: LiveState | null = !recentlyActive
            ? null
            : pending
              ? "waiting"
              : running
                ? "working"
                : null;

          const prompt = action.input?.prompt ?? "";
          out.set(exec.chatSessionId, [
            ...(out.get(exec.chatSessionId) ?? []),
            {
              id: subId,
              hideKey: "", // parent fills in projectName below
              filePath: execPath,
              projectPath: "",
              projectName: "",
              lastModifiedMs: lastMs,
              status: getSessionStatus(lastMs),
              modelName: null,
              subAgents: [],
              taskDescription: prompt.split("\n")[0] || undefined,
              nonInteractive: false,
              firstUserPrompt: null,
              liveState,
              provider: "kiro-ide",
            },
          ]);
        }
      }
    }
  }
  return out;
}

function discoverKiroIdeSessions(config: GlobalConfig): SessionTree {
  const root = getKiroIdeSessionsDir();
  const empty: SessionTree = {
    projects: [],
    coldProjects: [],
    totalCount: 0,
    timestamp: new Date().toISOString(),
    hiddenStats: { total: 0, active: 0 },
  };
  if (!existsSync(root)) return empty;

  let workspaceDirs: string[];
  try {
    workspaceDirs = readdirSync(root) as unknown as string[];
  } catch {
    return empty;
  }

  const byProject = new Map<string, SessionNode[]>();
  let hiddenTotal = 0;
  let hiddenActive = 0;

  // Sub-agents come from execution files, which live under sibling
  // profile dirs of workspace-sessions — i.e. the agent root is the
  // parent directory of the sessions root.
  const subAgentsBySession = buildSubAgentsBySession(dirname(root), config);

  for (const ws of workspaceDirs) {
    const wsDir = join(root, ws);
    const indexPath = join(wsDir, "sessions.json");
    if (!existsSync(indexPath)) continue;

    let index: IdeIndexEntry[];
    try {
      const parsed = JSON.parse(readFileSync(indexPath, "utf-8"));
      if (!Array.isArray(parsed)) continue;
      index = parsed as IdeIndexEntry[];
    } catch {
      continue;
    }

    for (const meta of index) {
      if (!meta?.sessionId) continue;
      const jsonPath = join(wsDir, `${meta.sessionId}.json`);
      let mtimeMs: number;
      try {
        mtimeMs = statSync(jsonPath).mtimeMs;
      } catch {
        continue;
      }
      const file = readSessionFile(jsonPath);
      const workspace = meta.workspaceDirectory ?? file?.workspaceDirectory;
      if (!workspace) continue;
      const projectName = basename(workspace);
      const projectHidden = config.hiddenProjects.includes(projectName);
      const sessionHidden = config.hiddenSessions.includes(
        `${projectName}/${meta.sessionId}`,
      );
      const hidden = projectHidden || sessionHidden;

      const node = toNode(meta, file, jsonPath, mtimeMs, hidden);
      if (!node) continue;
      if (hidden) {
        hiddenTotal++;
        if (node.status === "hot" || node.status === "warm") hiddenActive++;
      }

      // Attach sub-agents discovered in execution files. Fill in
      // the project-scoped fields the builder couldn't know.
      const subs = subAgentsBySession.get(node.id) ?? [];
      for (const sub of subs) {
        sub.projectPath = workspace;
        sub.projectName = projectName;
        sub.hideKey = `${projectName}/${sub.id}`;
        const subHidden =
          projectHidden || config.hiddenSubAgents.includes(sub.hideKey);
        if (subHidden) {
          sub.hidden = true;
          hiddenTotal++;
          if (sub.status === "hot" || sub.status === "warm") hiddenActive++;
        }
        node.subAgents.push(sub);
      }

      const arr = byProject.get(workspace) ?? [];
      arr.push(node);
      byProject.set(workspace, arr);
    }
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

function firstTextBlock(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const block = content.find(
      (b: { type?: string; text?: string }) =>
        b && b.type === "text" && typeof b.text === "string",
    ) as { text?: string } | undefined;
    return block?.text ?? "";
  }
  return "";
}

/**
 * Parse a Kiro IDE session file's `history[]` into activities.
 * Receives the file content as lines (per the SessionProvider
 * interface) and re-joins before parsing — the session file is a
 * single JSON document, possibly pretty-printed across lines.
 *
 * Limitation: history entries carry no timestamps; every activity
 * gets epoch 0 here and the caller's display layer falls back to
 * relative ordering. Execution files have real timestamps and are
 * the follow-up source.
 */
function actionToActivity(a: IdeExecutionAction): ActivityEntry | null {
  const ts = new Date(a.emittedAt ?? a.endTime ?? 0);
  switch (a.actionType) {
    case "runCommand":
      return {
        timestamp: ts,
        type: "tool",
        icon: ICONS.Bash,
        label: "Bash",
        detail: a.input?.command ?? "",
      };
    case "readFiles":
      return {
        timestamp: ts,
        type: "tool",
        icon: ICONS.Read,
        label: "Read",
        detail: "",
      };
    case "invokeSubAgent": {
      const prompt = a.input?.prompt ?? "";
      return {
        timestamp: ts,
        type: "tool",
        icon: ICONS.Task,
        label: "Task",
        detail: prompt.split("\n")[0] ?? "",
        detailBody: a.output?.response || prompt,
      };
    }
    case "say": {
      const text =
        typeof a.output === "string"
          ? a.output
          : ((a.output as { response?: string } | undefined)?.response ?? "");
      if (!text) return null;
      return {
        timestamp: ts,
        type: "response",
        icon: ICONS.Response,
        label: "Response",
        detail: text.split("\n")[0] ?? "",
        detailBody: text,
      };
    }
    default:
      return null; // model / bookkeeping actions add no user-facing info
  }
}

export function parseKiroIdeActivities(
  lines: string[],
  context?: ParseContext,
): ParseResult {
  const empty: ParseResult = {
    activities: [],
    tokenCount: 0,
    modelName: null,
    sessionStartTime: null,
  };
  let doc: IdeSessionFile & IdeExecution;
  try {
    doc = JSON.parse(lines.join("\n")) as IdeSessionFile & IdeExecution;
  } catch {
    return empty;
  }
  if (!doc || typeof doc !== "object") return empty;

  // Execution document (sub-agent filePath points here): map the
  // actions[] stream to activities. The whole execution is shown —
  // parent steps and every sub-agent's steps interleaved in emit
  // order — which is more context, not less, when inspecting a
  // sub-agent row.
  if (Array.isArray(doc.actions)) {
    const activities = doc.actions
      .map(actionToActivity)
      .filter((a): a is ActivityEntry => a !== null)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    return {
      activities,
      tokenCount: 0,
      modelName: null,
      sessionStartTime:
        typeof doc.startTime === "number" ? new Date(doc.startTime) : null,
    };
  }

  if (!Array.isArray(doc.history)) return empty;

  const activities: ActivityEntry[] = [];
  // History entries carry no timestamps. The session file's mtime
  // (passed via context) is the best stand-in — it makes the
  // activities land on the day the session was last touched so the
  // report's same-day filter doesn't silently drop the session.
  // Epoch fallback keeps direct callers (tests) working.
  const ts = new Date(context?.mtimeMs ?? 0);
  for (const entry of doc.history) {
    const role = entry?.message?.role;
    const text = firstTextBlock(entry?.message?.content);
    if (!text || !text.trim()) continue;
    if (role === "user") {
      activities.push({
        timestamp: ts,
        type: "user",
        icon: ICONS.User,
        label: "User",
        detail: text.split("\n")[0] ?? "",
        detailBody: text,
      });
    } else if (role === "assistant") {
      activities.push({
        timestamp: ts,
        type: "response",
        icon: ICONS.Response,
        label: "Response",
        detail: text.split("\n")[0] ?? "",
        detailBody: text,
      });
    }
  }

  const model = doc.selectedModel;
  return {
    activities,
    tokenCount: 0,
    modelName: typeof model === "string" ? model : null,
    sessionStartTime: activities.length > 0 ? ts : null,
  };
}

export const kiroIdeProvider: SessionProvider = {
  name: "kiro-ide",
  isAvailable: () => existsSync(getKiroIdeSessionsDir()),
  discoverSessions: discoverKiroIdeSessions,
  parseActivities: parseKiroIdeActivities,
};
