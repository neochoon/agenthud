import { spawn } from "node:child_process";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { loadGlobalConfig } from "../config/globalConfig.js";
import { generateReport } from "./reportGenerator.js";
import { discoverSessions } from "./sessions.js";

export interface SummaryOptions {
  date: Date;
  force: boolean;
  prompt?: string;
  today: Date;
}

export interface RangeSummaryOptions {
  from: Date;
  to: Date;
  today: Date;
  force: boolean;
  assumeYes: boolean;
}

type PromptKind = "daily" | "range";

function agenthudHomeDir(): string {
  const dir = join(homedir(), ".agenthud");
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
  return join(homedir(), ".agenthud", promptFilename(kind));
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

interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number | null;
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

interface SpawnClaudeOpts {
  prompt: string;
  stdin: string;
  cachePath?: string;
  streamToStdout: boolean;
}

interface SpawnClaudeResult {
  code: number;
  text: string;
  usage: UsageSummary | null;
}

function spawnClaude(opts: SpawnClaudeOpts): Promise<SpawnClaudeResult> {
  return new Promise((resolve) => {
    const proc = spawn(
      "claude",
      ["-p", "--output-format", "stream-json", "--verbose", opts.prompt],
      {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: agenthudHomeDir(),
      },
    );

    let cacheStream: ReturnType<typeof createWriteStream> | null = null;
    if (opts.cachePath) {
      cacheStream = createWriteStream(opts.cachePath, { encoding: "utf-8" });
      cacheStream.on("error", (err: Error) => {
        process.stderr.write(
          `agenthud: warning: cannot write cache (${err.message})\n`,
        );
        cacheStream = null;
      });
    }

    let stderrBuf = "";
    let stdoutErrBuf = "";
    let lineBuf = "";
    let assembledText = "";
    let usage: UsageSummary | null = null;

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        process.stderr.write(
          "Error: claude CLI not found. Install: npm i -g @anthropic-ai/claude-code\n",
        );
        resolve({ code: 1, text: "", usage: null });
      } else {
        process.stderr.write(`Error: ${err.message}\n`);
        resolve({ code: 1, text: "", usage: null });
      }
    });

    const writeText = (text: string) => {
      assembledText += text;
      if (opts.streamToStdout) process.stdout.write(text);
      cacheStream?.write(text);
    };

    const handleEvent = (event: Record<string, unknown>) => {
      const type = event.type as string | undefined;
      if (type === "assistant") {
        const msg = event.message as
          | { content?: Array<{ type?: string; text?: string }> }
          | undefined;
        for (const block of msg?.content ?? []) {
          if (block.type === "text" && typeof block.text === "string") {
            writeText(block.text);
          }
        }
      } else if (type === "result") {
        const u = event.usage as
          | {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            }
          | undefined;
        const cost = event.total_cost_usd as number | undefined;
        if (u) {
          usage = {
            inputTokens: u.input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            cacheReadTokens: u.cache_read_input_tokens ?? 0,
            cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
            costUsd: cost ?? null,
          };
        }
      }
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      lineBuf += chunk.toString();
      let nl = lineBuf.indexOf("\n");
      while (nl !== -1) {
        const line = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (line.length > 0) {
          try {
            handleEvent(JSON.parse(line));
          } catch {
            if (stdoutErrBuf.length < 1024) stdoutErrBuf += `${line}\n`;
          }
        }
        nl = lineBuf.indexOf("\n");
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      process.stderr.write(chunk);
    });

    proc.on("close", (code) => {
      if (lineBuf.trim().length > 0) {
        try {
          handleEvent(JSON.parse(lineBuf.trim()));
        } catch {
          if (stdoutErrBuf.length < 1024) stdoutErrBuf += lineBuf;
        }
        lineBuf = "";
      }
      if (opts.streamToStdout) process.stdout.write("\n");
      cacheStream?.end();

      if (code !== 0) {
        if (opts.cachePath) {
          try {
            unlinkSync(opts.cachePath);
          } catch {
            // ignore
          }
        }
        const combined = (stderrBuf + stdoutErrBuf).toLowerCase();
        if (
          combined.includes("not logged in") ||
          combined.includes("not authenticated") ||
          combined.includes("please run /login") ||
          combined.includes(" auth")
        ) {
          process.stderr.write(
            "\nHint: claude appears to be unauthenticated. Run: claude /login\n",
          );
        }
      }
      resolve({ code: code ?? 1, text: assembledText, usage });
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
}

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
  ensureUserPromptFile("daily");

  const isToday = isSameLocalDay(opts.date, opts.today);
  const cached = dailyCachePath(opts.date);
  const dateLabel = dateKey(opts.date);

  if (!isToday && !opts.force && existsSync(cached)) {
    try {
      const content = readFileSync(cached, "utf-8");
      if (opts.announce) {
        process.stderr.write(`agenthud: cached summary from ${cached}\n`);
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
    process.stderr.write(`agenthud: scanning sessions for ${dateLabel}...\n`);
  }

  const config = loadGlobalConfig();
  const tree = discoverSessions(config);
  const flatSessions = [
    ...tree.projects.flatMap((p) => p.sessions),
    ...tree.coldProjects.flatMap((p) => p.sessions),
  ];
  const reportMarkdown = generateReport(flatSessions, {
    date: opts.date,
    include: ["response", "bash", "edit", "thinking"],
    format: "markdown",
    detailLimit: 0,
    withGit: true,
  });

  if (opts.announce) {
    const reportLines = reportMarkdown.split("\n");
    const sessionCount = reportLines.filter((l) => l.startsWith("## ")).length;
    const activityCount = reportLines.filter((l) =>
      /^\[\d{2}:\d{2}\]/.test(l),
    ).length;
    const commitCount = reportLines.filter((l) =>
      /^\[\d{2}:\d{2}\] ◆/.test(l),
    ).length;
    const sizeKb = (Buffer.byteLength(reportMarkdown, "utf-8") / 1024).toFixed(
      1,
    );
    process.stderr.write(
      `agenthud: input: ${sessionCount} sessions, ${activityCount} activities, ${commitCount} commits (${reportLines.length} lines, ${sizeKb}KB)\n`,
    );
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

  if (opts.announce) {
    process.stderr.write(
      `agenthud: sending to claude (this may take a minute)...\n\n`,
    );
  }

  const prompt = resolvePrompt("daily", opts.promptOverride);
  const result = await spawnClaude({
    prompt,
    stdin: reportMarkdown,
    cachePath: cached,
    streamToStdout: opts.streamToStdout,
  });

  if (opts.announce && result.code === 0) {
    process.stderr.write("\n");
    process.stderr.write(`agenthud: saved to ${cached}\n`);
    if (result.usage) {
      process.stderr.write(`agenthud: ${formatUsage(result.usage)}\n`);
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
  const res = await generateDailySummary({
    date: options.date,
    today: options.today,
    force: options.force,
    promptOverride: options.prompt,
    streamToStdout: true,
    announce: true,
  });
  return res.code;
}

export async function runRangeSummary(
  options: RangeSummaryOptions,
): Promise<number> {
  ensureUserPromptFile("daily");
  ensureUserPromptFile("range");

  const dates = enumerateDates(options.from, options.to);
  const fromLabel = dateKey(options.from);
  const toLabel = dateKey(options.to);
  const rangeCache = rangeCachePath(options.from, options.to);

  if (!options.force && existsSync(rangeCache)) {
    try {
      const content = readFileSync(rangeCache, "utf-8");
      process.stderr.write(
        `agenthud: cached range summary from ${rangeCache}\n`,
      );
      process.stdout.write(content);
      if (!content.endsWith("\n")) process.stdout.write("\n");
      return 0;
    } catch {
      // fall through to regenerate
    }
  }

  // Classify cached vs missing for the pre-run report (today is never cached).
  let cachedCount = 0;
  let missingCount = 0;
  for (const d of dates) {
    const isToday = isSameLocalDay(d, options.today);
    if (!isToday && existsSync(dailyCachePath(d))) cachedCount++;
    else missingCount++;
  }

  process.stderr.write(
    `agenthud: range ${fromLabel} → ${toLabel} (${dates.length} days)\n`,
  );
  process.stderr.write(
    `agenthud: ${cachedCount} cached, ${missingCount} to generate\n`,
  );

  // Generate dailies sequentially. Confirm just-in-time after scan (when --yes is off).
  // Each prompt comes with concrete context (session/activity/commit counts).
  const dailyMarkdowns: { date: Date; markdown: string }[] = [];
  let skippedCount = 0;
  for (const d of dates) {
    const label = dateKey(d);
    const isToday = isSameLocalDay(d, options.today);
    process.stderr.write(`\nagenthud: --- ${label} ---\n`);

    const willPrompt = !options.assumeYes && (isToday || !existsSync(dailyCachePath(d)));
    const confirmer = willPrompt
      ? async () => {
          const hint = isToday
            ? " (today — regenerated every time)"
            : "";
          return ask(`Generate this summary${hint}? [Y/n] `, true);
        }
      : undefined;

    const res = await generateDailySummary({
      date: d,
      today: options.today,
      force: false,
      streamToStdout: false,
      announce: true,
      confirmBeforeSpawn: confirmer,
    });

    if (res.skipped) {
      process.stderr.write(`agenthud: ${label} — skipped by user.\n`);
      skippedCount++;
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
      process.stderr.write(`agenthud: ${label} has no activity — skipping.\n`);
      continue;
    }
    dailyMarkdowns.push({ date: d, markdown: text });
  }

  if (dailyMarkdowns.length === 0) {
    process.stderr.write("agenthud: no daily summaries to combine.\n");
    return 1;
  }

  // Build meta input: each daily summary prefixed with its date, separated by ---.
  const metaInput = dailyMarkdowns
    .map(({ date, markdown }) => `# ${dateKey(date)}\n\n${markdown}`)
    .join("\n\n---\n\n");

  process.stderr.write(
    `\nagenthud: combining ${dailyMarkdowns.length} daily summaries into range summary...\n`,
  );
  process.stderr.write(
    `agenthud: sending to claude (this may take a minute)...\n\n`,
  );

  const metaPrompt = resolvePrompt("range");
  const metaResult = await spawnClaude({
    prompt: metaPrompt,
    stdin: metaInput,
    cachePath: rangeCache,
    streamToStdout: true,
  });

  if (metaResult.code !== 0) {
    return metaResult.code;
  }

  process.stderr.write("\n");
  process.stderr.write(`agenthud: saved to ${rangeCache}\n`);
  if (metaResult.usage) {
    process.stderr.write(`agenthud: ${formatUsage(metaResult.usage)}\n`);
  }

  return 0;
}
