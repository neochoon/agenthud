/**
 * DSH (DeepSeek Harness) session provider — sessions from the harness's
 * per-session event log under `$DSH_HOME/sessions`.
 *
 * Layout (verified against a 171-session, 67MB corpus):
 *
 *   <DSH_HOME>/sessions/<encoded-cwd>/<sessionId>/session.v4.jsonl.zstd
 *   <DSH_HOME>/sessions/<encoded-cwd>/<sessionId>/session.v3.jsonl.zstd  (older)
 *   <DSH_HOME>/sessions/<encoded-cwd>/<sessionId>/session.jsonl.zstd     (legacy, v0 records)
 *
 * `<DSH_HOME>` defaults to `~/.dsh`; `DSH_SESSIONS_DIR` overrides the
 * sessions root. Full schema + verification commands in
 * docs/schemas/dsh-session.md.
 *
 * Version: the log's own `session.version` (4 today, 0 on legacy files)
 * is captured onto SessionNode.version as `v<n>`.
 *
 * Design decisions:
 * - The log is JSONL COMPRESSED WITH ZSTD, written as ONE CONCATENATED
 *   ZSTD FRAME PER APPEND. `node:zlib`'s zstd decoder stops after the
 *   first frame — both `zstdDecompressSync` and `createZstdDecompress`
 *   (verified: a 67-frame log decodes to 163 of its 825k chars) — so we
 *   split the file on the frame magic ourselves and concatenate the
 *   decoded frames (`decodeZstdFrames`). No dependency, no native
 *   module, and a live file whose LAST frame is still being written
 *   degrades to "skip that frame" instead of throwing.
 * - zstd lives in `node:zlib` from Node 22.15 / 23.8. On Node 20 the
 *   provider reports `isAvailable() === false` instead of crashing the
 *   app — the same contract opencode uses for `node:sqlite`. No engine
 *   bump, no new dependency.
 * - Discovery reads only the FIRST frame of each log: the `session`
 *   header record (id / cwd / parent / delegation depth) that DSH
 *   always writes as record 1. Across the corpus that is ~80ms; a full
 *   decompress is ~3s because the logs also carry the streamed token
 *   chunks. Both the header read and the projection-cache read are
 *   memoized by (size, mtime) so a 2s poll re-reads only growing files.
 * - Titles, live state, model name and the context gauge come from
 *   DSH's own projection cache, one plain-JSON file per session at
 *   `<DSH_HOME>/storages/session_projcache/sessions/<id>.json`. It is
 *   a CACHE: a session missing from it still renders, minus the title
 *   and gauge. Reading those (~8KB each) is 20x cheaper than decoding
 *   the logs.
 * - Sub-agents are SEPARATE session dirs whose header carries
 *   `parentSession` and `origin: "subagent"` (like Codex, unlike Kiro
 *   IDE). A child whose parent isn't discoverable surfaces at top
 *   level rather than being dropped.
 * - `lineDelimited: false`: zstd FRAMES, not bytes, are the unit of the
 *   file, so the history reader's byte-offset tail parse cannot apply.
 *   It asks the provider for the records instead (`readRecords`), gated
 *   by mtime.
 *
 * Gotchas:
 * - `tool/call` events MIRROR the `tool-call` content blocks inside
 *   `assistant/message` (same callId). We parse the events only —
 *   counting both would double every tool row.
 * - `user/message` is not always the human: DSH also stores injected
 *   context (runtime-context, skill-catalog, agent-instructions, …) in
 *   the same event shape. `data.source.kind` is the discriminator; only
 *   `user` / `user-approval` / `goal` count as a user activity.
 * - `tool/call.arguments` is a JSON-encoded STRING — double-parse.
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
import zlib from "node:zlib";
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
import { ONE_HOUR_MS, THIRTY_MINUTES_MS } from "../../utils/timeConstants.js";
import {
  buildToolDetailBody,
  summarizeToolDetail,
  type ToolInput,
  type ToolUseResult,
} from "../toolDetails.js";
import { canonicalToolLabel, iconForCanonicalLabel } from "./toolLabels.js";
import type { DiscoverOptions, ParseResult, SessionProvider } from "./types.js";

// --- paths -----------------------------------------------------------------

/** `<DSH_HOME>` — the harness's data root (`~/.dsh` by default). */
export function getDshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

