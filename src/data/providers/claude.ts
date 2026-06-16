/**
 * Walk `~/.claude/projects/` to discover every session and sub-agent,
 * build the typed `SessionTree` (active projects + cold-only projects
 * × their sessions × their sub-agents). Also exposes
 * `findContainingProject` for the `--cwd` scoping feature and
 * `decodeProjectPath` for reversing Claude's directory-name encoding.
 *
 * Design decisions:
 * - Project paths are encoded in directory names with hyphens
 *   replacing `/` (e.g., `/Users/neo/myproject` →
 *   `-Users-neochoon-WestbrookAI-agenthud`). `decodeProjectPath`
 *   reverses this. Windows drives use a different encoding
 *   (`C--Users-neo` → `C:\Users\neo`) and are detected by a
 *   leading-letter pattern.
 * - Sub-agents live under `<projectDir>/<sessionId>/subagents/*.jsonl`.
 *   `buildSubAgents` is intentionally per-session so the parent
 *   carries its own sub-agent list as a tree branch — never a
 *   flat global list.
 * - `findContainingProject` does longest-prefix match for cwd →
 *   project resolution (used by `--cwd`). A `realpath` injection
 *   point exists for callers that want symlink-aware resolution.
 *
 * Gotchas:
 * - `findContainingProject` matches by string by default. Callers
 *   on systems with symlinks should pass `{ realpath: realpathSync }`
 *   or pre-resolve before calling.
 * - `CLAUDE_PROJECTS_DIR` env var overrides the default
 *   `~/.claude/projects` location — useful for backups or mounted
 *   volumes. Read once at module load via `getProjectsDir()`.
 * - Imports `ONE_HOUR_MS` / `THIRTY_MINUTES_MS` from
 *   `ui/constants.ts` — same layer-violation note as
 *   `sessionLiveness.ts`.
 */

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
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
import { detectLiveState } from "../sessionLiveness.js";
import { parseActivitiesFromLines, parseModelName } from "./claude-activity.js";
import type { DiscoverOptions, SessionProvider } from "./types.js";

export function getProjectsDir(): string {
  return (
    process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects")
  );
}

export function decodeProjectPath(encoded: string): string {
  const windowsDriveMatch = encoded.match(/^([A-Za-z])--(.*)$/);
  if (windowsDriveMatch) {
    const drive = windowsDriveMatch[1];
    const rest = windowsDriveMatch[2].replace(/-/g, "\\");
    return `${drive}:\\${rest}`;
  }
  return encoded.replace(/-/g, "/");
}

