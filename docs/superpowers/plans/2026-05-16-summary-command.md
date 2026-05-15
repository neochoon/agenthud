# Summary Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `agenthud summary` subcommand that runs `report` internally, pipes the markdown into `claude -p`, streams the response to stdout while tee-writing it to a per-date cache file under `~/.agenthud/summaries/`.

**Architecture:** Three layers — (1) `summaryRunner.ts` orchestrates cache + claude spawn + tee; (2) `cli.ts` parses the new `summary` subcommand and its flags; (3) `main.ts` dispatches to `runSummary()`. A new template at `src/templates/summary-prompt.md` is copied to `~/.agenthud/summary-prompt.md` on first run.

**Tech Stack:** TypeScript, Node.js `child_process.spawn` (for `claude`), `node:fs` (for cache and template I/O), Vitest. No new dependencies.

---

## File Structure

| File | Change |
|------|--------|
| `src/templates/summary-prompt.md` | **Create** — built-in default prompt |
| `src/data/summaryRunner.ts` | **Create** — cache, prompt resolve, claude spawn, tee |
| `src/cli.ts` | Modify — `summary` subcommand parsing |
| `src/main.ts` | Modify — `summary` mode branch |
| `tests/data/summaryRunner.test.ts` | **Create** — unit tests |
| `tests/cli.test.ts` | Modify — summary parsing tests |
| `tsup.config.ts` | Modify — copy `templates/*.md` into `dist/templates/` |

---

## Task 1: Built-in prompt template

**Files:**
- Create: `src/templates/summary-prompt.md`

- [ ] **Step 1: Create the template file**

```markdown
다음은 오늘 Claude Code로 작업한 활동 로그입니다. 이를 바탕으로 작업 내용을 한국어로 간결하게 정리해주세요.

다음 형식으로 작성해주세요:

## 완료한 작업
- (Response 위주로 어떤 일을 해냈는지)

## 주요 변경사항
- (Edit/Write로 어떤 파일을 어떻게 바꿨는지)

## 커밋 내역
- (◆ commit 줄들 요약)

원본 로그:
```

- [ ] **Step 2: Verify tsup includes templates in build**

Read `tsup.config.ts`. If it does not already copy `src/templates/**/*.md` (only `.yaml` is currently copied for `config.yaml`), update the `onSuccess` or `loader`/`publicDir` config so `src/templates/summary-prompt.md` ends up at `dist/templates/summary-prompt.md`.

Run build and verify:

```bash
npm run build && ls dist/templates/
```

Expected output includes both `config.yaml` and `summary-prompt.md`.

- [ ] **Step 3: Commit**

```bash
git add src/templates/summary-prompt.md tsup.config.ts
git commit -m "feat: add default summary prompt template"
```

---

## Task 2: summaryRunner — cache + prompt resolution

**Files:**
- Create: `src/data/summaryRunner.ts`
- Create: `tests/data/summaryRunner.test.ts`

- [ ] **Step 1: Write failing tests for cache logic and prompt resolution**

Create `tests/data/summaryRunner.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Readable, PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

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
  discoverSessions: vi.fn(() => ({ sessions: [], totalCount: 0, timestamp: "" })),
  getProjectsDir: vi.fn(() => "/tmp/projects"),
}));
vi.mock("../../src/data/reportGenerator.js", () => ({
  generateReport: vi.fn(() => "# Report\n\n## test (10:00 – 11:00)\n[10:00] $ Bash: ls\n"),
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

const { existsSync, readFileSync, writeFileSync, createWriteStream, copyFileSync, mkdirSync } =
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
  // Defer exit so callers can wire up event handlers first.
  setImmediate(() => proc.emit("exit", exitCode));
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
    process.stdout.write = ((c: string) => {
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
    vi.mocked(createWriteStream).mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
    } as unknown as ReturnType<typeof createWriteStream>);
    vi.mocked(spawn).mockReturnValue(mockClaudeProcess() as unknown as ReturnType<typeof spawn>);

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
    vi.mocked(createWriteStream).mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
    } as unknown as ReturnType<typeof createWriteStream>);
    vi.mocked(spawn).mockReturnValue(mockClaudeProcess() as unknown as ReturnType<typeof spawn>);

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
    vi.mocked(createWriteStream).mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
    } as unknown as ReturnType<typeof createWriteStream>);
    vi.mocked(spawn).mockReturnValue(mockClaudeProcess() as unknown as ReturnType<typeof spawn>);

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
    vi.mocked(createWriteStream).mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
    } as unknown as ReturnType<typeof createWriteStream>);
    vi.mocked(spawn).mockReturnValue(mockClaudeProcess() as unknown as ReturnType<typeof spawn>);

    await runSummary({
      date: new Date(2026, 4, 15),
      force: false,
      today: new Date(2026, 4, 15),
    });

    const callArgs = vi.mocked(spawn).mock.calls[0];
    expect(callArgs[1]).toContain("user file prompt");
  });

  it("copies built-in template to user dir on first run", async () => {
    vi.mocked(existsSync).mockReturnValue(false); // nothing exists yet
    vi.mocked(createWriteStream).mockReturnValue({
      write: vi.fn(),
      end: vi.fn(),
    } as unknown as ReturnType<typeof createWriteStream>);
    vi.mocked(spawn).mockReturnValue(mockClaudeProcess() as unknown as ReturnType<typeof spawn>);

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/data/summaryRunner.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/data/summaryRunner.ts`**