export function getDshSessionsDir(): string {
  return process.env.DSH_SESSIONS_DIR ?? join(getDshHome(), "sessions");
}

/** DSH's per-session projection cache (plain JSON, one file per session). */
export function getDshCacheDir(): string {
  return join(getDshHome(), "storages", "session_projcache", "sessions");
}

/** True for a session log this provider owns. The suffix check keeps
 * routing correct even when `DSH_SESSIONS_DIR` changed after the node
 * was built (same defensive stance as the other providers). */
export function isDshSessionPath(filePath: string): boolean {
  if (filePath.toLowerCase().endsWith(".jsonl.zstd")) return true;
  const norm = filePath.replace(/\\/g, "/");
  return norm.startsWith(`${getDshSessionsDir().replace(/\\/g, "/")}/`);
}

// --- zstd frame decoding ---------------------------------------------------

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

// `@types/node@20` predates the zstd API, so reach for it structurally.
const zstdDecompressSync = (
  zlib as unknown as {
    zstdDecompressSync?: (buf: Buffer) => Buffer;
  }
).zstdDecompressSync;

function hasZstd(): boolean {
  return typeof zstdDecompressSync === "function";
}

function isZstd(buf: Buffer): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x28 &&
    buf[1] === 0xb5 &&
    buf[2] === 0x2f &&
    buf[3] === 0xfd
  );
}

const ZSTD_FRAME_MAGIC_LE = 0xfd2fb528; // bytes 28 B5 2F FD
const ZSTD_SKIPPABLE_MASK = 0xfffffff0; // 0x184D2A50..0x184D2A5F
const ZSTD_SKIPPABLE_BASE = 0x184d2a50;

function isFrameMagicAt(buf: Buffer, offset: number): boolean {
  return (
    offset + 4 <= buf.length &&
    (buf.readUInt32LE(offset) === ZSTD_FRAME_MAGIC_LE ||
      (buf.readUInt32LE(offset) & ZSTD_SKIPPABLE_MASK) === ZSTD_SKIPPABLE_BASE)
  );
}

/**
 * End offset (exclusive) of the zstd frame starting at `start`, or null
 * when the frame is incomplete (the file is still being appended).
 *
 * Parsed from the frame structure rather than by searching for the next
 * magic: the 4-byte magic can legitimately appear inside compressed
 * data, and `zstdDecompressSync` does not report how many bytes it
 * consumed. Walking the frame header (RFC 8878 §3.1) gives exact
 * boundaries — verified against 171 real logs / 53,321 frames, where
 * the walk covers every byte with no failed decode.
 */
export function zstdFrameEnd(buf: Buffer, start: number): number | null {
  if (start + 6 > buf.length) return null;
  const magic = buf.readUInt32LE(start);
  if ((magic & ZSTD_SKIPPABLE_MASK) === ZSTD_SKIPPABLE_BASE) {
    const size = buf.readUInt32LE(start + 4);
    const end = start + 8 + size;
    return end <= buf.length ? end : null;
  }
  if (magic !== ZSTD_FRAME_MAGIC_LE) return null;

  let pos = start + 4;
  const descriptor = buf[pos++];
  const fcsFlag = descriptor >> 6;
  const singleSegment = (descriptor >> 5) & 1;
  const hasChecksum = (descriptor >> 2) & 1;
  const dictIdFlag = descriptor & 3;
  if (!singleSegment) pos += 1; // window descriptor
  pos += [0, 1, 2, 4][dictIdFlag];
  pos +=
    fcsFlag === 0
      ? singleSegment
        ? 1
        : 0
      : fcsFlag === 1
        ? 2
        : fcsFlag === 2
          ? 4
          : 8;
  if (pos > buf.length) return null;

  for (;;) {
    if (pos + 3 > buf.length) return null;
    const header = buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16);
    pos += 3;
    const lastBlock = header & 1;
    const blockType = (header >> 1) & 3;
    const blockSize = header >> 3;
    pos += blockType === 1 ? 1 : blockSize; // RLE blocks store one byte
    if (pos > buf.length) return null;
    if (lastBlock) break;
  }
  if (hasChecksum) pos += 4;
  return pos <= buf.length ? pos : null;
}

