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
function mockClaudeProcess(text = "OK", exitCode = 0, stderr = "") {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: Readable;
    stderr: Readable;
  };
  proc.stdin = new PassThrough();
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
    vi.mocked(spawn).mockReturnValue(
      mockClaudeProcess() as unknown as ReturnType<typeof spawn>,
    );

    await runSummary({
      date: new Date(2026, 4, 15),
      force: false,
      today: new Date(2026, 4, 15),
      prompt: "custom prompt here",
    });

    const callArgs = vi.mocked(spawn).mock.calls[0];
    expect(callArgs[0]).toBe("claude");
    expect(callArgs[1]).toContain("custom prompt here");
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
    vi.mocked(spawn).mockReturnValue(
      mockClaudeProcess() as unknown as ReturnType<typeof spawn>,
    );

    await runSummary({
      date: new Date(2026, 4, 15),
      force: false,
      today: new Date(2026, 4, 15),
    });

    const callArgs = vi.mocked(spawn).mock.calls[0];
    expect(callArgs[1]).toContain("user file prompt");
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
