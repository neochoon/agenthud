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

function userPromptPath(): string {
  return join(homedir(), ".agenthud", "summary-prompt.md");
}

function templatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // In the built bundle (dist/main-*.js) import.meta.url points to dist/.
  // The templates directory is copied to dist/templates/ by tsup, so we
  // just need join(here, 'templates', ...) — no '..' needed.
  return join(here, "templates", "summary-prompt.md");
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

  const dateLabel = dateKey(options.date);

  if (!isToday && !options.force && existsSync(cached)) {
    try {
      const content = readFileSync(cached, "utf-8");
      process.stderr.write(`agenthud: cached summary from ${cached}\n`);
      process.stdout.write(content);
      if (!content.endsWith("\n")) process.stdout.write("\n");
      return 0;
    } catch {
      // fall through to regenerate
    }
  }

  process.stderr.write(`agenthud: scanning sessions for ${dateLabel}...\n`);

  const config = loadGlobalConfig();
  const tree = discoverSessions(config);
  const flatSessions = [
    ...tree.projects.flatMap((p) => p.sessions),
    ...tree.coldProjects.flatMap((p) => p.sessions),
  ];
  const reportMarkdown = generateReport(flatSessions, {
    date: options.date,
    include: ["response", "bash", "edit", "thinking"],
    format: "markdown",
    detailLimit: 0,
    withGit: true,
  });

  const reportLines = reportMarkdown.split("\n");
  const sessionCount = reportLines.filter((l) => l.startsWith("## ")).length;
  const activityCount = reportLines.filter((l) =>
    /^\[\d{2}:\d{2}\]/.test(l),
  ).length;
  const commitCount = reportLines.filter((l) =>
    /^\[\d{2}:\d{2}\] ◆/.test(l),
  ).length;
  const sizeKb = (Buffer.byteLength(reportMarkdown, "utf-8") / 1024).toFixed(1);
  process.stderr.write(
    `agenthud: input: ${sessionCount} sessions, ${activityCount} activities, ${commitCount} commits (${reportLines.length} lines, ${sizeKb}KB)\n`,
  );
  process.stderr.write(
    `agenthud: sending to claude (this may take a minute)...\n\n`,
  );

  const prompt = resolvePrompt(options.prompt);

  return new Promise<number>((resolve) => {
    const proc = spawn(
      "claude",
      ["-p", "--output-format", "stream-json", "--verbose", prompt],
      {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: agenthudHomeDir(),
      },
    );

    let cacheStream: ReturnType<typeof createWriteStream> | null = null;
    cacheStream = createWriteStream(cached, { encoding: "utf-8" });
    cacheStream.on("error", (err: Error) => {
      process.stderr.write(
        `agenthud: warning: cannot write cache (${err.message})\n`,
      );
      cacheStream = null;
    });

    let stderrBuf = "";
    let stdoutErrBuf = ""; // for auth-error detection only
    let lineBuf = "";
    let usageSummary: string | null = null;

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

    const writeText = (text: string) => {
      process.stdout.write(text);
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
        const usage = event.usage as
          | {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            }
          | undefined;
        const cost = event.total_cost_usd as number | undefined;
        if (usage) {
          const fmt = (n?: number) =>
            n != null ? n.toLocaleString("en-US") : "0";
          const parts = [
            `${fmt(usage.input_tokens)} in / ${fmt(usage.output_tokens)} out`,
          ];
          const cacheRead = usage.cache_read_input_tokens ?? 0;
          if (cacheRead > 0) parts.push(`cache: ${fmt(cacheRead)} read`);
          if (cost != null) parts.push(`$${cost.toFixed(4)}`);
          usageSummary = parts.join("  ·  ");
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
            // Non-JSON line (e.g. early error). Capture for diagnostics.
            if (stdoutErrBuf.length < 1024)
              stdoutErrBuf += `${line}\n`;
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
      // Flush trailing line, if any
      if (lineBuf.trim().length > 0) {
        try {
          handleEvent(JSON.parse(lineBuf.trim()));
        } catch {
          if (stdoutErrBuf.length < 1024) stdoutErrBuf += lineBuf;
        }
        lineBuf = "";
      }
      // Ensure trailing newline on output for terminal cleanliness
      writeText("\n");
      cacheStream?.end();

      if (code !== 0) {
        try {
          unlinkSync(cached);
        } catch {
          // ignore — file may not exist
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
      } else {
        process.stderr.write("\n");
        if (cacheStream !== null) {
          process.stderr.write(`agenthud: saved to ${cached}\n`);
        }
        if (usageSummary) {
          process.stderr.write(`agenthud: ${usageSummary}\n`);
        }
      }
      resolve(code ?? 1);
    });

    proc.stdin.end(reportMarkdown);
  });
}
