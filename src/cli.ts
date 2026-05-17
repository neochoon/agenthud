import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ALL_TYPES = [
  "response",
  "bash",
  "edit",
  "thinking",
  "read",
  "glob",
  "user",
];
const DEFAULT_TYPES = ["response", "bash", "edit", "thinking"];

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
  summaryFrom?: Date;
  summaryTo?: Date;
  summaryAssumeYes?: boolean;
  summaryPrompt?: string;
  summaryForce?: boolean;
  summaryError?: string;
}

const KNOWN_WATCH_FLAGS = new Set([
  "-w",
  "--watch",
  "--once",
  "-V",
  "--version",
  "-h",
  "--help",
]);
const KNOWN_REPORT_FLAGS = new Set([
  "--date",
  "--include",
  "--format",
  "--detail-limit",
  "--with-git",
]);
const KNOWN_SUMMARY_FLAGS = new Set([
  "--date",
  "--last",
  "--from",
  "--to",
  "--prompt",
  "--force",
  "-y",
  "--yes",
]);
const KNOWN_SUBCOMMANDS = new Set(["report", "summary"]);

export function getHelp(): string {
  return `Usage: agenthud [options]

Monitors all running Claude Code sessions in real-time.

Options:
  -w, --watch                   Watch mode (default) — live updates
  --once                        Print once and exit
  -V, --version                 Show version number
  -h, --help                    Show this help message

Commands:
  report [--date DATE] [--include TYPES] [--format FORMAT] [--detail-limit N] [--with-git]
                                Print activity report for a date (default: today)
    --date YYYY-MM-DD|today|yesterday|-Nd     Date to report on
    --include TYPES             Comma-separated types or "all"
                                Types: response,bash,edit,thinking,read,glob,user
                                Default: response,bash,edit,thinking
    --format FORMAT             Output format: markdown (default) or json
    --detail-limit N            Max chars per activity detail (default: 120, 0 = unlimited)
    --with-git                  Append today's git commits from cwd to report

  summary [--date DATE | --last Nd | --from DATE --to DATE] [--prompt TEXT] [--force] [-y]
                                Generate LLM summary via claude CLI.
                                Single day produces a daily summary;
                                a date range produces a meta-summary built from daily summaries.
    --date YYYY-MM-DD|today|yesterday|-Nd     Date to summarize (default: today)
    --last Nd                   Date range: last N days, ending today (e.g. --last 7d)
    --from YYYY-MM-DD           Date range: start date (use with --to)
    --to YYYY-MM-DD             Date range: end date (use with --from)
    --prompt TEXT               Override prompt for this run (daily only)
    --force                     Regenerate even if cached
    -y, --yes                   Skip confirmation prompts for new daily summaries

Environment:
  CLAUDE_PROJECTS_DIR           Path to Claude projects directory
                                (default: ~/.claude/projects)

Config: ~/.agenthud/config.yaml
`;
}

export function getVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const packageJson = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
  );
  return packageJson.version;
}

export function clearScreen(): void {
  console.clear();
}

