import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  createWriteStream: vi.fn(),
  copyFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}));
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// resolveSummaryEngine does a real PATH lookup for the agent CLI,
// which isn't present in the test/CI environment. Keep the real
// engines (their stream-json parser matches the mocked spawn output)
// but force resolution to the claude engine.
vi.mock("../../src/data/summaryEngines.js", async (importActual) => {
  const actual =
    await importActual<typeof import("../../src/data/summaryEngines.js")>();
  // A vi.fn (not a plain arrow) so individual tests can override the
  // resolved engine via mockReturnValueOnce — e.g. to exercise the
  // stdin-input Kiro path. clearAllMocks keeps the default impl.
  return {
    ...actual,
    resolveSummaryEngine: vi.fn(() => actual.claudeEngine),
  };
});

vi.mock("../../src/data/sessions.js", () => ({
  discoverSessions: vi.fn(() => ({
    projects: [],
    coldProjects: [],
    totalCount: 0,
    timestamp: "",
  })),
  getProjectsDir: vi.fn(() => "/tmp/projects"),
}));
vi.mock("../../src/data/reportGenerator.js", () => ({
  generateReport: vi.fn(
    () => "# Report\n\n## test (10:00 – 11:00)\n[10:00] $ Bash: ls\n",
  ),
}));
vi.mock("../../src/config/globalConfig.js", () => ({
  loadGlobalConfig: vi.fn(() => ({
    refreshIntervalMs: 2000,
    hiddenSessions: [],
    hiddenSubAgents: [],
    filterPresets: [[]],
  })),
}));

const {
  existsSync,
  readFileSync,
  writeFileSync,
  createWriteStream,
  copyFileSync,
} = await import("node:fs");
const { spawn } = await import("node:child_process");
const { kiroEngine, resolveSummaryEngine } = await import(
  "../../src/data/summaryEngines.js"
);
const { runSummary } = await import("../../src/data/summaryRunner.js");

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

// Emits `text` wrapped in a claude stream-json assistant event (what
// the claude engine's parser consumes), followed by a result event.
// `onStdin` captures what the runner writes to the child's stdin — the
// prompt travels there (never on argv: a multi-line argv cannot pass
// through the Windows `cmd.exe` shim launch).
function mockClaudeProcess(
  text = "OK",
  exitCode = 0,
  stderr = "",
  onStdin?: (chunk: string) => void,
) {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: Readable;
    stderr: Readable;
  };
  proc.stdin = new PassThrough();
  if (onStdin) proc.stdin.on("data", (c: Buffer) => onStdin(c.toString()));
  const streamJson =
    `${JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text }] },
    })}\n` +
    `${JSON.stringify({
      type: "result",
      usage: { input_tokens: 1, output_tokens: 1 },
    })}\n`;
  proc.stdout = Readable.from([streamJson]);
  proc.stderr = Readable.from([stderr]);
  setImmediate(() => proc.emit("close", exitCode));
  return proc;
}

// A Kiro-style process: plain text on stdout (the kiro parser strips
// ANSI and passes it through), and a capturable stdin. `onStdin`
// receives each chunk written to the child's stdin. `failStdin` makes
// the stdin pipe emit an EPIPE on end() — simulating Kiro closing its
// input early — to prove the runner doesn't crash on it.
function mockKiroProcess(
  opts: {
    onStdin?: (chunk: string) => void;
    failStdin?: boolean;
    exitCode?: number;
    stderrText?: string;
  } = {},
) {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: Readable;
    stderr: Readable;
  };
  proc.stdin = new PassThrough();
  if (opts.onStdin) {
    proc.stdin.on("data", (c: Buffer) => opts.onStdin?.(c.toString()));
  }
  if (opts.failStdin) {
    proc.stdin.end = (() => {
      proc.stdin.emit(
        "error",
        Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
      );
      return proc.stdin;
    }) as typeof proc.stdin.end;
  }
  proc.stdout = Readable.from(["kiro summary text"]);
  proc.stderr = Readable.from([opts.stderrText ?? ""]);
  setImmediate(() => proc.emit("close", opts.exitCode ?? 0));
  return proc;
}

// These tests assert against the DEFAULT home-dir layout
// (join(homedir(), ".agenthud")). The global setup points
// AGENTHUD_HOME at a temp dir for isolation; unset it here — safe
// because this file mocks node:fs, so no real I/O can occur.
beforeAll(() => {
  delete process.env.AGENTHUD_HOME;
});