/** Frame boundaries of a (possibly concatenated) zstd buffer, in file
 * order. Stops at the first incomplete frame — everything before it is
 * still valid. */
export function listZstdFrames(
  buf: Buffer,
): Array<{ start: number; end: number }> {
  const frames: Array<{ start: number; end: number }> = [];
  let pos = buf.indexOf(ZSTD_MAGIC);
  while (pos !== -1 && pos < buf.length) {
    const end = zstdFrameEnd(buf, pos);
    if (end === null) break;
    frames.push({ start: pos, end });
    pos = end;
    // Resync if the bytes after a frame are not a frame start (a
    // foreign trailer, or a torn write that left junk).
    if (!isFrameMagicAt(buf, pos)) {
      pos = buf.indexOf(ZSTD_MAGIC, pos);
    }
  }
  return frames;
}

/**
 * Decode a concatenated multi-frame zstd buffer to UTF-8 text.
 *
 * `node:zlib` decodes only the FIRST frame (`zstdDecompressSync` and
 * `createZstdDecompress` alike: a 67-frame log decodes to 163 of its
 * 825k chars), so the frames are walked and decoded individually. A
 * corrupt frame is skipped rather than blanking the session.
 */
export function decodeZstdFrames(buf: Buffer): string {
  if (!hasZstd()) return "";
  const frames = listZstdFrames(buf);
  if (frames.length === 0) return "";
  const decode = zstdDecompressSync as (b: Buffer) => Buffer;

  const parts: Buffer[] = [];
  for (const frame of frames) {
    try {
      parts.push(decode(buf.subarray(frame.start, frame.end)));
    } catch {
      // Torn / corrupt frame — keep whatever already decoded.
    }
  }
  return Buffer.concat(parts).toString("utf-8");
}

/**
 * Read a session log as lines of event records.
 *
 * Frames are decoded newest-first until the decoded budget is reached —
 * the same "recent window, not full history" policy the history reader
 * applies to huge JSONL files. No partial-record handling is needed:
 * frames are record-aligned (every one of the 53,321 corpus frames ends
 * with a newline), so a window that starts on a frame boundary starts
 * on a record boundary. Sessions under the budget decode whole.
 */