```typescript
import { spawn } from "node:child_process";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGlobalConfig } from "../config/globalConfig.js";
import { generateReport } from "./reportGenerator.js";
import { discoverSessions } from "./sessions.js";

export interface SummaryOptions {
  date: Date;
  force: boolean;
  prompt?: string;
  today: Date; // injected for testability; production calls pass new Date()
}

function summariesDir(): string {
  const dir = join(homedir(), ".agenthud", "summaries");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function userPromptPath(): string {
  return join(homedir(), ".agenthud", "summary-prompt.md");
}

function templatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "templates", "summary-prompt.md");
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function cachePath(date: Date): string {
  return join(summariesDir(), `${dateKey(date)}.md`);
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function ensureUserPromptFile(): void {
  const p = userPromptPath();
  if (existsSync(p)) return;
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    copyFileSync(templatePath(), p);
  } catch {
    // Template missing in dev or write fails — fall back silently; resolvePrompt() handles it.
  }
}

function resolvePrompt(override: string | undefined): string {
  if (override) return override;
  const p = userPromptPath();
  if (existsSync(p)) {
    try {
      return readFileSync(p, "utf-8");
    } catch {
      // fall through to template
    }
  }
  try {
    return readFileSync(templatePath(), "utf-8");
  } catch {
    return "Summarize the activity log below.";
  }
}

export async function runSummary(options: SummaryOptions): Promise<number> {
  ensureUserPromptFile();

  const isToday = isSameLocalDay(options.date, options.today);
  const cached = cachePath(options.date);

  // Cache hit path (past date, file exists, !force)
  if (!isToday && !options.force && existsSync(cached)) {
    try {
      const content = readFileSync(cached, "utf-8");
      process.stdout.write(content);
      if (!content.endsWith("\n")) process.stdout.write("\n");
      return 0;
    } catch {
      // fall through to regenerate
    }
  }

  // Build report
  const config = loadGlobalConfig();
  const sessions = discoverSessions(config);
  const reportMarkdown = generateReport(sessions.sessions, {
    date: options.date,
    include: ["response", "bash", "edit", "thinking"],
    format: "markdown",
    detailLimit: 0,
    withGit: true,
  });

  const prompt = resolvePrompt(options.prompt);

  // Spawn claude
  return new Promise<number>((resolve) => {
    const proc = spawn("claude", ["-p", prompt], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let cacheStream: ReturnType<typeof createWriteStream> | null = null;
    try {
      cacheStream = createWriteStream(cached, { encoding: "utf-8" });
    } catch (err) {
      process.stderr.write(
        `agenthud: warning: cannot write cache (${(err as Error).message})\n`,
      );
    }

    let stderrBuf = "";

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        process.stderr.write(
          "Error: claude CLI not found. Install: npm i -g @anthropic-ai/claude-code\n",
        );
        resolve(1);
      } else {
        process.stderr.write(`Error: ${err.message}\n`);
        resolve(1);
      }
    });

    proc.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      cacheStream?.write(chunk);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      process.stderr.write(chunk);
    });

    proc.on("exit", (code) => {
      cacheStream?.end();
      if (code !== 0) {
        const lower = stderrBuf.toLowerCase();
        if (
          lower.includes("not authenticated") ||
          lower.includes("login") ||
          lower.includes(" auth")
        ) {
          process.stderr.write(
            "\nHint: claude appears to be unauthenticated. Run: claude\n",
          );
        }
      }
      resolve(code ?? 1);
    });

    proc.stdin.end(reportMarkdown);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/data/summaryRunner.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/data/summaryRunner.ts tests/data/summaryRunner.test.ts
git commit -m "feat: add summaryRunner — cache, prompt resolution, claude spawn"
```

