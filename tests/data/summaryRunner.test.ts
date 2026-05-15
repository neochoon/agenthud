import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  createWriteStream: vi.fn(),
  copyFileSync: vi.fn(),
}));
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));
vi.mock("../../src/data/sessions.js", () => ({
  discoverSessions: vi.fn(() => ({
    sessions: [],
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
    logDir: "/tmp/logs",
    hiddenSessions: [],
    hiddenSubAgents: [],
    filterPresets: [[]],
  })),
}));

const { existsSync, readFileSync, createWriteStream, copyFileSync } =
  await import("node:fs");
const { spawn } = await import("node:child_process");
const { runSummary } = await import("../../src/data/summaryRunner.js");

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

function mockClaudeProcess(stdout = "OK", exitCode = 0, stderr = "") {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: Readable;
    stderr: Readable;
  };
  proc.stdin = new PassThrough();
  proc.stdout = Readable.from([stdout]);
  proc.stderr = Readable.from([stderr]);
  setImmediate(() => proc.emit("close", exitCode));
  return proc;
}

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
      end: vi.fn(),
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
      end: vi.fn(),
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
      end: vi.fn(),
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
      end: vi.fn(),
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
      end: vi.fn(),
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
      expect.stringContaining(".agenthud/summary-prompt.md"),
    );
  });
});

describe("runSummary cache write error", () => {
  it("emits warning to stderr and continues when cache stream errors", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const writeFn = vi.fn();
    const endFn = vi.fn();
    let errorHandler: ((err: Error) => void) | undefined;
    const fakeStream = {
      write: writeFn,
      end: endFn,
      on: (ev: string, fn: (err: Error) => void) => {
        if (ev === "error") errorHandler = fn;
        return fakeStream;
      },
    };
    vi.mocked(createWriteStream).mockReturnValue(
      fakeStream as unknown as ReturnType<typeof createWriteStream>,
    );

    const stderrChunks: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string | Uint8Array) => {
      stderrChunks.push(String(c));
      return true;
    }) as typeof process.stderr.write;

    vi.mocked(spawn).mockReturnValue(
      mockClaudeProcess() as unknown as ReturnType<typeof spawn>,
    );

    const promise = runSummary({
      date: new Date(2026, 4, 15),
      force: false,
      today: new Date(2026, 4, 15),
    });

    // Trigger error before stream operations complete
    await new Promise((resolve) => setImmediate(resolve));
    errorHandler?.(new Error("EACCES"));
    await new Promise((resolve) => setImmediate(resolve));

    const code = await promise;

    // Check stderr output contains the error warning
    const output = stderrChunks.join("");
    expect(output).toContain("cannot write cache");
    expect(code).toBe(0);

    process.stderr.write = origErr;
  });
});