describe("runSummary cache behavior", () => {
  it("returns cached content for past date when cache exists and !force", async () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith("2026-05-14.md"),
    );
    vi.mocked(readFileSync).mockReturnValue("cached summary text");

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string | Uint8Array) => {
      stdoutChunks.push(String(c));
      return true;
    }) as typeof process.stdout.write;

    const code = await runSummary({
      date: new Date(2026, 4, 14),
      force: false,
      today: new Date(2026, 4, 15),
    });

    process.stdout.write = origWrite;
    expect(code).toBe(0);
    expect(stdoutChunks.join("")).toContain("cached summary text");
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  it("on a cache hit, reports the file path with cache wording (not 'saved to')", async () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith("2026-05-14.md"),
    );
    vi.mocked(readFileSync).mockReturnValue("cached summary text");

    const origOut = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    const stderrChunks: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string | Uint8Array) => {
      stderrChunks.push(String(c));
      return true;
    }) as typeof process.stderr.write;

    await runSummary({
      date: new Date(2026, 4, 14),
      force: false,
      today: new Date(2026, 4, 15),
    });

    process.stdout.write = origOut;
    process.stderr.write = origErr;
    const allErr = stderrChunks.join("");
    // The path must be reported so the user can open the file, and the
    // wording must reflect a cache read — nothing was "saved".
    expect(allErr).toContain("2026-05-14.md");
    expect(allErr).toMatch(/from cache/i);
    expect(allErr).not.toContain("saved to");
  });

  it("on a fresh generation, reports the file path with write wording", async () => {
    vi.mocked(existsSync).mockReturnValue(false); // no cache → generate
    const mockStream = {
      write: vi.fn(),
      end: vi.fn((cb?: () => void) => {
        if (cb) cb();
      }),
      on: vi.fn().mockReturnThis(),
    };
    vi.mocked(createWriteStream).mockReturnValue(
      mockStream as unknown as ReturnType<typeof createWriteStream>,
    );
    vi.mocked(spawn).mockReturnValue(
      mockClaudeProcess() as unknown as ReturnType<typeof spawn>,
    );

    const origOut = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    const stderrChunks: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string | Uint8Array) => {
      stderrChunks.push(String(c));
      return true;
    }) as typeof process.stderr.write;

    await runSummary({
      date: new Date(2026, 4, 14),
      force: false,
      today: new Date(2026, 4, 15),
    });

    process.stdout.write = origOut;
    process.stderr.write = origErr;
    const allErr = stderrChunks.join("");
    expect(allErr).toContain("2026-05-14.md");
    expect(allErr).toMatch(/written to/i);
    expect(allErr).not.toContain("saved to");
  });

  it("bypasses cache when force is true", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("ignored");
    const mockStream = {
      write: vi.fn(),
      end: vi.fn((cb?: () => void) => {
        if (cb) cb();
      }),
      on: vi.fn().mockReturnThis(),
    };
    vi.mocked(createWriteStream).mockReturnValue(
      mockStream as unknown as ReturnType<typeof createWriteStream>,
    );
    vi.mocked(spawn).mockReturnValue(
      mockClaudeProcess() as unknown as ReturnType<typeof spawn>,
    );

    await runSummary({
      date: new Date(2026, 4, 14),
      force: true,
      today: new Date(2026, 4, 15),
    });

    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
  });

  it("bypasses cache for today's date even without force", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("ignored");
    const mockStream = {
      write: vi.fn(),
      end: vi.fn((cb?: () => void) => {
        if (cb) cb();
      }),
      on: vi.fn().mockReturnThis(),
    };
    vi.mocked(createWriteStream).mockReturnValue(
      mockStream as unknown as ReturnType<typeof createWriteStream>,
    );
    vi.mocked(spawn).mockReturnValue(
      mockClaudeProcess() as unknown as ReturnType<typeof spawn>,
    );

    await runSummary({
      date: new Date(2026, 4, 15),
      force: false,
      today: new Date(2026, 4, 15),
    });

    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
  });
});