---

## Task 3: CLI parsing for `summary`

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Add failing tests in `tests/cli.test.ts`**

Add inside the existing `describe("parseArgs")`:

```typescript
describe("summary subcommand", () => {
  it("returns summary mode with today by default", () => {
    const opts = parseArgs(["summary"]);
    expect(opts.mode).toBe("summary");
    expect(opts.summaryDate).toBeDefined();
    const today = new Date();
    expect(opts.summaryDate!.getFullYear()).toBe(today.getFullYear());
    expect(opts.summaryDate!.getMonth()).toBe(today.getMonth());
    expect(opts.summaryDate!.getDate()).toBe(today.getDate());
    expect(opts.summaryForce).toBe(false);
  });

  it("parses --date", () => {
    const opts = parseArgs(["summary", "--date", "2026-05-14"]);
    expect(opts.summaryDate!.getFullYear()).toBe(2026);
    expect(opts.summaryDate!.getMonth()).toBe(4);
    expect(opts.summaryDate!.getDate()).toBe(14);
  });

  it("parses --prompt", () => {
    const opts = parseArgs(["summary", "--prompt", "just commits"]);
    expect(opts.summaryPrompt).toBe("just commits");
  });

  it("parses --force", () => {
    const opts = parseArgs(["summary", "--force"]);
    expect(opts.summaryForce).toBe(true);
  });

  it("returns error for unknown flag", () => {
    const opts = parseArgs(["summary", "--bogus"]);
    expect(opts.summaryError).toContain("Unknown option");
  });

  it("returns error for invalid date", () => {
    const opts = parseArgs(["summary", "--date", "not-a-date"]);
    expect(opts.summaryError).toContain("Invalid date");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/cli.test.ts
```

Expected: FAIL — `summaryDate`, `summaryPrompt`, `summaryForce`, `summaryError` not on `CliOptions`.

- [ ] **Step 3: Modify `src/cli.ts`**

Add to `CliOptions`:

```typescript
export interface CliOptions {
  mode: "watch" | "once" | "report" | "summary";
  command?: "version" | "help";
  error?: string;
  reportDate?: Date;
  reportInclude?: string[];
  reportFormat?: "markdown" | "json";
  reportDetailLimit?: number;
  reportWithGit?: boolean;
  reportError?: string;
  summaryDate?: Date;
  summaryPrompt?: string;
  summaryForce?: boolean;
  summaryError?: string;
}
```

Add to known subcommands and flag set:

```typescript
const KNOWN_SUBCOMMANDS = new Set(["report", "summary"]);
const KNOWN_SUMMARY_FLAGS = new Set(["--date", "--prompt", "--force"]);
```

Update `getHelp()` to document the new command. Replace the `Commands:` section with:

```typescript
Commands:
  report [--date DATE] [--include TYPES] [--format FORMAT] [--detail-limit N] [--with-git]
                                Print activity report for a date (default: today)
    --date YYYY-MM-DD|today     Date to report on
    --include TYPES             Comma-separated types or "all"
                                Types: response,bash,edit,thinking,read,glob,user
                                Default: response,bash,edit,thinking
    --format FORMAT             Output format: markdown (default) or json
    --detail-limit N            Max chars per activity detail (default: 120, 0 = unlimited)
    --with-git                  Append today's git commits from cwd to report

  summary [--date DATE] [--prompt TEXT] [--force]
                                Generate LLM summary of daily activity via claude CLI
    --date YYYY-MM-DD|today     Date to summarize (default: today)
    --prompt TEXT               Override prompt for this run
    --force                     Regenerate even if cached (past dates)
```

Add this block inside `parseArgs`, after the `report` block (before the "Unknown subcommand" check):