function getSessionStatus(mtimeMs: number): SessionStatus {
  const now = Date.now();
  const age = now - mtimeMs;
  if (age < THIRTY_MINUTES_MS) return "hot";
  if (age < ONE_HOUR_MS) return "warm";

  // Use UTC date comparison for timezone-consistent behavior.
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

// Generous safety cap to keep arbitrarily long sub-agent task headers or
// user prompts out of memory while leaving the actual display-width
// truncation to the panel (which knows the terminal width and adds "…").
const MAX_TITLE_LEN = 300;

function capWithEllipsis(s: string, max = MAX_TITLE_LEN): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function extractTaskDescription(content: string): string {
  // "## Task N: Title" markdown header
  const headerMatch = content.match(/##\s*(Task\s+\d+[:\s].+)/m);
  if (headerMatch) return capWithEllipsis(headerMatch[1]);

  // "**This Task (Task N of M):** Title"
  const thisTaskMatch = content.match(/\*\*This Task[^:]+:\*\*\s*(.+)/);
  if (thisTaskMatch) return capWithEllipsis(thisTaskMatch[1]);

  // Fall back to first non-empty line
  const firstLine = content.split("\n").find((l) => l.trim());
  return capWithEllipsis(firstLine ?? "");
}

// Per-file derived-data caches keyed by `${path}:${mtimeMs}`.
// Discovery runs on every ~2s poll and re-reads each session +
// sub-agent file for model / liveState / context / prompt. With
// hundreds of (mostly cold) sub-agent files that uncached re-read
// dominated discovery wall time (~1.4s, blocking navigation). Cold
// files never change mtime, so they read once and stay cached.
//
// Caveat: `liveState` is cached with the file's structural verdict
// at read time. The 30-minute recency boundary can therefore lag by
// up to one poll for a file that goes idle without any further
// write (same mtime → cache hit). Acceptable: a ~2s delay on a
// hot→cool transition, invisible in practice.
// Per-file derived caches. Keyed by path (NOT by path+mtime) with the
// mtime stored alongside the value, so a session that changes every poll
// overwrites its one entry instead of accumulating a new key forever —
// the long-run leak. One entry per file ⇒ bounded by the file count.
type Memo<V> = Map<string, { mtimeMs: number; value: V }>;

const tailCache: Memo<{
  modelName: string | null;
  liveState: LiveState | null;
  contextUsage: { used: number; total: number; percent: number } | null;
}> = new Map();
const promptCache: Memo<string | null> = new Map();
const entrypointCache: Memo<string | null> = new Map();
const subAgentInfoCache: Memo<{
  agentId: string | null;
  taskDescription: string | null;
}> = new Map();

function memoByMtime<V>(
  cache: Memo<V>,
  filePath: string,
  mtimeMs: number,
  compute: () => V,
): V {
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.value;
  const value = compute();
  cache.set(filePath, { mtimeMs, value });
  return value;
}

/** Test/maintenance hook: drop all per-file derived caches. */
export function clearClaudeFileCaches(): void {
  tailCache.clear();
  promptCache.clear();
  entrypointCache.clear();
  subAgentInfoCache.clear();
}

/** Test hook: total entries across the per-file caches (bound check). */
export function claudeFileCacheEntryCount(): number {
  return (
    tailCache.size +
    promptCache.size +
    entrypointCache.size +
    subAgentInfoCache.size
  );
}

function readSubAgentInfo(
  filePath: string,
  mtimeMs: number,
): {
  agentId: string | null;
  taskDescription: string | null;
} {
  return memoByMtime(subAgentInfoCache, filePath, mtimeMs, () =>
    computeSubAgentInfo(filePath),
  );
}

// Discovery touches every session on every refresh. Reading whole files
// just to peek at the first or last lines slurps 100MB+ sessions
// repeatedly (the freeze). These read a bounded slice instead.
const HEAD_READ_BYTES = 16 * 1024; // first line: entrypoint / sub-agent header
const TAIL_READ_BYTES = 256 * 1024; // recent lines: model / liveState / context
const PROMPT_TAIL_BYTES = 256 * 1024; // latest substantial user prompt (title)

// Files at or under the cap are read whole (cheap, and the common case);
// only an oversized session pays the bounded positioned read. This also
// keeps the unit tests — which use small in-memory fixtures — on the
// plain readFileSync path.
function readHeadText(filePath: string, maxBytes: number): string {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return "";
  }
  if (size <= maxBytes) {
    try {
      return readFileSync(filePath, "utf-8");
    } catch {
      return "";
    }
  }
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const n = readSync(fd, buf, 0, maxBytes, 0);
    return buf.toString("utf-8", 0, n);
  } finally {
    closeSync(fd);
  }
}

// Read at most `maxBytes` from the END of the file, dropping a leading
// partial line when the file is larger than the slice.
function readTailText(filePath: string, maxBytes: number): string {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return "";
  }
  if (size <= maxBytes) {
    try {
      return readFileSync(filePath, "utf-8");
    } catch {
      return "";
    }
  }
  const fd = openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const n = readSync(fd, buf, 0, maxBytes, size - maxBytes);
    let text = buf.toString("utf-8", 0, n);
    const nl = text.indexOf("\n");
    if (nl >= 0) text = text.slice(nl + 1); // drop partial first line
    return text;
  } finally {
    closeSync(fd);
  }
}