describe("runSummary prompt resolution", () => {
  it("uses --prompt override when provided", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const mockStream = {
      write: vi.fn(),
      end: vi.fn((cb?: () => void) => {
        if (cb) cb();
      }),
      on: vi.fn().mockReturnThis(),
    };
    vi.mocked(createWriteStream).mockReturnValue(
      mockStream as unknown as ReturnType<typeof createWriteStream>,
    );
    let stdin = "";
    vi.mocked(spawn).mockReturnValue(
      mockClaudeProcess("OK", 0, "", (c) => {
        stdin += c;
      }) as unknown as ReturnType<typeof spawn>,
    );

    await runSummary({
      date: new Date(2026, 4, 15),
      force: false,
      today: new Date(2026, 4, 15),
      prompt: "custom prompt here",
    });

    const callArgs = vi.mocked(spawn).mock.calls[0];
    expect(callArgs[0]).toBe("claude");
    // Prompt on stdin, NOT argv (see mockClaudeProcess).
    expect(callArgs[1]).not.toContain("custom prompt here");
    expect(stdin).toContain("custom prompt here");
    expect(stdin).toContain("## test");
  });

  it("uses ~/.agenthud/summary-prompt.md when present and no --prompt", async () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith("summary-prompt.md"),
    );
    vi.mocked(readFileSync).mockReturnValue("user file prompt");
    const mockStream = {
      write: vi.fn(),
      end: vi.fn((cb?: () => void) => {
        if (cb) cb();
      }),
      on: vi.fn().mockReturnThis(),
    };
    vi.mocked(createWriteStream).mockReturnValue(
      mockStream as unknown as ReturnType<typeof createWriteStream>,
    );
    let stdin = "";
    vi.mocked(spawn).mockReturnValue(
      mockClaudeProcess("OK", 0, "", (c) => {
        stdin += c;
      }) as unknown as ReturnType<typeof spawn>,
    );

    await runSummary({
      date: new Date(2026, 4, 15),
      force: false,
      today: new Date(2026, 4, 15),
    });

    const callArgs = vi.mocked(spawn).mock.calls[0];
    expect(callArgs[1]).not.toContain("user file prompt");
    expect(stdin).toContain("user file prompt");
  });

  it("copies built-in template to user dir on first run", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const mockStream = {
      write: vi.fn(),
      end: vi.fn((cb?: () => void) => {
        if (cb) cb();
      }),
      on: vi.fn().mockReturnThis(),
    };
    vi.mocked(createWriteStream).mockReturnValue(
      mockStream as unknown as ReturnType<typeof createWriteStream>,
    );
    vi.mocked(spawn).mockReturnValue(
      mockClaudeProcess() as unknown as ReturnType<typeof spawn>,
    );

    await runSummary({
      date: new Date(2026, 4, 15),
      force: false,
      today: new Date(2026, 4, 15),
    });

    expect(vi.mocked(copyFileSync)).toHaveBeenCalledWith(
      expect.stringContaining("summary-prompt.md"),
      expect.stringMatching(/\.agenthud[/\\]summary-prompt\.md$/),
    );
  });
});

describe("runSummary spawn options", () => {
  it("spawns claude with ~/.agenthud as cwd", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const mockStream = {
      write: vi.fn(),
      end: vi.fn((cb?: () => void) => {
        if (cb) cb();
      }),
      on: vi.fn().mockReturnThis(),
    };
    vi.mocked(createWriteStream).mockReturnValue(
      mockStream as unknown as ReturnType<typeof createWriteStream>,
    );
    vi.mocked(spawn).mockReturnValue(
      mockClaudeProcess() as unknown as ReturnType<typeof spawn>,
    );

    await runSummary({
      date: new Date(2026, 4, 15),
      force: false,
      today: new Date(2026, 4, 15),
    });

    const callArgs = vi.mocked(spawn).mock.calls[0];
    const opts = callArgs[2] as { cwd: string };
    expect(opts).toBeDefined();
    expect(opts.cwd).toContain(".agenthud");
  });
});