export function readDshRecords(
  filePath: string,
  maxDecodedBytes = 8 * 1024 * 1024,
): string[] {
  const buf = readFileSync(filePath);
  if (!isZstd(buf)) {
    return buf
      .toString("utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
  }
  const frames = listZstdFrames(buf);
  if (frames.length === 0) return [];
  const decode = zstdDecompressSync as (b: Buffer) => Buffer;

  const parts: string[] = [];
  let total = 0;
  for (let i = frames.length - 1; i >= 0; i--) {
    const { start, end } = frames[i];
    let text: string;
    try {
      text = decode(buf.subarray(start, end)).toString("utf-8");
    } catch {
      continue; // torn frame; keep the valid ones
    }
    if (parts.length > 0 && total + text.length > maxDecodedBytes) break;
    parts.push(text);
    total += text.length;
  }
  parts.reverse();
  return parts
    .join("")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

// --- session header --------------------------------------------------------

/** Record 1 of every DSH log. Everything the tree needs to place the
 * session, without decoding the rest of the file. */
export interface DshSessionHead {
  id: string;
  version: number;
  cwd: string;
  createdAt: number;
  parentSession: string | null;
  origin: string | null;
  delegationDepth: number;
  agentPreset: string | null;
}

// The header is immutable once written (append-only log), so memoize by
// size: a growing file keeps its cached header.
const headCache = new Map<
  string,
  { size: number; head: DshSessionHead | null }
>();

/** Test hook: drop the memoized header / projection-cache reads. */
export function clearDshCaches(): void {
  headCache.clear();
  projectionCache.clear();
}

export function parseDshSessionHead(line: string): DshSessionHead | null {
  let rec: {
    type?: string;
    version?: number;
    id?: string;
    cwd?: string;
    createdAt?: number;
    parentSession?: string;
    origin?: string;
    delegationDepth?: number;
    agentPreset?: string;
  };
  try {
    rec = JSON.parse(line);
  } catch {
    return null;
  }
  if (rec.type !== "session" || typeof rec.id !== "string") return null;
  return {
    id: rec.id,
    version: typeof rec.version === "number" ? rec.version : 0,
    cwd: typeof rec.cwd === "string" ? rec.cwd : "",
    createdAt: typeof rec.createdAt === "number" ? rec.createdAt : 0,
    parentSession:
      typeof rec.parentSession === "string" ? rec.parentSession : null,
    origin: typeof rec.origin === "string" ? rec.origin : null,
    delegationDepth:
      typeof rec.delegationDepth === "number" ? rec.delegationDepth : 0,
    agentPreset: typeof rec.agentPreset === "string" ? rec.agentPreset : null,
  };
}

// Enough for the header frame of any real log (it is a few hundred
// bytes). Falling back to a full read keeps an unexpectedly large first
// frame from silently losing the session.
const HEAD_PROBE_BYTES = 64 * 1024;

function readHeadProbe(filePath: string, size: number): Buffer {
  const length = Math.min(size, HEAD_PROBE_BYTES);
  const buf = Buffer.alloc(length);
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buf, 0, length, 0);
  } finally {
    closeSync(fd);
  }
  return buf;
}

export function readDshSessionHead(
  filePath: string,
  size?: number,
): DshSessionHead | null {
  let fileSize = size;
  if (fileSize === undefined) {
    try {
      fileSize = statSync(filePath).size;
    } catch {
      return null;
    }
  }
  const cached = headCache.get(filePath);
  if (cached && fileSize >= cached.size) return cached.head;

  let head: DshSessionHead | null = null;
  try {
    const probe = readHeadProbe(filePath, fileSize);
    if (isZstd(probe)) {
      const frames = listZstdFrames(probe);
      // The header frame is the first one. No frame inside the probe
      // means the header frame is bigger than the probe — re-read the
      // whole file rather than lose the session.
      const text =
        frames.length > 0
          ? decodeZstdFrames(probe.subarray(frames[0].start, frames[0].end))
          : decodeZstdFrames(readFileSync(filePath));
      head = parseDshSessionHead(text.split("\n")[0] ?? "");
    } else {
      head = parseDshSessionHead(probe.toString("utf-8").split("\n")[0] ?? "");
    }
  } catch {
    head = null;
  }
  // A growing file keeps a valid cached header; a rewrite invalidates it.
  headCache.set(filePath, { size: fileSize, head });
  return head;
}

// --- projection cache ------------------------------------------------------

interface DshCacheRow {
  val?: unknown;
}

interface DshProjectionRows {
  rows?: Record<string, DshCacheRow>;
}

/** The slice of DSH's projection cache this provider reads. */
export interface DshProjection {
  title: string | null;
  model: string | null;
  contextUsage: { used: number; total: number; percent: number } | null;
  /** openStep !== null → a step is in flight. */
  openStep: boolean;
  turns: number;
}

const projectionCache = new Map<
  string,
  { mtimeMs: number; value: DshProjection | null }
