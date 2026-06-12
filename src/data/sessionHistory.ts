/**
 * Filesystem wrapper: read a session JSONL file from disk and
 * return the complete activity history in chronological order.
 *
 * Design decisions:
 * - Pure I/O. All parsing logic stays in the per-provider parsers.
 *   This split lets parsers be unit-tested with synthetic lines
 *   without touching the filesystem, while callers that already
 *   have a path stay one-liners.
 * - Provider routing happens here, not in the parser. We sniff the
 *   path: `~/.kiro/sessions/cli/` → Kiro, otherwise → Claude. The
 *   default-to-Claude lets unmodified callers (sessionHistory tests,
 *   reportGenerator, etc.) work unchanged for Claude paths.
 */

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";
import type { ActivityEntry } from "../types/index.js";
import { claudeProvider } from "./providers/claude.js";
import { codexProvider, getCodexSessionsDir } from "./providers/codex.js";
import { getKiroSessionsDir, kiroProvider } from "./providers/kiro.js";
import {
  getKiroIdeSessionsDir,
  kiroIdeProvider,
} from "./providers/kiro-ide.js";
import type { SessionProvider } from "./providers/types.js";

const norm = (p: string) => p.replace(/\\/g, "/");

// Provider routing by path. Primary check is a prefix match against
// each provider's ACTUAL configured root (so KIRO_SESSIONS_DIR /
// KIRO_IDE_SESSIONS_DIR overrides route correctly — a hardcoded
// segment check alone would silently send overridden Kiro paths to
// the Claude parser). The well-known segments stay as fallbacks for
// nodes constructed before an env change. Claude is the default.
function providerForPath(filePath: string): SessionProvider {
  const p = norm(filePath);
  if (
    p.startsWith(`${norm(getKiroSessionsDir())}/`) ||
    p.includes("/.kiro/sessions/")
  ) {
    return kiroProvider;
  }
  // The IDE root env points at workspace-sessions; execution docs
  // (sub-agent filePaths) live under its PARENT, so prefix on the
  // parent covers both.
  if (
    p.startsWith(`${norm(dirname(getKiroIdeSessionsDir()))}/`) ||
    p.includes("kiro.kiroagent/")
  ) {
    return kiroIdeProvider;
  }
  if (
    p.startsWith(`${norm(getCodexSessionsDir())}/`) ||
    p.includes("/.codex/sessions/")
  ) {
    return codexProvider;
  }
  return claudeProvider;
}

/**
 * Parsed-history cache keyed by file path.
 *
 * The LIVE activity viewer re-asks for the selected session's full
 * history on every ~2s poll. For a long-running session that file
 * is huge (this conversation's JSONL is 25 MB; a full parse is
 * ~150 ms). Two layers of caching keep that off the hot path:
 *
 * 1. mtime gate — if the file hasn't changed since last parse,
 *    return the cached result with zero I/O. This already removed
 *    the recurring stutter (no re-parse while reading/navigating).
 *
 * 2. Bounded-tail incremental parse — when a JSONL file GROWS
 *    (append-only, mtime advanced), re-parse only the appended
 *    tail rather than the whole file. The history is split into a
 *    frozen `prefix` (parsed once) and a re-parsed `tail`; the tail
 *    is kept under TAIL_MAX bytes by advancing the prefix as the
 *    file grows. Result = prefixActivities ++ tailActivities.
 *
 * The split point is any line boundary at/after `size - TAIL_TARGET`.
 * Correctness rests on no activity-affecting dependency straddling
 * the split: Claude enriches a tool_use from its later tool_result
 * and merges identical consecutive tool calls — both confined to a
 * single turn, which is far smaller than TAIL_TARGET. So a generous
 * window makes standalone prefix+tail parses equal to a whole-file
 * parse. (A pathological >2 MB single turn could split a tool pair;
 * the only fallout is one tool entry missing its detail or an
 * un-merged duplicate — cosmetic, never a crash.)
 *
 * Non-line-delimited providers (Kiro IDE: the file is ONE JSON
 * document) can't be tail-parsed; they always parse whole, gated
 * only by mtime.
 */
const TAIL_TARGET = 2 * 1024 * 1024; // aim to keep the tail this size
const TAIL_MAX = 4 * 1024 * 1024; // advance the prefix past this

interface HistoryCacheEntry {
  mtimeMs: number;
  size: number; // file byte size at last parse
  prefixByteLen: number; // [0, prefixByteLen) is the frozen prefix
  prefixActivities: ActivityEntry[];
  tailActivities: ActivityEntry[];
}
const historyCache = new Map<string, HistoryCacheEntry>();

/** Test/maintenance hook: drop the parsed-history cache. */
export function clearSessionHistoryCache(): void {
  historyCache.clear();
}

// Byte offset of the first byte AFTER the first '\n' at index >=
// `from`. Snapping the split to a newline keeps the prefix made of
// only complete lines. Returns `buf.length` when no newline follows
// (degenerate: the whole buffer becomes prefix, tail empty).
function nextLineBoundary(buf: Buffer, from: number): number {
  const nl = buf.indexOf(0x0a, from);
  return nl === -1 ? buf.length : nl + 1;
}