function computeSubAgentInfo(filePath: string): {
  agentId: string | null;
  taskDescription: string | null;
} {
  if (!existsSync(filePath)) return { agentId: null, taskDescription: null };
  try {
    const firstLine = readHeadText(filePath, HEAD_READ_BYTES).split("\n")[0];
    if (!firstLine) return { agentId: null, taskDescription: null };
    const entry = JSON.parse(firstLine);
    const agentId = typeof entry.agentId === "string" ? entry.agentId : null;
    const content =
      typeof entry.message?.content === "string" ? entry.message.content : null;
    const taskDescription = content ? extractTaskDescription(content) : null;
    return { agentId, taskDescription };
  } catch {
    return { agentId: null, taskDescription: null };
  }
}

interface UsageFields {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// Claude context windows come in two sizes: the standard 200K and
// the long-context 1M (Opus 4.7+, Sonnet 1M beta). The JSONL doesn't
// record which one a session runs on, so we infer: if the observed
// prompt size exceeds 200K the session MUST be on the 1M window
// (otherwise it would already have failed). The inverse direction
// is lossy — a 1M session that hasn't crossed 200K yet reads as a
// 200K session and its percentage shows inflated (conservative for
// a "headroom before compact" gauge, so acceptable).
const CLAUDE_WINDOW_STANDARD = 200_000;
const CLAUDE_WINDOW_LONG = 1_000_000;

function inferClaudeWindow(usedTokens: number): number {
  return usedTokens > CLAUDE_WINDOW_STANDARD
    ? CLAUDE_WINDOW_LONG
    : CLAUDE_WINDOW_STANDARD;
}

function readSessionTail(
  filePath: string,
  mtimeMs: number,
  now: number,
  isSubAgent = false,
): {
  modelName: string | null;
  liveState: LiveState | null;
  contextUsage: { used: number; total: number; percent: number } | null;
} {
  // `isSubAgent` is a fixed property of the file's location (the
  // subagents/ dir), so it never varies for a given path.
  return memoByMtime(tailCache, filePath, mtimeMs, () =>
    computeSessionTail(filePath, mtimeMs, now, isSubAgent),
  );
}

function computeSessionTail(
  filePath: string,
  mtimeMs: number,
  now: number,
  isSubAgent = false,
): {
  modelName: string | null;
  liveState: LiveState | null;
  contextUsage: { used: number; total: number; percent: number } | null;
} {
  if (!existsSync(filePath))
    return { modelName: null, liveState: null, contextUsage: null };
  try {
    const content = readTailText(filePath, TAIL_READ_BYTES);
    const tail = content.trim().split("\n").filter(Boolean).slice(-50);

    let modelName: string | null = null;
    let contextUsage: {
      used: number;
      total: number;
      percent: number;
    } | null = null;

    // Walk backward for the most recent assistant entry. Its
    // `message.model` is the display model; its `message.usage`
    // input-side sum (input + cache_creation + cache_read) closely
    // tracks the live prompt size — verified against `/context`
    // output (sum 529K vs /context 541.6K on the same session).
    for (const line of [...tail].reverse()) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "assistant") continue;
        if (!modelName && entry.message?.model) {
          modelName = parseModelName(entry.message.model as string);
        }
        const usage = entry.message?.usage as UsageFields | undefined;
        if (!contextUsage && usage) {
          const used =
            (usage.input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0);
          if (used > 0) {
            const total = inferClaudeWindow(used);
            contextUsage = {
              used,
              total,
              percent: Math.min(100, Math.round((used / total) * 100)),
            };
          }
        }
        if (modelName && contextUsage) break;
      } catch {
        // skip
      }
    }

    return {
      modelName,
      liveState: detectLiveState(tail, mtimeMs, now, isSubAgent),
      contextUsage,
    };
  } catch {
    return { modelName: null, liveState: null, contextUsage: null };
  }
}

