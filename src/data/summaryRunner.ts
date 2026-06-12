/**
 * Daily and range summary orchestrators. Activity report → the
 * resolved summary engine (claude / codex / kiro, see
 * summaryEngines.ts) → cache write → index regeneration.
 *
 * Design decisions:
 * - Daily and range share state intentionally — `runRangeSummary`
 *   calls `runSummary` per day to reuse the cache-write path.
 *   One code path means cache lookups, prompt resolution, ticker
 *   handling, and index regen all happen the same way regardless
 *   of how the user invoked summary.
 * - Past-day caches are immutable; today is always regenerated.
 *   Today's activity grows during the day, so any cached output
 *   that includes today is stale the moment the day continues.
 *   Same logic for range caches that contain today.
 * - Meta-input format for range summaries is XML-tag delimited
 *   (`<day date="YYYY-MM-DD">…</day>`, see `buildRangeMetaInput`).
 *   The date rides as a structured attribute (no LLM conflation
 *   with date headings inside a daily) and tag boundaries can't
 *   be forged by content (avoids `---` collision with markdown
 *   horizontal rules / yaml frontmatter inside summaries). Lands
 *   in v0.13.0; older user-customized
 *   `~/.agenthud/summary-range-prompt.md` files keep their old
 *   format until manually synced.
 * - The stderr ticker (`startStderrTicker`) is unconditionally
 *   started during the claude call; the `onFirstChunk` callback
 *   stops it the moment output begins streaming. Required for
 *   `-o` (silent stdout) mode — otherwise the call looks frozen.
 *
 * Gotchas:
 * - `claude -p` is invoked with `--no-session-persistence`.
 *   Without it, every summary call creates a JSONL session under
 *   `~/.claude/projects/` and pollutes agenthud's own session
 *   tree (v0.9.3 fix).
 * - The empty-day check counts 3 string-parsed metrics from the
 *   built report markdown (`sessionCount` / `activityCount` /
 *   `commitCount`). Fragile — deriving from `flatSessions`
 *   upstream would be cleaner, but the count needs to reflect
 *   what the LLM will actually see, which means parsing the
 *   final markdown.
 * - User home-dir prompt files (`~/.agenthud/summary-prompt.md`,
 *   `~/.agenthud/summary-range-prompt.md`) are auto-created from
 *   the bundled template on first run. Subsequent template
 *   updates are NOT propagated — users who customized are left
 *   alone. CHANGELOG documents the manual sync path.
 */

import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { loadGlobalConfig } from "../config/globalConfig.js";
import type { UsageSummary } from "../types/index.js";
import { agenthudHome } from "../utils/agenthudHome.js";
import { openInDefaultApp } from "../utils/openInDefaultApp.js";
import { startStderrTicker } from "../utils/stderrTicker.js";
import { generateReport } from "./reportGenerator.js";
import { discoverSessions } from "./sessions.js";
import { regenerateIndex } from "./summariesIndex.js";
import type { SummaryEngine } from "./summaryEngines.js";
import { resolveSummaryEngine } from "./summaryEngines.js";

export interface SummaryOptions {
  date: Date;
  force: boolean;
  prompt?: string;
  today: Date;
  /** Resolved summary engine name / "auto", from `--engine` or
   * `summary.engine` config. Resolved to a concrete engine here. */
  engine?: string;
  engineFlag?: string;
  /** Forwarded to the engine's model flag (e.g. "sonnet", "gpt-5"). */
  model?: string;
  /** Activity types fed into the LLM payload (resolved by CLI + config). */
  include: string[];
  /** Max chars per activity detail (0 = unlimited). */
  detailLimit: number;
  /** Whether to merge git commits into the LLM payload. */
  withGit: boolean;
  /** Launch the resulting summary in the OS default app after writing. */
  open?: boolean;
  /** Launch ~/.agenthud/summaries/index.md in the OS default app. */
  openIndex?: boolean;
}