>();

export function parseDshProjection(json: unknown): DshProjection | null {
  const rows = (json as { record?: DshProjectionRows } | null)?.record?.rows;
  if (!rows || typeof rows !== "object") return null;

  const titleVal = rows.title?.val;
  const title =
    typeof titleVal === "string" && titleVal.trim() ? titleVal : null;

  const modelVal = (rows.modelSelection?.val ?? null) as {
    lastUsed?: { model?: unknown };
  } | null;
  const lastUsed = modelVal?.lastUsed?.model;
  const model = typeof lastUsed === "string" && lastUsed ? lastUsed : null;

  const pressure = rows.contextPressure?.val as
    | { surfaceTokens?: unknown; contextWindow?: unknown }
    | null
    | undefined;
  let contextUsage: DshProjection["contextUsage"] = null;
  const used = pressure?.surfaceTokens;
  const total = pressure?.contextWindow;
  if (
    typeof used === "number" &&
    typeof total === "number" &&
    total > 0 &&
    used >= 0
  ) {
    contextUsage = {
      used,
      total,
      percent: Math.min(100, Math.round((used / total) * 100)),
    };
  }

  const stats = rows.sessionStats?.val as
    | { openStep?: unknown; turns?: unknown }
    | null
    | undefined;
  const openStep = stats?.openStep !== null && stats?.openStep !== undefined;
  const turns = typeof stats?.turns === "number" ? stats.turns : 0;

  return { title, model, contextUsage, openStep, turns };
}

function readProjection(sessionId: string): DshProjection | null {
  const path = join(getDshCacheDir(), `${sessionId}.json`);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    return null;
  }
  const cached = projectionCache.get(path);
  if (cached && cached.mtimeMs === mtimeMs) return cached.value;

  let value: DshProjection | null = null;
  try {
    value = parseDshProjection(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    value = null;
  }
  projectionCache.set(path, { mtimeMs, value });
  return value;
}

// --- discovery -------------------------------------------------------------

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

/** Pick the authoritative log in a session dir. Newer format versions
 * win; a compressed log beats a plain one of the same version. */
export function pickSessionLog(files: string[]): string | null {
  const candidates = files
    .map((name) => {
      const m = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/.exec(name);
      if (!m) return null;
      return {
        name,
        version: m[1] ? Number(m[1]) : 0,
        zstd: m[2] ? 1 : 0,
      };
    })
    .filter((c): c is { name: string; version: number; zstd: number } => !!c);
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      b.version - a.version || b.zstd - a.zstd || a.name.localeCompare(b.name),
  );
  return candidates[0].name;
}

interface DshSessionFile {
  filePath: string;
  dirName: string;
  mtimeMs: number;
  size: number;
}

function listSessionFiles(root: string): DshSessionFile[] {
  const out: DshSessionFile[] = [];
  const safeRead = (dir: string): string[] => {
    try {
      return readdirSync(dir) as unknown as string[];
    } catch {
      return [];
    }
  };
  const isDir = (path: string): boolean => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  };
  for (const projectDir of safeRead(root)) {
    const projectPath = join(root, projectDir);
    if (!isDir(projectPath)) continue;
    for (const sessionDir of safeRead(projectPath)) {
      const sessionPath = join(projectPath, sessionDir);
      if (!isDir(sessionPath)) continue;
      const log = pickSessionLog(safeRead(sessionPath));
      if (!log) continue;
      const filePath = join(sessionPath, log);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(filePath);
      } catch {
        continue;
      }
      out.push({
        filePath,
        dirName: sessionDir,
        mtimeMs: st.mtimeMs,
        size: st.size,
      });
    }
  }
  return out;
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

function isSubAgent(head: DshSessionHead): boolean {
  return head.origin === "subagent" || head.delegationDepth > 0;
}