const SYSTEM_PREFIXES = [
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<local-command-stdout>",
  "<local-command-caveat>",
  "<system-reminder>",
  "<bash-input>",
  "<bash-stdout>",
  "<bash-stderr>",
  "<user-prompt-submit-hook>",
];

function isSystemNoise(text: string): boolean {
  const trimmed = text.trimStart();
  return SYSTEM_PREFIXES.some((p) => trimmed.startsWith(p));
}

/**
 * Walk the session JSONL and pick the best user message to surface
 * as the session's row description. Preference order:
 *
 *   1. The LATEST user message that isn't a slash command
 *      (`/compact`, `/clear`, …). For long sessions, this reflects
 *      what the user is doing NOW, not what they asked at session
 *      start. Short follow-ups ("ok", "go") count — a length
 *      threshold was tried (≥ 10 chars) and dropped by user
 *      request: seeing the literal latest reply beats a stale
 *      longer one.
 *   2. The FIRST natural-language user message — fallback when
 *      every later message is a slash command.
 *
 * Returns null when neither exists (empty session, all system
 * reminders, only tool results). The field is still named
 * `firstUserPrompt` in `SessionNode` for backwards compatibility.
 */
function readFirstUserPrompt(filePath: string, mtimeMs: number): string | null {
  return memoByMtime(promptCache, filePath, mtimeMs, () =>
    computeFirstUserPrompt(filePath),
  );
}

function computeFirstUserPrompt(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  // The row title is the LATEST substantial user message — always recent,
  // so a bounded tail read finds it without slurping a huge session.
  let content: string;
  try {
    content = readTailText(filePath, PROMPT_TAIL_BYTES);
  } catch {
    return null;
  }

  const isSubstantial = (text: string): boolean => !text.trim().startsWith("/");

  let first: string | null = null;
  let latestSubstantial: string | null = null;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let entry: {
      type?: string;
      message?: { content?: unknown };
      toolUseResult?: unknown;
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "user") continue;
    if (entry.toolUseResult !== undefined) continue; // tool result, not real user input

    const raw = entry.message?.content;
    let text: string;
    if (typeof raw === "string") {
      text = raw;
    } else if (Array.isArray(raw)) {
      const textBlock = raw.find(
        (b: { type?: string; text?: string }) =>
          b && b.type === "text" && typeof b.text === "string",
      ) as { text?: string } | undefined;
      text = textBlock?.text ?? "";
    } else {
      continue;
    }

    if (!text || isSystemNoise(text)) continue;

    const firstLine = text.split("\n").find((l) => l.trim()) ?? "";
    if (!firstLine || isSystemNoise(firstLine)) continue;

    const capped = capWithEllipsis(firstLine);
    if (first === null) first = capped;
    if (isSubstantial(firstLine)) latestSubstantial = capped;
  }
  return latestSubstantial ?? first;
}

function readEntrypoint(filePath: string, mtimeMs: number): string | null {
  return memoByMtime(entrypointCache, filePath, mtimeMs, () =>
    computeEntrypoint(filePath),
  );
}

function computeEntrypoint(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const firstLine = readHeadText(filePath, HEAD_READ_BYTES).split("\n")[0];
    if (!firstLine) return null;
    const entry = JSON.parse(firstLine);
    return typeof entry.entrypoint === "string" ? entry.entrypoint : null;
  } catch {
    return null;
  }
}