export interface RangeSummaryOptions {
  from: Date;
  to: Date;
  today: Date;
  force: boolean;
  assumeYes: boolean;
  engine?: string;
  engineFlag?: string;
  model?: string;
  /** Activity types fed into the per-day LLM payload. */
  include: string[];
  /** Max chars per activity detail in the per-day payload (0 = unlimited). */
  detailLimit: number;
  /** Whether to merge git commits into the per-day payload. */
  withGit: boolean;
  /** Launch the resulting range summary in the OS default app after writing. */
  open?: boolean;
  /** Launch ~/.agenthud/summaries/index.md in the OS default app. */
  openIndex?: boolean;
}

type PromptKind = "daily" | "range";

function agenthudHomeDir(): string {
  const dir = agenthudHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function summariesDir(): string {
  const dir = join(agenthudHomeDir(), "summaries");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function promptFilename(kind: PromptKind): string {
  return kind === "daily" ? "summary-prompt.md" : "summary-range-prompt.md";
}

function userPromptPath(kind: PromptKind): string {
  return join(agenthudHome(), promptFilename(kind));
}

/**
 * Compact, user-facing label for the prompt this summary run is using.
 * - daily/range with no inline override → the user prompt file path,
 *   abbreviated to `~/...` so the line stays readable.
 * - daily with `--prompt TEXT` → "<inline> (from --prompt)".
 *   (Range mode does not accept --prompt, so override is ignored when
 *   kind is "range".)
 */
export function formatPromptSource(
  kind: "daily" | "range",
  override?: string,
): string {
  if (kind === "daily" && override) {
    return "<inline> (from --prompt)";
  }
  const home = homedir();
  const path = userPromptPath(kind);
  const abbreviated = path.startsWith(home)
    ? `~${path.slice(home.length)}`
    : path;
  // Normalize to forward slashes for the user-facing label — POSIX
  // form reads cleanly on every platform, including Windows where
  // `join()` would otherwise produce `~\.agenthud\summary-prompt.md`.
  return abbreviated.replace(/\\/g, "/");
}

function templatePath(kind: PromptKind): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "templates", promptFilename(kind));
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dailyCachePath(date: Date): string {
  return join(summariesDir(), `${dateKey(date)}.md`);
}

function rangeCachePath(from: Date, to: Date): string {
  return join(summariesDir(), `range-${dateKey(from)}_${dateKey(to)}.md`);
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function ensureUserPromptFile(kind: PromptKind): void {
  const p = userPromptPath(kind);
  if (existsSync(p)) return;
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    copyFileSync(templatePath(kind), p);
  } catch {
    // Template missing in dev — fall back silently; resolvePrompt() handles it.
  }
}

function resolvePrompt(kind: PromptKind, override?: string): string {
  if (override) return override;
  const p = userPromptPath(kind);
  if (existsSync(p)) {
    try {
      return readFileSync(p, "utf-8");
    } catch {
      // fall through to template
    }
  }
  try {
    return readFileSync(templatePath(kind), "utf-8");
  } catch {
    return "Summarize the input below.";
  }
}

/**
 * Build the LLM input for a range summary by wrapping each daily
 * summary in a `<day date="YYYY-MM-DD">…</day>` tag and joining with
 * blank lines.
 *
 * The tag form (over the previous `# YYYY-MM-DD` heading + `---`
 * separator) buys two things:
 *
 *   1. The date is an XML attribute, not free text the model has to
 *      tokenize out of a header line — eliminates conflation with
 *      date headings *inside* a daily summary (e.g. a section that
 *      quotes a past date).
 *   2. No separator collision. The old `---` delimiter clashed with
 *      markdown horizontal rules and yaml frontmatter that a daily
 *      summary might legitimately contain; tag boundaries can't be
 *      faked by content.
 *
 * Anthropic's prompting guidance recommends XML-style tags for
 * delimited inputs, which this format matches.
 */
export function buildRangeMetaInput(
  dailyMarkdowns: { date: Date; markdown: string }[],
): string {
  if (dailyMarkdowns.length === 0) return "";
  return dailyMarkdowns
    .map(
      ({ date, markdown }) =>
        `<day date="${dateKey(date)}">\n\n${markdown}\n\n</day>`,
    )
    .join("\n\n");
}

/**
 * Range cache is only valid when today is NOT in the range. Today's activity
 * grows throughout the day, so any cached range that includes today is stale
 * the moment the day continues.
 */
export function shouldUseRangeCache(
  force: boolean,
  dates: Date[],
  today: Date,
  cacheExists: boolean,
): boolean {
  if (force) return false;
  if (!cacheExists) return false;
  if (dates.some((d) => isSameLocalDay(d, today))) return false;
  return true;
}

function enumerateDates(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

async function ask(
  question: string,
  defaultYes: boolean = false,
): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (trimmed.length === 0) return resolve(defaultYes);
      if (/^y(es)?$/i.test(trimmed)) return resolve(true);
      if (/^n(o)?$/i.test(trimmed)) return resolve(false);
      resolve(defaultYes);
    });
  });
}