/** Live state from the projection cache: an open step means DSH is
 * mid-turn (a long tool call leaves mtime stale, so mtime alone would
 * read as idle). Otherwise a fresh session is waiting on the user; a
 * sub-agent is one-shot, so it just falls back to the time ladder. */
function deriveLiveState(
  projection: DshProjection | null,
  mtimeMs: number,
  isSubAgentNode: boolean,
): LiveState | null {
  if (Date.now() - mtimeMs > THIRTY_MINUTES_MS) return null;
  if (projection?.openStep) return "working";
  return isSubAgentNode ? null : "waiting";
}

function makeNode(
  head: DshSessionHead,
  filePath: string,
  mtimeMs: number,
  projection: DshProjection | null,
  hidden: boolean,
): SessionNode {
  const projectName = head.cwd ? basename(head.cwd) : "";
  const node: SessionNode = {
    id: head.id,
    hideKey: `${projectName}/${head.id}`,
    filePath,
    projectPath: head.cwd,
    projectName,
    lastModifiedMs: mtimeMs,
    status: getSessionStatus(mtimeMs),
    modelName: projection?.model ?? null,
    subAgents: [],
    nonInteractive: false,
    firstUserPrompt: projection?.title ?? null,
    liveState: deriveLiveState(projection, mtimeMs, isSubAgent(head)),
    provider: "dsh",
    version: `v${head.version}`,
    contextUsage: projection?.contextUsage ?? undefined,
  };
  if (hidden) node.hidden = true;
  return node;
}

function discoverDshSessions(
  config: GlobalConfig,
  options?: DiscoverOptions,
): SessionTree {
  const root = getDshSessionsDir();
  if (!existsSync(root)) return emptyTree();

  interface Parsed {
    head: DshSessionHead;
    filePath: string;
    mtimeMs: number;
    projection: DshProjection | null;
  }

  const parsed: Parsed[] = [];
  for (const file of listSessionFiles(root)) {
    const head = readDshSessionHead(file.filePath, file.size);
    if (!head) continue;
    if (!head.cwd) continue; // no directory to group under
    if (options?.scopeToProject && head.cwd !== options.scopeToProject)
      continue;
    parsed.push({
      head,
      filePath: file.filePath,
      mtimeMs: file.mtimeMs,
      projection: readProjection(head.id),
    });
  }

  // Parents (top-level + orphan sub-agents) vs linkable children.
  const byId = new Map<string, Parsed>();
  for (const p of parsed) byId.set(p.head.id, p);

  const parents: Parsed[] = [];
  const children: Parsed[] = [];
  for (const p of parsed) {
    const parent = p.head.parentSession;
    if (
      isSubAgent(p.head) &&
      parent &&
      byId.has(parent) &&
      parent !== p.head.id
    ) {
      children.push(p);
    } else {
      parents.push(p);
    }
  }

  const nodesById = new Map<string, SessionNode>();
  const byProject = new Map<string, SessionNode[]>();
  let hiddenTotal = 0;
  let hiddenActive = 0;
  const tallyHidden = (node: SessionNode) => {
    hiddenTotal++;
    if (node.status === "hot" || node.status === "warm") hiddenActive++;
  };

  for (const { head, filePath, mtimeMs, projection } of parents) {
    const projectName = basename(head.cwd);
    const hidden =
      config.hiddenProjects.includes(projectName) ||
      config.hiddenSessions.includes(`${projectName}/${head.id}`);
    const node = makeNode(head, filePath, mtimeMs, projection, hidden);
    nodesById.set(head.id, node);
    if (hidden) tallyHidden(node);
    const arr = byProject.get(head.cwd) ?? [];
    arr.push(node);
    byProject.set(head.cwd, arr);
  }

  for (const { head, filePath, mtimeMs, projection } of children) {
    const parent = head.parentSession
      ? nodesById.get(head.parentSession)
      : undefined;
    if (!parent) continue; // parent scoped/hidden out
    const projectName = parent.projectName;
    const hidden =
      config.hiddenProjects.includes(projectName) ||
      config.hiddenSubAgents.includes(`${projectName}/${head.id}`);
    const node = makeNode(head, filePath, mtimeMs, projection, hidden);
    node.agentId = head.id;
    // The sub-agent's own title is usually its spawning task prompt.
    node.taskDescription = projection?.title ?? undefined;
    if (hidden) tallyHidden(node);
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
      if (a.nonInteractive !== b.nonInteractive)
        return a.nonInteractive ? 1 : -1;
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
}

// --- activities ------------------------------------------------------------

/** `data.source.kind` values that represent real human input. Every
 * other kind is context DSH injects into the conversation. */
const USER_SOURCE_KINDS = new Set(["user", "user-approval", "goal"]);

interface DshContentBlock {
  type?: string;
  text?: string;
  name?: string;
  arguments?: string;
  id?: string;
}

interface DshRecord {
  type?: string;
  seq?: number;
  time?: number;
  createdAt?: number;
  data?: {
    turn?: number;
    step?: number;
    name?: string;
    arguments?: string;
    callId?: string;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
    };
    content?: DshContentBlock[];
    source?: { kind?: string };
    message?: {
      role?: string;
      content?: DshContentBlock[];
      toolCallId?: string;
      isError?: boolean;
    };
    header?: { config?: { model?: string } };
  };
}