describe("runSummary stdin-input engine (Kiro)", () => {
  it("sends the prompt AND the report on stdin for a stdin-mode engine", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(resolveSummaryEngine).mockReturnValueOnce(kiroEngine);

    let stdin = "";
    const mockStream = {
      write: vi.fn(),
      end: vi.fn((cb?: () => void) => {
        if (cb) cb();
      }),
      on: vi.fn().mockReturnThis(),
    };
    vi.mocked(createWriteStream).mockReturnValue(
      mockStream as unknown as ReturnType<typeof createWriteStream>,
    );
    vi.mocked(spawn).mockReturnValue(
      mockKiroProcess({
        onStdin: (c) => {
          stdin += c;
        },
      }) as unknown as ReturnType<typeof spawn>,
    );

    await runSummary({
      date: new Date(2026, 4, 15),
      force: false,
      today: new Date(2026, 4, 15),
      prompt: "SUMMARIZE THIS",
    });

    // Kiro ignores a positional question when stdin is piped, so the
    // instruction prompt has to ride along on stdin with the report.
    const callArgs = vi.mocked(spawn).mock.calls[0];
    expect(callArgs[0]).toBe("kiro-cli");
    expect(callArgs[1]).not.toContain("SUMMARIZE THIS");
    expect(stdin).toContain("SUMMARIZE THIS");
    // ...followed by the generated report payload (the mocked report).
    expect(stdin).toContain("## test");
  });

  it("suppresses Kiro's benign --trust-tools warning but keeps real stderr", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(resolveSummaryEngine).mockReturnValueOnce(kiroEngine);

    const mockStream = {
      write: vi.fn(),
      end: vi.fn((cb?: () => void) => {
        if (cb) cb();
      }),
      on: vi.fn().mockReturnThis(),
    };
    vi.mocked(createWriteStream).mockReturnValue(
      mockStream as unknown as ReturnType<typeof createWriteStream>,
    );
    vi.mocked(spawn).mockReturnValue(
      mockKiroProcess({
        stderrText:
          "WARNING: --trust-tools arg for custom tool  needs to be prepended with @{MCPSERVERNAME}/\nreal diagnostic line\n",
      }) as unknown as ReturnType<typeof spawn>,
    );

    const stderrChunks: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string | Uint8Array) => {
      stderrChunks.push(String(c));
      return true;
    }) as typeof process.stderr.write;

    await runSummary({
      date: new Date(2026, 4, 15),
      force: false,
      today: new Date(2026, 4, 15),
      prompt: "p",
    });

    process.stderr.write = origErr;
    const allErr = stderrChunks.join("");
    expect(allErr).not.toContain("--trust-tools arg for custom tool");
    expect(allErr).toContain("real diagnostic line");
  });

  it("does not crash when the engine closes stdin early (EPIPE)", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(resolveSummaryEngine).mockReturnValueOnce(kiroEngine);

    const mockStream = {
      write: vi.fn(),
      end: vi.fn((cb?: () => void) => {
        if (cb) cb();
      }),
      on: vi.fn().mockReturnThis(),
    };
    vi.mocked(createWriteStream).mockReturnValue(
      mockStream as unknown as ReturnType<typeof createWriteStream>,
    );
    vi.mocked(spawn).mockReturnValue(
      mockKiroProcess({ failStdin: true }) as unknown as ReturnType<
        typeof spawn
      >,
    );

    const code = await runSummary({
      date: new Date(2026, 4, 15),
      force: false,
      today: new Date(2026, 4, 15),
      prompt: "p",
    });

    // An unhandled 'error' on the stdin socket would throw and abort the
    // process; reaching here with a clean exit proves it's swallowed.
    expect(code).toBe(0);
  });
});

describe("runSummary cache write error", () => {
  it("emits a warning and still succeeds when the cache write fails", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    // The summary text is assembled fine, but the atomic cache write
    // (writeFileSync) throws — a permissions / disk issue. The run
    // should warn and still return 0 (the user got their summary).
    vi.mocked(writeFileSync).mockImplementation(() => {
      throw new Error("EACCES");
    });

    const stderrChunks: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string | Uint8Array) => {
      stderrChunks.push(String(c));
      return true;
    }) as typeof process.stderr.write;

    vi.mocked(spawn).mockReturnValue(
      mockClaudeProcess() as unknown as ReturnType<typeof spawn>,
    );

    const code = await runSummary({
      date: new Date(2026, 4, 15),
      force: false,
      today: new Date(2026, 4, 15),
    });

    process.stderr.write = origErr;
    expect(stderrChunks.join("")).toContain("cannot write cache");
    expect(code).toBe(0);
  });
});

// ── CodeRabbit review fixes (PR #233) ───────────────────────────────────────
// Two defects the reviewer flagged as "outside diff range". Both were real:
// scratch files were named from cachePath alone, so concurrent runs for the
// same date+scope collided; and the range cache-hit path ignored `quiet`.
//
// NOTE: the file-level beforeEach calls vi.clearAllMocks(), which resets
// CALLS but not IMPLEMENTATIONS. Earlier tests in this file install a
// throwing writeFileSync and a shared spawn return value, so each block
// below re-establishes its own baseline.

const { claudeEngine, codexEngine } = await import(
  "../../src/data/summaryEngines.js"
);