function formatUsage(u: UsageSummary): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const parts = [`${fmt(u.inputTokens)} in / ${fmt(u.outputTokens)} out`];
  const cacheParts: string[] = [];
  if (u.cacheReadTokens > 0) cacheParts.push(`${fmt(u.cacheReadTokens)} read`);
  if (u.cacheCreationTokens > 0)
    cacheParts.push(`${fmt(u.cacheCreationTokens)} written`);
  if (cacheParts.length > 0) parts.push(`cache: ${cacheParts.join(", ")}`);
  if (u.costUsd != null) parts.push(`$${u.costUsd.toFixed(4)}`);
  return parts.join("  ·  ");
}

interface SpawnEngineOpts {
  engine: SummaryEngine;
  prompt: string;
  stdin: string;
  cachePath?: string;
  streamToStdout: boolean;
  /** Forwarded to the engine's model flag if set. */
  model?: string;
  /**
   * Fires once, when the first chunk of summary text arrives. The
   * caller uses this to stop the "sending to <engine>" stderr ticker
   * so it doesn't fight the streaming output for the same row.
   */
  onFirstChunk?: () => void;
}

interface SpawnEngineResult {
  code: number;
  text: string;
  usage: UsageSummary | null;
}

/**
 * Spawn the resolved summary engine, feed it the report on stdin,
 * collect the summary text (streamed from stdout, or read from the
 * engine's output file for "file"-mode engines like Codex), and
 * atomically write it to the cache. Engine-agnostic: all
 * command/arg/parse specifics come from `opts.engine`.
 */
function spawnEngine(opts: SpawnEngineOpts): Promise<SpawnEngineResult> {
  return new Promise((resolve) => {
    const engine = opts.engine;
    // For "file"-mode engines the final answer lands in a temp file
    // we then read; for "stream"-mode it's parsed from stdout.
    const outFile =
      engine.outputMode === "file" && opts.cachePath
        ? `${opts.cachePath}.engine-out`
        : undefined;
    const args = engine.buildArgs({
      prompt: opts.prompt,
      model: opts.model,
      outFile,
    });
    const proc = spawn(engine.command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: agenthudHomeDir(),
    });

    const parser = engine.makeParser();
    let stderrBuf = "";
    let assembledText = "";
    let firstChunkFired = false;

    const emit = (text: string) => {
      if (!firstChunkFired) {
        firstChunkFired = true;
        opts.onFirstChunk?.();
      }
      assembledText += text;
      if (opts.streamToStdout) process.stdout.write(text);
    };

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        process.stderr.write(
          `Error: ${engine.command} not found. Install: ${engine.installHint}\n`,
        );
        resolve({ code: 1, text: "", usage: null });
      } else {
        process.stderr.write(`Error: ${err.message}\n`);
        resolve({ code: 1, text: "", usage: null });
      }
    });

    proc.stdout.on("data", (chunk: Buffer) => {
      parser.feed(chunk.toString(), emit);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      process.stderr.write(chunk);
    });

    proc.on("close", (code) => {
      parser.flush?.(emit);

      // "file"-mode engines (Codex) wrote the answer to a temp file.
      if (engine.outputMode === "file" && outFile && code === 0) {
        try {
          assembledText = readFileSync(outFile, "utf-8");
          if (opts.streamToStdout) process.stdout.write(assembledText);
        } catch {
          // leave assembledText empty; treated as a failed run below
        }
        try {
          unlinkSync(outFile);
        } catch {
          // ignore
        }
      } else if (outFile) {
        try {
          unlinkSync(outFile);
        } catch {
          // ignore
        }
      }

      if (opts.streamToStdout) process.stdout.write("\n");

      if (code !== 0) {
        const combined = stderrBuf.toLowerCase();
        if (
          combined.includes("not logged in") ||
          combined.includes("not authenticated") ||
          combined.includes("please run /login") ||
          combined.includes(" auth")
        ) {
          process.stderr.write(
            `\nHint: ${engine.command} appears to be unauthenticated. Re-run its login.\n`,
          );
        }
      }

      // Atomically write the assembled summary to the cache: temp
      // file + rename on success, so a crash mid-generation never
      // leaves a partial file that later reads as a complete summary.
      const noText = assembledText.trim().length === 0;
      const failed = code !== 0 || noText;
      if (opts.cachePath && !failed) {
        const tmp = `${opts.cachePath}.tmp`;
        try {
          writeFileSync(tmp, assembledText, "utf-8");
          renameSync(tmp, opts.cachePath);
        } catch (err) {
          process.stderr.write(
            `agenthud: warning: cannot write cache (${(err as Error).message})\n`,
          );
        }
      }
      resolve({
        code: failed ? (code ?? 1) || 1 : 0,
        text: assembledText,
        usage: parser.usage(),
      });
    });

    proc.stdin.end(opts.stdin);
  });
}