function buildSubAgents(
  parentId: string,
  projectDir: string,
  config: GlobalConfig,
  projectName: string,
): SessionNode[] {
  const subagentsDir = join(projectDir, parentId, "subagents");
  if (!existsSync(subagentsDir)) return [];

  let files: string[];
  try {
    files = (readdirSync(subagentsDir) as string[]).filter((f) =>
      f.endsWith(".jsonl"),
    );
  } catch {
    return [];
  }

  return (
    files
      .map((file): SessionNode | null => {
        const id = file.replace(/\.jsonl$/, "");
        const hideKey = `${projectName}/${id}`;
        const filePath = join(subagentsDir, file);
        try {
          const stat = statSync(filePath);
          const { agentId, taskDescription } = readSubAgentInfo(
            filePath,
            stat.mtimeMs,
          );
          const { modelName, liveState, contextUsage } = readSessionTail(
            filePath,
            stat.mtimeMs,
            Date.now(),
            true, // sub-agent: a yielded turn means done, not waiting
          );
          return {
            id,
            hideKey,
            filePath,
            projectPath: "",
            projectName: "",
            lastModifiedMs: stat.mtimeMs,
            status: getSessionStatus(stat.mtimeMs),
            modelName,
            subAgents: [],
            agentId: agentId ?? undefined,
            taskDescription: taskDescription ?? undefined,
            nonInteractive: false,
            firstUserPrompt: null,
            liveState,
            provider: "claude",
            contextUsage: contextUsage ?? undefined,
          };
        } catch {
          return null;
        }
      })
      .filter((n): n is SessionNode => n !== null)
      // MARK hidden sub-agents (don't filter them out). The tree carries
      // them with `hidden=true` so `computeCensus` sees them, the
      // hidden-active alert in the panel title fires correctly, and the
      // `a` show-hidden + `H` unhide round-trip works for sub-agents
      // too. Mirrors the same refactor on top-level sessions and
      // projects below.
      .map((n) => {
        if (config.hiddenSubAgents.includes(n.hideKey)) n.hidden = true;
        return n;
      })
      .sort((a, b) => b.lastModifiedMs - a.lastModifiedMs)
  );
}

// Returns the registered project whose path is the nearest ancestor of cwd
// (or equals cwd). Both inputs and the returned value are matched as strings,
// so callers that care about symlinks should pre-resolve their paths or
// inject a `realpath` via options.
export function findContainingProject(
  cwd: string,
  projectPaths: string[],
  options?: { realpath?: (p: string) => string },
): string | null {
  const resolve = options?.realpath ?? ((p: string) => p);
  const cwdR = resolve(cwd);

  let best: string | null = null;
  let bestLen = -1;
  for (const raw of projectPaths) {
    let pR: string;
    try {
      pR = resolve(raw);
    } catch {
      continue;
    }
    if (cwdR === pR) {
      if (pR.length > bestLen) {
        best = raw;
        bestLen = pR.length;
      }
      continue;
    }
    // Accept either separator as the boundary so the helper works on both
    // POSIX (/) and Windows (\), regardless of which form a particular
    // caller's paths happen to use.
    const boundary = cwdR[pR.length];
    if ((boundary === "/" || boundary === "\\") && cwdR.startsWith(pR)) {
      if (pR.length > bestLen) {
        best = raw;
        bestLen = pR.length;
      }
    }
  }
  return best;
}