function blockText(blocks: DshContentBlock[] | undefined): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

function parseArgs(raw: string | undefined): ToolInput | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as ToolInput;
    return undefined;
  } catch {
    return undefined;
  }
}

/** DSH's `read` result wraps the file body in
 * `<path>…</path><type>file</type><content>\n…\n</content>`, and every
 * content line already carries a `NN: ` gutter. Unwrap it and recover
 * the first line number so the detail view can re-gutter it once. */
export function readResultFile(
  text: string,
): { content: string; startLine: number } | null {
  const open = "<content>\n";
  const close = "\n</content>";
  const start = text.indexOf(open);
  if (start === -1) return null;
  const end = text.lastIndexOf(close);
  if (end === -1 || end <= start) return null;
  const body = text.slice(start + open.length, end);
  const lines = body.split("\n");
  const first = /^(\d+): ?/.exec(lines[0] ?? "");
  const startLine = first ? Number(first[1]) : 1;
  const stripped = lines.map((line) => line.replace(/^\d+: ?/, "")).join("\n");
  return { content: stripped, startLine };
}

function resultText(rec: DshRecord): string {
  return blockText(rec.data?.message?.content);
}

function resultFor(
  callId: string | undefined,
  results: Map<string, { text: string; isError: boolean }>,
): ToolUseResult | undefined {
  if (!callId) return undefined;
  const hit = results.get(callId);
  if (!hit) return undefined;
  const out: ToolUseResult & { isError?: boolean } = { content: hit.text };
  const file = readResultFile(hit.text);
  if (file) {
    out.content = undefined;
    out.file = { content: file.content, startLine: file.startLine };
  }
  if (hit.isError) out.isError = true;
  return out;
}

