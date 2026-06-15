import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
}));

const { existsSync, readFileSync, statSync } = await import("node:fs");
const { parseSessionHistory, clearSessionHistoryCache, HISTORY_CACHE_MAX } =
  await import("../../src/data/sessionHistory.js");

// Each test sets readFileSync's return; mirror its byte size into
// statSync so the (mtime, size)-gated incremental cache treats the
// file as a single small full-parse (size < TAIL_TARGET → no
// byte-offset/tail-read path, which the fs mock doesn't implement).
function stubStat(content: string): void {
  vi.mocked(statSync).mockReturnValue({
    mtimeMs: 1,
    size: Buffer.byteLength(content, "utf-8"),
  } as ReturnType<typeof statSync>);
}

afterEach(() => {
  vi.resetAllMocks();
  delete process.env.KIRO_SESSIONS_DIR;
  clearSessionHistoryCache();
});

const makeLines = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Read",
            input: { file_path: `/src/file${i}.ts` },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
    }),
  ).join("\n");

describe("parseSessionHistory", () => {
  it("returns empty array when file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(parseSessionHistory("/nonexistent.jsonl")).toHaveLength(0);
  });

  it("parses all entries without truncation (300 lines)", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(makeLines(300));
    stubStat(makeLines(300));
    const result = parseSessionHistory("/session.jsonl");
    expect(result.length).toBe(300);
  });

  it("returns entries in chronological order (oldest first)", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(makeLines(5));
    stubStat(makeLines(5));
    const result = parseSessionHistory("/session.jsonl");
    for (let i = 1; i < result.length; i++) {
      expect(result[i].timestamp.getTime()).toBeGreaterThanOrEqual(
        result[i - 1].timestamp.getTime(),
      );
    }
  });

  it("routes Kiro paths to the Kiro parser (not the Claude one)", () => {
    // A line in Kiro shape (`kind: "Prompt"`) — the Claude parser
    // would silently produce zero activities for this; the Kiro
    // parser maps it to a user activity.
    const kiroLine = JSON.stringify({
      version: "v1",
      kind: "Prompt",
      data: {
        message_id: "p1",
        content: [{ kind: "text", data: "Hello Kiro" }],
        meta: { timestamp: 1781220419 },
      },
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(kiroLine);
    stubStat(kiroLine);
    const result = parseSessionHistory("/Users/x/.kiro/sessions/cli/aaa.jsonl");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("user");
    expect(result[0].detail).toBe("Hello Kiro");
  });

  it("routes paths under a KIRO_SESSIONS_DIR override to the Kiro parser", () => {
    // The override moves the Kiro root to a path that contains
    // neither `/.kiro/sessions/` nor `kiro.kiroagent/` — a
    // segment-only check would silently route these to the Claude
    // parser and the activities would come back empty.
    process.env.KIRO_SESSIONS_DIR = "/tmp/kiro-alt";
    const kiroLine = JSON.stringify({
      version: "v1",
      kind: "Prompt",
      data: {
        message_id: "p1",
        content: [{ kind: "text", data: "Hello from override" }],
        meta: { timestamp: 1781220419 },
      },
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(kiroLine);
    stubStat(kiroLine);
    const result = parseSessionHistory("/tmp/kiro-alt/aaa.jsonl");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("user");
    expect(result[0].detail).toBe("Hello from override");
  });

  it("routes non-Kiro paths to the Claude parser (default)", () => {
    // Claude parser ignores Kiro-shaped records, so a Kiro line
    // fed through a non-Kiro path yields zero activities.
    const kiroLine = JSON.stringify({
      version: "v1",
      kind: "Prompt",
      data: {
        message_id: "p1",
        content: [{ kind: "text", data: "Hello" }],
        meta: { timestamp: 1781220419 },
      },
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(kiroLine);
    stubStat(kiroLine);
    const result = parseSessionHistory(
      "/Users/x/.claude/projects/-foo/bar.jsonl",
    );
    expect(result).toHaveLength(0);
  });
});

// The watch process is long-lived and re-parses the selected session on
// every 2s refresh. Two memory/CPU hazards this guards against (the
// "agenthud froze after hours, 680MB, no Ctrl+C" report):
//   1. the cache must return a STABLE reference on a hit, so setActivities
//      bails out of re-rendering when nothing changed.
//   2. the cache must be BOUNDED, so it doesn't accumulate every session's
//      full activity array forever.
describe("parseSessionHistory cache (memory/CPU safety)", () => {
  it("returns the same array reference on a cache hit (no churn)", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(makeLines(20));
    stubStat(makeLines(20));
    const a = parseSessionHistory("/s.jsonl");
    const b = parseSessionHistory("/s.jsonl");
    expect(b).toBe(a);
  });

  it("bounds the cache with LRU eviction (oldest dropped past the cap)", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(makeLines(5));
    stubStat(makeLines(5));

    const first = parseSessionHistory("/f0.jsonl");
    // Fill past the cap with distinct paths → f0 becomes least-recent.
    for (let i = 1; i <= HISTORY_CACHE_MAX; i++) {
      parseSessionHistory(`/f${i}.jsonl`);
    }
    // f0 was evicted → re-parsing yields a NEW reference.
    expect(parseSessionHistory("/f0.jsonl")).not.toBe(first);
  });

  it("keeps a small fixed cap regardless of how many sessions are read", () => {
    expect(HISTORY_CACHE_MAX).toBeGreaterThan(0);
    expect(HISTORY_CACHE_MAX).toBeLessThanOrEqual(16);
  });
});