function resetRunnerMocks(): void {
  vi.mocked(writeFileSync).mockReset();
  vi.mocked(readFileSync).mockReset();
  vi.mocked(existsSync).mockReset();
  vi.mocked(spawn).mockReset();
  vi.mocked(resolveSummaryEngine).mockReset();
  vi.mocked(resolveSummaryEngine).mockImplementation(() => claudeEngine);
  vi.mocked(writeFileSync).mockReturnValue(undefined);
  // A FRESH process per spawn: mockReturnValue would hand the second run an
  // EventEmitter whose "close" already fired, so the run would never settle.
  vi.mocked(spawn).mockImplementation(
    () => mockClaudeProcess("", 0) as unknown as ReturnType<typeof spawn>,
  );
}

describe("scratch files are per-run, not per-cache-path", () => {
  beforeEach(resetRunnerMocks);

  it("gives each file-mode run its own engine-out and .tmp names", async () => {
    // Codex is the "file"-mode engine: it writes its answer to the -o path
    // we hand it, and the runner reads that path back on close.
    vi.mocked(resolveSummaryEngine).mockImplementation(() => codexEngine);
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReturnValue(
      "<!-- agenthud-engine: codex model: default -->\n\n### 工作内容\n\n1、demo：\n（1）做了些事。\n",
    );

    // Two runs for the SAME date => the same cachePath. That is exactly the
    // two-browser-tabs case: with a cachePath-derived scratch name the runs
    // share one file, so one reads a half-written message and the other
    // unlinks it out from under it.
    const date = new Date(2026, 4, 14);
    const today = new Date(2026, 4, 15);
    for (let i = 0; i < 2; i++) {
      const code = await runSummary({ date, force: true, today });
      expect(code).toBe(0);
    }

    const outPaths = vi
      .mocked(readFileSync)
      .mock.calls.map((c) => String(c[0]))
      .filter((p) => p.endsWith(".engine-out"));
    const tmpPaths = vi
      .mocked(writeFileSync)
      .mock.calls.map((c) => String(c[0]))
      .filter((p) => p.endsWith(".tmp"));

    expect(outPaths).toHaveLength(2);
    expect(tmpPaths).toHaveLength(2);
    // Same cache target...
    expect(outPaths[0]).toContain("2026-05-14");
    expect(outPaths[1]).toContain("2026-05-14");
    // ...but no shared scratch file.
    expect(outPaths[0]).not.toBe(outPaths[1]);
    expect(tmpPaths[0]).not.toBe(tmpPaths[1]);
  });
});

describe("runRangeSummary honors quiet", () => {
  beforeEach(resetRunnerMocks);

  // A past range, so shouldUseRangeCache() accepts the cache (today is
  // never cacheable). The marker carries no `prompt:` field, so
  // cacheMatchesEngine matches on engine+model alone and we don't have to
  // reproduce the real prompt hash here.
  const CACHED =
    "<!-- agenthud-engine: claude model: default -->\n\n### 工作内容\n\n1、demo：\n（1）做了些事。\n";
  const rangeOpts = (quiet: boolean) => ({
    from: new Date(2026, 4, 10),
    to: new Date(2026, 4, 12),
    today: new Date(2026, 4, 15),
    force: false,
    assumeYes: true,
    include: ["bash"],
    detailLimit: 0,
    withGit: false,
    quiet,
  });

  async function captureStdio(fn: () => Promise<unknown>) {
    const out: string[] = [];
    const err: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string | Uint8Array) => {
      out.push(String(c));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((c: string | Uint8Array) => {
      err.push(String(c));
      return true;
    }) as typeof process.stderr.write;
    try {
      await fn();
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    return { out: out.join(""), err: err.join("") };
  }

  it("writes nothing to stdout or stderr on a cache hit", async () => {
    const { runRangeSummary } = await import("../../src/data/summaryRunner.js");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(CACHED);

    const { out, err } = await captureStdio(() =>
      runRangeSummary(rangeOpts(true)),
    );

    // The web server reads the result from the cache file; a cache hit
    // used to dump the whole markdown onto its stdout and narrate on its
    // stderr, corrupting the caller's own output.
    expect(out).toBe("");
    expect(err).toBe("");
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });

  it("still streams the cached text and the path when not quiet", async () => {
    const { runRangeSummary } = await import("../../src/data/summaryRunner.js");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(CACHED);

    const { out, err } = await captureStdio(() =>
      runRangeSummary(rangeOpts(false)),
    );

    expect(out).toContain("### 工作内容");
    expect(err).toContain("from cache");
    expect(vi.mocked(spawn)).not.toHaveBeenCalled();
  });
});