function parseLocalMidnight(dateStr: string): Date | null {
  if (dateStr === "today") {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (dateStr === "yesterday") {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  }
  // Relative: -Nd (N days ago)
  const relMatch = dateStr.match(/^-(\d+)d$/);
  if (relMatch) {
    const days = Number(relMatch[1]);
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  }
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function todayLocalMidnight(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function parseArgs(args: string[]): CliOptions {
  if (args.includes("--help") || args.includes("-h")) {
    return { mode: "watch", command: "help" };
  }
  if (args.includes("--version") || args.includes("-V")) {
    return { mode: "watch", command: "version" };
  }
  if (args.includes("--once")) {
    return { mode: "once" };
  }

  if (args[0] === "report") {
    const rest = args.slice(1);
    let reportDate = todayLocalMidnight();
    let reportInclude = DEFAULT_TYPES;
    let reportError: string | undefined;

    // Check for unknown flags in report subcommand
    for (const arg of rest) {
      if (arg.startsWith("-") && !KNOWN_REPORT_FLAGS.has(arg)) {
        reportError = `Unknown option: "${arg}". Run agenthud --help for usage.`;
        break;
      }
    }

    const dateIdx = rest.indexOf("--date");
    if (dateIdx !== -1) {
      const dateStr = rest[dateIdx + 1];
      if (!dateStr) {
        reportError = "Invalid date: missing value for --date";
      } else {
        const parsed = parseLocalMidnight(dateStr);
        if (!parsed) {
          reportError = `Invalid date: "${dateStr}". Use YYYY-MM-DD, "today", "yesterday", or "-Nd" (N days ago).`;
        } else {
          reportDate = parsed;
        }
      }
    }

    const includeIdx = rest.indexOf("--include");
    if (includeIdx !== -1) {
      const includeStr = rest[includeIdx + 1];
      if (includeStr === "all") {
        reportInclude = ALL_TYPES;
      } else if (includeStr) {
        reportInclude = includeStr
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }

    let reportFormat: "markdown" | "json" = "markdown";
    const formatIdx = rest.indexOf("--format");
    if (formatIdx !== -1) {
      const fmt = rest[formatIdx + 1];
      if (fmt === "json" || fmt === "markdown") {
        reportFormat = fmt;
      } else if (fmt) {
        reportError = `Invalid format: "${fmt}". Use "markdown" or "json".`;
      } else {
        reportError = "Invalid format: missing value for --format.";
      }
    }

    let reportDetailLimit: number | undefined;
    const detailLimitIdx = rest.indexOf("--detail-limit");
    if (detailLimitIdx !== -1) {
      const val = rest[detailLimitIdx + 1];
      const n = Number(val);
      if (!val || Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
        reportError = `Invalid --detail-limit: "${val}". Must be a non-negative integer.`;
      } else {
        reportDetailLimit = n;
      }
    }

    const reportWithGit = rest.includes("--with-git");

    return {
      mode: "report",
      reportDate,
      reportInclude,
      reportFormat,
      reportDetailLimit,
      reportWithGit,
      reportError,
    };
  }

  if (args[0] === "summary") {
    const rest = args.slice(1);
    let summaryDate: Date | undefined;
    let summaryFrom: Date | undefined;
    let summaryTo: Date | undefined;
    let summaryPrompt: string | undefined;
    let summaryForce = false;
    let summaryAssumeYes = false;
    let summaryError: string | undefined;

    const FLAGS_WITH_VALUE = new Set([
      "--date",
      "--last",
      "--from",
      "--to",
      "--prompt",
    ]);

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (!arg.startsWith("-")) continue;
      if (!KNOWN_SUMMARY_FLAGS.has(arg)) {
        summaryError = `Unknown option: "${arg}". Run agenthud --help for usage.`;
        break;
      }
      if (FLAGS_WITH_VALUE.has(arg)) i++;
    }

    const dateIdx = rest.indexOf("--date");
    if (dateIdx !== -1) {
      const dateStr = rest[dateIdx + 1];
      if (!dateStr) {
        summaryError = "Invalid date: missing value for --date";
      } else {
        const parsed = parseLocalMidnight(dateStr);
        if (!parsed) {
          summaryError = `Invalid date: "${dateStr}". Use YYYY-MM-DD, "today", "yesterday", or "-Nd" (N days ago).`;
        } else {
          summaryDate = parsed;
        }
      }
    }

    const lastIdx = rest.indexOf("--last");
    if (lastIdx !== -1 && !summaryError) {
      const val = rest[lastIdx + 1];
      if (!val) {
        summaryError = "Invalid --last: missing value (e.g. --last 7d).";
      } else {
        const m = val.match(/^(\d+)d$/);
        if (!m) {
          summaryError = `Invalid --last: "${val}". Use form like "7d".`;
        } else {
          const days = Number(m[1]);
          if (days < 1) {
            summaryError = `Invalid --last: "${val}". Must be at least 1 day.`;
          } else {
            const today = todayLocalMidnight();
            const from = new Date(today);
            from.setDate(today.getDate() - (days - 1));
            summaryFrom = from;
            summaryTo = today;
          }
        }
      }
    }

    const fromIdx = rest.indexOf("--from");
    const toIdx = rest.indexOf("--to");
    if ((fromIdx !== -1 || toIdx !== -1) && !summaryError) {
      if (fromIdx === -1 || toIdx === -1) {
        summaryError = "--from and --to must be used together.";
      } else {
        const fromStr = rest[fromIdx + 1];
        const toStr = rest[toIdx + 1];
        const from = fromStr ? parseLocalMidnight(fromStr) : null;
        const to = toStr ? parseLocalMidnight(toStr) : null;
        if (!from) {
          summaryError = `Invalid --from: "${fromStr}".`;
        } else if (!to) {
          summaryError = `Invalid --to: "${toStr}".`;
        } else if (from.getTime() > to.getTime()) {
          summaryError = `--from (${fromStr}) must be on or before --to (${toStr}).`;
        } else {
          summaryFrom = from;
          summaryTo = to;
        }
      }
    }

    if (!summaryError) {
      const modesUsed = [
        summaryDate !== undefined,
        lastIdx !== -1,
        fromIdx !== -1 || toIdx !== -1,
      ].filter(Boolean).length;
      if (modesUsed > 1) {
        summaryError =
          "--date, --last, and --from/--to are mutually exclusive.";
      }
    }

    if (
      !summaryError &&
      summaryDate === undefined &&
      summaryFrom === undefined
    ) {
      summaryDate = todayLocalMidnight();
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
    if (rest.includes("-y") || rest.includes("--yes")) summaryAssumeYes = true;

    return {
      mode: "summary",
      summaryDate,
      summaryFrom,
      summaryTo,
      summaryPrompt,
      summaryForce,
      summaryAssumeYes,
      summaryError,
    };
  }

  // Unknown subcommand (positional arg that's not a known command)
  if (args[0] && !args[0].startsWith("-") && !KNOWN_SUBCOMMANDS.has(args[0])) {
    return {
      mode: "watch",
      error: `Unknown command: "${args[0]}". Run agenthud --help for usage.`,
    };
  }

  // Unknown flags in watch mode
  for (const arg of args) {
    if (arg.startsWith("-") && !KNOWN_WATCH_FLAGS.has(arg)) {
      return {
        mode: "watch",
        error: `Unknown option: "${arg}". Run agenthud --help for usage.`,
      };
    }
  }

  return { mode: "watch" };
}