interface DailyGenOpts {
  date: Date;
  today: Date;
  force: boolean;
  promptOverride?: string;
  streamToStdout: boolean;
  announce: boolean; // emit scan/sending/saved/tokens stderr messages
  confirmBeforeSpawn?: () => Promise<boolean>;
  /** When true, skip the interactive size-warning confirmation. */
  assumeYes?: boolean;
  /** The resolved summary engine (claude / codex / kiro). */
  engine: SummaryEngine;
  /** Forwarded to the engine's model flag. */
  model?: string;
  /** Activity types fed into the LLM payload. */
  include: string[];
  /** Max chars per activity detail (0 = unlimited). */
  detailLimit: number;
  /** Whether to merge git commits into the LLM payload. */
  withGit: boolean;
}

/**
 * Pre-flight size warning. Reports larger than this estimate (in tokens,
 * computed as bytes/4) trigger a stderr warning and — if interactive —
 * an extra confirmation. The threshold is conservative: the 1M-token
 * Opus/Sonnet contexts could swallow more, but 300K input tokens is
 * already ~$1.50 on Opus and worth flagging.
 */
const REPORT_TOKEN_WARN_THRESHOLD = 300_000;

interface DailyGenResult {
  code: number;
  markdown: string;
  fromCache: boolean;
  skipped: boolean;
  usage: UsageSummary | null;
}