```typescript
  if (args[0] === "summary") {
    const rest = args.slice(1);
    let summaryDate = todayLocalMidnight();
    let summaryPrompt: string | undefined;
    let summaryForce = false;
    let summaryError: string | undefined;

    // Check for unknown flags
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (!arg.startsWith("-")) continue;
      if (!KNOWN_SUMMARY_FLAGS.has(arg)) {
        summaryError = `Unknown option: "${arg}". Run agenthud --help for usage.`;
        break;
      }
      // skip the value of flags that take one
      if (arg === "--date" || arg === "--prompt") i++;
    }

    const dateIdx = rest.indexOf("--date");
    if (dateIdx !== -1) {
      const dateStr = rest[dateIdx + 1];
      if (!dateStr) {
        summaryError = "Invalid date: missing value for --date";
      } else {
        const parsed = parseLocalMidnight(dateStr);
        if (!parsed) {
          summaryError = `Invalid date: "${dateStr}". Use YYYY-MM-DD or "today".`;
        } else {
          summaryDate = parsed;
        }
      }
    }

    const promptIdx = rest.indexOf("--prompt");
    if (promptIdx !== -1) {
      const val = rest[promptIdx + 1];
      if (!val) {
        summaryError = "Invalid --prompt: missing value";
      } else {
        summaryPrompt = val;
      }
    }

    if (rest.includes("--force")) summaryForce = true;

    return {
      mode: "summary",
      summaryDate,
      summaryPrompt,
      summaryForce,
      summaryError,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/cli.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "feat: add summary subcommand CLI parsing"
```

---

## Task 4: Wire summary mode in `main.ts`

**Files:**
- Modify: `src/main.ts`

No new automated tests for `main.ts` (thin orchestration). Smoke tests via build + manual invocation.

- [ ] **Step 1: Add summary branch to `src/main.ts`**

Add this import alongside the existing imports:

```typescript
import { runSummary } from "./data/summaryRunner.js";
```

Add this block **before** the `report` mode branch (or before `watch`, anywhere after the help/version/legacy-config handling):

```typescript
if (options.mode === "summary") {
  if (options.summaryError) {
    process.stderr.write(`agenthud: ${options.summaryError}\n`);
    process.exit(1);
  }
  const exitCode = await runSummary({
    date: options.summaryDate!,
    prompt: options.summaryPrompt,
    force: options.summaryForce ?? false,
    today: new Date(),
  });
  process.exit(exitCode);
}
```

Note: `main.ts` already uses top-level `await` (for the legacy config prompt), so awaiting `runSummary` here is fine.

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Smoke test manually (without claude installed)**

```bash
npm run build
PATH=/usr/bin:/bin node dist/index.js summary 2>&1 | head -5
```

Expected: `Error: claude CLI not found. Install: npm i -g @anthropic-ai/claude-code` on stderr, exit 1.

```bash
node dist/index.js summary --date bad 2>&1
```

Expected: `agenthud: Invalid date: "bad". Use YYYY-MM-DD or "today".`, exit 1.

```bash
node dist/index.js summary --bogus 2>&1
```

Expected: `agenthud: Unknown option: "--bogus". Run agenthud --help for usage.`, exit 1.

- [ ] **Step 4: Smoke test with real claude (if installed)**

```bash
node dist/index.js summary --date today
```

Expected: streams summary from claude to stdout, writes `~/.agenthud/summaries/YYYY-MM-DD.md`, exit 0. Verify the file was created.

```bash
node dist/index.js summary --date <some past date>
```

Expected: second run for the same past date returns instantly (cache hit). `--force` flag regenerates.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire summary mode in main.ts"
```

---

## Task 5: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Summary section to README**

In `README.md`, find the existing `## Report` section. Immediately after it (before `## Configuration`), insert:

```markdown
## Summary

Generate an LLM-based summary of a day's activity using the `claude` CLI:

```bash
agenthud summary                          # today
agenthud summary --date 2026-05-14        # past date (cached on second run)
agenthud summary --date 2026-05-14 --force # ignore cache
agenthud summary --prompt "커밋만 요약해"  # override prompt
```

Results are saved to `~/.agenthud/summaries/YYYY-MM-DD.md`. Past dates are cached and returned instantly on re-run. Today's date is always regenerated since activity is still growing.

**Prompt customization:** The summary uses `~/.agenthud/summary-prompt.md`, which is auto-created from a built-in template on first run. Edit it freely or override per-call with `--prompt`.

**Requires:** [`@anthropic-ai/claude-code`](https://www.npmjs.com/package/@anthropic-ai/claude-code) installed and authenticated (`npm i -g @anthropic-ai/claude-code`).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add summary command to README"
```
