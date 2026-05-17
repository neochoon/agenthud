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

  return new Promise<number>((resolve) => {
    const proc = spawn("claude", ["-p", prompt], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: agenthudHomeDir(),
    });

    let cacheStream: ReturnType<typeof createWriteStream> | null = null;
    cacheStream = createWriteStream(cached, { encoding: "utf-8" });
    cacheStream.on("error", (err: Error) => {
      process.stderr.write(
        `agenthud: warning: cannot write cache (${err.message})\n`,
      );
      cacheStream = null;
    });

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

    proc.on("close", (code) => {
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