async function generateDailySummary(
  opts: DailyGenOpts,
): Promise<DailyGenResult> {
  const isToday = isSameLocalDay(opts.date, opts.today);
  const cached = dailyCachePath(opts.date);
  const dateLabel = dateKey(opts.date);

  if (!isToday && !opts.force && existsSync(cached)) {
    try {
      const content = readFileSync(cached, "utf-8");
      if (opts.announce) {
        process.stderr.write(`cached summary from ${cached}\n`);
      }
      if (opts.streamToStdout) {
        process.stdout.write(content);
        if (!content.endsWith("\n")) process.stdout.write("\n");
      }
      return {
        code: 0,
        markdown: content,
        fromCache: true,
        skipped: false,
        usage: null,
      };
    } catch {
      // fall through to regenerate
    }
  }

  if (opts.announce) {
    process.stderr.write(`scanning sessions for ${dateLabel}...\n`);
  }

  // Materialize the user-editable prompt template only on the
  // generate path — a cache hit (early-returned above) is read-only
  // and shouldn't write files into the user's home directory.
  ensureUserPromptFile("daily");

  const config = loadGlobalConfig();
  const tree = discoverSessions(config);
  const flatSessions = [
    ...tree.projects.flatMap((p) => p.sessions),
    ...tree.coldProjects.flatMap((p) => p.sessions),
  ];
  const reportMarkdown = generateReport(flatSessions, {
    date: opts.date,
    include: opts.include,
    // The LLM only ingests markdown — the format option on summary is
    // for the report-extraction *export* surface (post-LLM), not for
    // the payload itself, so this stays fixed.
    format: "markdown",
    detailLimit: opts.detailLimit,
    withGit: opts.withGit,
  });

  const reportBytes = Buffer.byteLength(reportMarkdown, "utf-8");
  const estimatedTokens = Math.ceil(reportBytes / 4);

  const reportLines = reportMarkdown.split("\n");
  const sessionCount = reportLines.filter((l) => l.startsWith("## ")).length;
  const activityCount = reportLines.filter((l) =>
    /^\[\d{2}:\d{2}\]/.test(l),
  ).length;
  const commitCount = reportLines.filter((l) =>
    /^\[\d{2}:\d{2}\] ◆/.test(l),
  ).length;

  if (opts.announce) {
    const sizeKb = (reportBytes / 1024).toFixed(1);
    process.stderr.write(
      `input: ${sessionCount} sessions, ${activityCount} activities, ${commitCount} commits (${reportLines.length} lines, ${sizeKb}KB ≈ ${estimatedTokens.toLocaleString()} tokens)\n`,
    );
  }

  // Skip the LLM call entirely when there's nothing to summarize.
  // Mirrors the range path's "<label> has no activity — skipping"
  // behavior: announce, return as skipped, and don't touch disk —
  // creating an empty stub file just clutters the user's summaries
  // dir, and `--open` / index regeneration both already check
  // `!res.skipped` so they'll no-op for us automatically.
  if (sessionCount === 0 && activityCount === 0 && commitCount === 0) {
    if (opts.announce) {
      process.stderr.write(
        `${dateLabel} has no activity — skipping (no file written)\n`,
      );
    }
    return {
      code: 0,
      markdown: "",
      fromCache: false,
      skipped: true,
      usage: null,
    };
  }

  if (opts.confirmBeforeSpawn) {
    const proceed = await opts.confirmBeforeSpawn();
    if (!proceed) {
      return {
        code: 0,
        markdown: "",
        fromCache: false,
        skipped: true,
        usage: null,
      };
    }
  }

  // Oversize guard. Print a loud warning and, in interactive mode, give
  // the user one more chance to abort before sending an expensive request.
  if (estimatedTokens > REPORT_TOKEN_WARN_THRESHOLD) {
    const sizeMb = (reportBytes / (1024 * 1024)).toFixed(1);
    process.stderr.write(
      `agenthud: ⚠ report is large (~${estimatedTokens.toLocaleString()} tokens, ${sizeMb}MB). Cost will be high; very long reports may exceed context.\n`,
    );
    if (!opts.assumeYes) {
      const proceed = await ask("Send anyway? [Y/n] ", true);
      if (!proceed) {
        process.stderr.write(
          `agenthud: ${dateLabel} — aborted (report too large).\n`,
        );
        return {
          code: 0,
          markdown: "",
          fromCache: false,
          skipped: true,
          usage: null,
        };
      }
    }
  }

  // Live "still waiting on <engine>" ticker on stderr — gives the
  // user a visible heartbeat through the (typically 30–60s) latency
  // before the engine starts producing output. The ticker auto-stops
  // on the first chunk (see onFirstChunk) so it doesn't fight the
  // streaming output for the same terminal row.
  const stopTicker = opts.announce
    ? startStderrTicker(`sending to ${opts.engine.name}`)
    : null;

  const prompt = resolvePrompt("daily", opts.promptOverride);
  const result = await spawnEngine({
    engine: opts.engine,
    prompt,
    stdin: reportMarkdown,
    cachePath: cached,
    streamToStdout: opts.streamToStdout,
    model: opts.model,
    onFirstChunk: () => {
      if (stopTicker) stopTicker();
    },
  });
  // Defensive in case the spawn never produced a chunk (error path).
  if (stopTicker) stopTicker();

  if (opts.announce && result.code === 0) {
    process.stderr.write("\n");
    process.stderr.write(`saved to ${cached}\n`);
    if (result.usage) {
      process.stderr.write(`${formatUsage(result.usage)}\n`);
    }
  }

  return {
    code: result.code,
    markdown: result.text,
    fromCache: false,
    skipped: false,
    usage: result.usage,
  };
}