export function discoverSessions(
  config: GlobalConfig,
  options?: DiscoverOptions,
): SessionTree {
  const projectsDir = getProjectsDir();

  if (!existsSync(projectsDir)) {
    return {
      projects: [],
      coldProjects: [],
      totalCount: 0,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
  }

  let projectDirs: string[];
  try {
    projectDirs = (readdirSync(projectsDir) as string[]).filter((entry) => {
      try {
        return statSync(join(projectsDir, entry)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return {
      projects: [],
      coldProjects: [],
      totalCount: 0,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
  }

  const allSessions: SessionNode[] = [];

  const scope = options?.scopeToProject ?? null;

  for (const encodedDir of projectDirs) {
    const projectDir = join(projectsDir, encodedDir);
    const decodedPath = decodeProjectPath(encodedDir);
    if (scope !== null && decodedPath !== scope) continue;
    const projectName = basename(decodedPath);

    let files: string[];
    try {
      files = (readdirSync(projectDir) as string[]).filter((f) =>
        f.endsWith(".jsonl"),
      );
    } catch {
      continue;
    }

    for (const file of files) {
      const id = file.replace(/\.jsonl$/, "");
      const hideKey = `${projectName}/${id}`;
      const filePath = join(projectDir, file);
      try {
        const stat = statSync(filePath);
        const subAgents = buildSubAgents(id, projectDir, config, projectName);
        const nonInteractive =
          readEntrypoint(filePath, stat.mtimeMs) === "sdk-cli";
        const { modelName, liveState, contextUsage } = readSessionTail(
          filePath,
          stat.mtimeMs,
          Date.now(),
        );
        allSessions.push({
          id,
          hideKey,
          filePath,
          projectPath: decodedPath,
          projectName,
          lastModifiedMs: stat.mtimeMs,
          status: getSessionStatus(stat.mtimeMs),
          modelName,
          subAgents,
          nonInteractive,
          firstUserPrompt: readFirstUserPrompt(filePath, stat.mtimeMs),
          liveState: nonInteractive ? null : liveState,
          provider: "claude",
          contextUsage: contextUsage ?? undefined,
        });
      } catch {}
    }
  }

  // Group by projectPath. Hidden items used to be filtered out here,
  // but now they're MARKED and kept in the tree — the App.tsx render
  // layer decides whether to show them based on the `showHidden`
  // toggle (`a` key). Tally hidden items as we go so the status bar
  // can surface "M active in N hidden" — a hidden session that's
  // still producing live activity is one of the things the user is
  // most likely to want to know about (the failure mode of `H` being
  // one keystroke away).
  const byProject = new Map<string, SessionNode[]>();
  let hiddenTotal = 0;
  let hiddenActive = 0;
  for (const s of allSessions) {
    const sessionHidden = config.hiddenSessions.includes(s.hideKey);
    const projectHidden = config.hiddenProjects.includes(s.projectName);
    if (sessionHidden || projectHidden) {
      hiddenTotal++;
      if (s.status === "hot" || s.status === "warm") hiddenActive++;
      s.hidden = true;
    }
    // Sub-agents are marked at parse time in `readSubAgents` (or here
    // if their parent is project-hidden). Either way, count them so
    // the hidden-active alarm fires when a hot sub-agent is hidden.
    for (const sub of s.subAgents) {
      if (sub.hidden || projectHidden) {
        if (projectHidden) sub.hidden = true;
        hiddenTotal++;
        if (sub.status === "hot" || sub.status === "warm") hiddenActive++;
      }
    }
    const arr = byProject.get(s.projectPath) ?? [];
    arr.push(s);
    byProject.set(s.projectPath, arr);
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
    const projectHidden = config.hiddenProjects.includes(projectName);

    // Sort: interactive first, then by status, then by mtime desc
    sessions.sort((a, b) => {
      if (a.nonInteractive !== b.nonInteractive) {
        return a.nonInteractive ? 1 : -1;
      }
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return b.lastModifiedMs - a.lastModifiedMs;
    });

    const hotness = sessions[0].status; // hottest = first after sort

    allProjects.push({
      name: projectName,
      projectPath,
      sessions,
      hotness,
      hidden: projectHidden || undefined,
    });
  }

  // Partition cold vs active
  const activeProjects = allProjects.filter((p) => p.hotness !== "cold");
  const coldProjects = allProjects.filter((p) => p.hotness === "cold");

  // Sort active projects by hottest session's status, then mtime of hottest session
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

/**
 * The Claude Code provider — wraps the discovery + parsing functions
 * above into the `SessionProvider` interface so the top-level
 * orchestrator in `sessions.ts` can iterate providers uniformly.
 * The functions themselves are still exported individually for
 * backward compatibility with existing imports.
 */
export const claudeProvider: SessionProvider = {
  name: "claude",
  lineDelimited: true,
  isTurnBoundary: (line) => {
    try {
      const e = JSON.parse(line);
      return e.type === "user" && e.toolUseResult === undefined;
    } catch {
      return false;
    }
  },
  isAvailable: () => existsSync(getProjectsDir()),
  discoverSessions,
  parseActivities: parseActivitiesFromLines,
};