export function parseDshActivities(lines: string[]): ParseResult {
  const activities: ActivityEntry[] = [];
  let modelName: string | null = null;
  let tokenCount = 0;
  let sessionStartTime: Date | null = null;

  // Pass 1: tool results, so a call can show its output (and Read/Edit
  // can render a body) — the log has no `toolUseResult`-style block on
  // the call itself.
  const results = new Map<string, { text: string; isError: boolean }>();
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: DshRecord;
    try {
      rec = JSON.parse(line) as DshRecord;
    } catch {
      continue;
    }
    if (rec.type !== "tool/result") continue;
    const callId = rec.data?.message?.toolCallId ?? rec.data?.callId;
    if (!callId) continue;
    results.set(callId, {
      text: resultText(rec),
      isError: rec.data?.message?.isError === true,
    });
  }

  // Pass 2: chronological walk.
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: DshRecord;
    try {
      rec = JSON.parse(line) as DshRecord;
    } catch {
      continue;
    }
    const ts = rec.time ? new Date(rec.time) : new Date(0);
    if (!sessionStartTime && rec.createdAt)
      sessionStartTime = new Date(rec.createdAt);

    switch (rec.type) {
      case "session": {
        if (!sessionStartTime && rec.createdAt) {
          sessionStartTime = new Date(rec.createdAt);
        }
        break;
      }
      case "user/message": {
        const kind = rec.data?.source?.kind;
        if (kind && !USER_SOURCE_KINDS.has(kind)) break;
        const text = blockText(rec.data?.content);
        if (!text) break;
        activities.push({
          timestamp: ts,
          type: "user",
          icon: ICONS.User,
          label: "User",
          detail: text.split("\n")[0] ?? "",
          detailBody: text.includes("\n") ? text : undefined,
        });
        break;
      }
      case "assistant/message": {
        const usage = rec.data?.usage;
        if (usage) {
          tokenCount +=
            (usage.inputTokens ?? 0) +
            (usage.cacheReadTokens ?? 0) +
            (usage.outputTokens ?? 0);
        }
        const content = rec.data?.message?.content;
        if (!Array.isArray(content)) break;
        for (const block of content) {
          if (block?.type === "reasoning") {
            const text = (block.text ?? "").trim();
            if (!text) continue;
            activities.push({
              timestamp: ts,
              type: "thinking",
              icon: ICONS.Thinking,
              label: "Thinking",
              detail: text.split("\n")[0] ?? "",
              detailBody: text.includes("\n") ? text : undefined,
            });
          } else if (block?.type === "text") {
            const text = (block.text ?? "").trim();
            if (!text) continue;
            activities.push({
              timestamp: ts,
              type: "response",
              icon: ICONS.Response,
              label: "Response",
              detail: text.split("\n")[0] ?? "",
              detailBody: text.includes("\n") ? text : undefined,
            });
          }
          // `tool-call` blocks are mirrored by `tool/call` events below —
          // parsing both would duplicate every tool row.
        }
        break;
      }
      case "tool/call": {
        const rawName = rec.data?.name ?? "tool";
        const label = canonicalToolLabel(rawName);
        if (label === "TodoWrite") break;
        const input = parseArgs(rec.data?.arguments);
        const result = resultFor(rec.data?.callId, results);
        const detail = summarizeToolDetail(label, input, result);
        const last = activities[activities.length - 1];
        if (
          last &&
          last.type === "tool" &&
          last.label === label &&
          last.detail === detail
        ) {
          last.count = (last.count ?? 1) + 1;
          last.timestamp = ts;
          break;
        }
        const activity: ActivityEntry = {
          timestamp: ts,
          type: "tool",
          icon: iconForCanonicalLabel(label),
          label,
          detail,
        };
        const body = buildToolDetailBody(label, input, result);
        if (body) {
          activity.detailBody = body.text;
          activity.detailKind = body.kind;
          if (body.numbered) activity.detailNumbered = true;
        }
        activities.push(activity);
        break;
      }
      case "request/header": {
        if (!modelName) {
          const model = rec.data?.header?.config?.model;
          if (typeof model === "string" && model) modelName = model;
        }
        break;
      }
      default:
        // turn/step boundaries, session/title, request/context, jobs,
        // permission/sandbox/approval changes, injected context: not
        // part of the activity timeline.
        break;
    }
  }

  return { activities, tokenCount, modelName, sessionStartTime };
}

function isAvailable(): boolean {
  return hasZstd() && existsSync(getDshSessionsDir());
}

export const dshProvider: SessionProvider = {
  name: "dsh",
  lineDelimited: false,
  isAvailable,
  discoverSessions: discoverDshSessions,
  parseActivities: parseDshActivities,
  readRecords: readDshRecords,
};