export async function runSummary(options: SummaryOptions): Promise<number> {
  let engine: SummaryEngine;
  try {
    engine = resolveSummaryEngine({
      engine: options.engine,
      flag: options.engineFlag,
    });
  } catch (err) {
    process.stderr.write(`agenthud: ${(err as Error).message}\n`);
    return 1;
  }
  // With --open the user is going to read the rendered file in their
  // default app anyway, so streaming the same markdown to the terminal
  // is duplicate noise (and breaks downstream piping). Suppress.
  const res = await generateDailySummary({
    date: options.date,
    today: options.today,
    force: options.force,
    promptOverride: options.prompt,
    streamToStdout: !options.open,
    announce: true,
    engine,
    model: options.model,
    include: options.include,
    detailLimit: options.detailLimit,
    withGit: options.withGit,
  });
  // Regenerate the index when something *changed* on disk (a new
  // daily got written), OR when the user explicitly asked for the
  // navigation hub via `--open-index` (so we guarantee `index.md`
  // exists before openInDefaultApp tries to launch it).
  const indexRefreshNeeded =
    res.code === 0 && (!res.skipped || options.openIndex === true);
  if (indexRefreshNeeded) {
    try {
      regenerateIndex(summariesDir());
    } catch {
      /* best-effort — index regen never blocks the summary path */
    }
  }
  // `--open` is about *today's result* — nothing to open when we
  // skipped because the day was empty.
  if (options.open && res.code === 0 && !res.skipped) {
    await openInDefaultApp(dailyCachePath(options.date));
  }
  // `--open-index` is about *navigating the corpus* — fire it even
  // on empty/skipped days. The user may be running summary purely as
  // a shortcut to "show me my summary hub".
  if (options.openIndex && res.code === 0) {
    await openInDefaultApp(join(summariesDir(), "index.md"));
  }
  return res.code;
}