// Byte offset of the next TURN-START line at/after `from`. The
// prefix/tail seam must land here so a tool_use→tool_result pair (or
// a consecutive-call merge) never straddles it — those live inside
// one turn. Falls back to the next plain line boundary when the
// provider doesn't expose turn boundaries, or none is found within a
// bounded scan (keeps the tail from growing without limit).
function nextTurnBoundary(
  buf: Buffer,
  from: number,
  provider: SessionProvider,
): number {
  if (!provider.isTurnBoundary) return nextLineBoundary(buf, from);
  const scanLimit = Math.min(buf.length, from + TAIL_TARGET);
  let pos = from === 0 ? 0 : nextLineBoundary(buf, from);
  while (pos < scanLimit) {
    const nl = buf.indexOf(0x0a, pos);
    const end = nl === -1 ? buf.length : nl;
    const line = buf.toString("utf-8", pos, end);
    if (line.trim() && provider.isTurnBoundary(line)) return pos;
    if (nl === -1) break;
    pos = nl + 1;
  }
  // No turn start within the scan window — accept a line boundary.
  return nextLineBoundary(buf, from);
}

function parseChunk(
  provider: SessionProvider,
  text: string,
  mtimeMs: number,
): ActivityEntry[] {
  const lines = text.split("\n").filter(Boolean);
  return provider.parseActivities(lines, { mtimeMs }).activities;
}

function readRange(filePath: string, start: number, end: number): Buffer {
  const length = end - start;
  if (length <= 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(length);
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buf, 0, length, start);
  } finally {
    closeSync(fd);
  }
  return buf;
}

// Parse the full, untruncated activity history from a session file.
// Returns entries in chronological order (oldest first).
export function parseSessionHistory(filePath: string): ActivityEntry[] {
  if (!existsSync(filePath)) return [];

  let mtimeMs: number;
  let size: number;
  try {
    const st = statSync(filePath);
    mtimeMs = st.mtimeMs;
    size = st.size;
  } catch {
    return [];
  }

  const cached = historyCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.prefixActivities.concat(cached.tailActivities);
  }

  const provider = providerForPath(filePath);

  // Non-line-delimited (Kiro IDE single JSON doc): always whole-file.
  if (!provider.lineDelimited) {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      return [];
    }
    const lines = content.trim().split("\n").filter(Boolean);
    const activities = provider.parseActivities(lines, { mtimeMs }).activities;
    historyCache.set(filePath, {
      mtimeMs,
      size,
      prefixByteLen: size,
      prefixActivities: activities,
      tailActivities: [],
    });
    return activities;
  }

  // Incremental append: file grew and the frozen prefix is intact.
  // (A same-size-but-changed mtime, or a shrink, means the file was
  // rewritten — fall through to a full reparse.) Reads only the
  // appended tail bytes, never the whole file.
  if (cached && size > cached.size) {
    const tailBytes = readRange(filePath, cached.prefixByteLen, size);
    let entry: HistoryCacheEntry;
    if (tailBytes.length <= TAIL_MAX) {
      entry = {
        mtimeMs,
        size,
        prefixByteLen: cached.prefixByteLen,
        prefixActivities: cached.prefixActivities,
        tailActivities: parseChunk(
          provider,
          tailBytes.toString("utf-8"),
          mtimeMs,
        ),
      };
    } else {
      // Tail outgrew the cap: fold the older part into the frozen
      // prefix, keeping the live tail bounded again.
      const splitInTail = nextTurnBoundary(
        tailBytes,
        tailBytes.length - TAIL_TARGET,
        provider,
      );
      entry = {
        mtimeMs,
        size,
        prefixByteLen: cached.prefixByteLen + splitInTail,
        prefixActivities: cached.prefixActivities.concat(
          parseChunk(
            provider,
            tailBytes.subarray(0, splitInTail).toString("utf-8"),
            mtimeMs,
          ),
        ),
        tailActivities: parseChunk(
          provider,
          tailBytes.subarray(splitInTail).toString("utf-8"),
          mtimeMs,
        ),
      };
    }
    historyCache.set(filePath, entry);
    return entry.prefixActivities.concat(entry.tailActivities);
  }

  // Full (re)parse: first sight of this file, or it was rewritten.
  // Read as a string; only large files pay a Buffer copy to locate
  // the prefix/tail split on a byte boundary.
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  let prefixByteLen = 0;
  let prefixActivities: ActivityEntry[] = [];
  let tailText = content;
  if (Buffer.byteLength(content, "utf-8") > TAIL_TARGET) {
    const buf = Buffer.from(content, "utf-8");
    prefixByteLen = nextTurnBoundary(buf, buf.length - TAIL_TARGET, provider);
    prefixActivities = parseChunk(
      provider,
      buf.subarray(0, prefixByteLen).toString("utf-8"),
      mtimeMs,
    );
    tailText = buf.subarray(prefixByteLen).toString("utf-8");
  }
  const tailActivities = parseChunk(provider, tailText, mtimeMs);
  historyCache.set(filePath, {
    mtimeMs,
    size,
    prefixByteLen,
    prefixActivities,
    tailActivities,
  });
  return prefixActivities.concat(tailActivities);
}