export async function runRangeSummary(
  options: RangeSummaryOptions,
): Promise<number> {
  let engine: SummaryEngine;
  try {
    engine = resolveSummaryEngine({
      engine: options.engine,
      flag: options.engineFlag,
    });
  } catch (err) {
    process.stderr.write(`agenthud: ${(err as Error).message}\n`);
    return 1;
  }
  const dates = enumerateDates(options.from, options.to);
  const fromLabel = dateKey(options.from);
  const toLabel = dateKey(options.to);
  const rangeCache = rangeCachePath(options.from, options.to);

  if (
    shouldUseRangeCache(
      options.force,
      dates,
      options.today,
      existsSync(rangeCache),
    )
  ) {
    try {
      const content = readFileSync(rangeCache, "utf-8");
      process.stderr.write(`cached range summary from ${rangeCache}\n`);
      if (!options.open) {
        process.stdout.write(content);
        if (!content.endsWith("\n")) process.stdout.write("\n");
      }
      try {
        regenerateIndex(summariesDir());
      } catch {
        /* best-effort */
      }
      if (options.open) await openInDefaultApp(rangeCache);
      if (options.openIndex) {
        await openInDefaultApp(join(summariesDir(), "index.md"));
      }
      return 0;
    } catch {
      // fall through to regenerate
    }
  }

  // Generate path from here on — safe to materialize the
  // user-editable prompt templates now (the range-cache hit above
  // returns without writing anything to the home directory).
  ensureUserPromptFile("daily");
  ensureUserPromptFile("range");

  // Classify cached vs missing for the pre-run report (today is never
  // cached; --force treats everything as missing).
  let cachedCount = 0;
  let missingCount = 0;
  for (const d of dates) {
    const isToday = isSameLocalDay(d, options.today);
    if (!options.force && !isToday && existsSync(dailyCachePath(d)))
      cachedCount++;
    else missingCount++;
  }

  process.stderr.write(
    `range ${fromLabel} → ${toLabel} (${dates.length} days)\n`,
  );
  process.stderr.write(`${cachedCount} cached, ${missingCount} to generate\n`);

  // Generate dailies sequentially. Confirm just-in-time after scan (when --yes is off).
  // Each prompt comes with concrete context (session/activity/commit counts).
  const dailyMarkdowns: { date: Date; markdown: string }[] = [];
  for (const d of dates) {
    const label = dateKey(d);
    const isToday = isSameLocalDay(d, options.today);
    process.stderr.write(`\n--- ${label} ---\n`);

    const willPrompt =
      !options.assumeYes &&
      (isToday || options.force || !existsSync(dailyCachePath(d)));
    const confirmer = willPrompt
      ? async () => {
          const hint = isToday ? " (today — regenerated every time)" : "";
          return ask(`Generate this summary${hint}? [Y/n] `, true);
        }
      : undefined;

    const res = await generateDailySummary({
      date: d,
      today: options.today,
      // --force regenerates the dailies too, not just the range
      // synthesis — otherwise `summary --last 7d --force` would
      // rebuild the range from stale daily markdown.
      force: options.force,
      streamToStdout: false,
      announce: true,
      confirmBeforeSpawn: confirmer,
      assumeYes: options.assumeYes,
      engine,
      model: options.model,
      include: options.include,
      detailLimit: options.detailLimit,
      withGit: options.withGit,
    });

    if (res.skipped) {
      // `skipped` covers both "user declined the confirm prompt" AND
      // "the day was empty so we never asked claude". The two look
      // identical at the result-shape level; one neutral message
      // works for both.
      process.stderr.write(`agenthud: ${label} — skipped.\n`);
      continue;
    }
    if (res.code !== 0) {
      process.stderr.write(
        `agenthud: aborted (failed to generate daily summary for ${label}).\n`,
      );
      return res.code;
    }
    const text = res.markdown.trim();
    if (text.length === 0 || /^no activity found/i.test(text)) {
      process.stderr.write(`${label} has no activity — skipping.\n`);
      continue;
    }
    dailyMarkdowns.push({ date: d, markdown: text });
  }

  if (dailyMarkdowns.length === 0) {
    // No activity in the whole range — nothing to send to claude.
    // Treat this as a normal state (exit 0), matching `report` and
    // single-day summary behavior on empty input. Honor `-I` so
    // users running `summary --last 7d -I` as a "navigate to my hub"
    // shortcut still get the index.
    process.stderr.write(
      "no daily activity in this range — nothing to combine\n",
    );
    if (options.openIndex) {
      try {
        regenerateIndex(summariesDir());
      } catch {
        /* best-effort */
      }
      await openInDefaultApp(join(summariesDir(), "index.md"));
    }
    return 0;
  }

  const metaInput = buildRangeMetaInput(dailyMarkdowns);

  process.stderr.write(
    `\ncombining ${dailyMarkdowns.length} daily summaries into range summary...\n`,
  );
  const metaStreams = !options.open;
  // Same approach as the daily call: ticker always-on, auto-stops on
  // first chunk so it doesn't fight streamed output for the same row.
  const stopMetaTicker = startStderrTicker(`sending to ${engine.name}`);

  const metaPrompt = resolvePrompt("range");
  const metaResult = await spawnEngine({
    engine,
    prompt: metaPrompt,
    stdin: metaInput,
    cachePath: rangeCache,
    streamToStdout: metaStreams,
    model: options.model,
    onFirstChunk: () => stopMetaTicker(),
  });
  stopMetaTicker();

  if (metaResult.code !== 0) {
    return metaResult.code;
  }

  process.stderr.write("\n");
  process.stderr.write(`saved to ${rangeCache}\n`);
  if (metaResult.usage) {
    process.stderr.write(`${formatUsage(metaResult.usage)}\n`);
  }

  try {
    regenerateIndex(summariesDir());
  } catch {
    /* best-effort */
  }
  if (options.open) await openInDefaultApp(rangeCache);
  if (options.openIndex) {
    await openInDefaultApp(join(summariesDir(), "index.md"));
  }
  return 0;
}
