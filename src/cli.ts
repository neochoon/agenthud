import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_INCLUDE_TYPES } from "./config/globalConfig.js";
import type { GlobalConfig } from "./types/index.js";

const ALL_TYPES = [
  "response",
  "bash",
  "edit",
  "thinking",
  "read",
  "glob",
  "user",
];

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
  summaryModel?: string;
  // Report-shaped options on summary. Resolved as
  // CLI flag → config.summary.X → config.report.X → built-in default.
  summaryInclude?: string[];
  summaryFormat?: "markdown" | "json";
  summaryDetailLimit?: number;
  summaryWithGit?: boolean;
  /** Launch the resulting summary in the OS default app after writing. */
  summaryOpen?: boolean;
  summaryError?: string;
  scopeToCwd?: boolean;
}

const KNOWN_WATCH_FLAGS = new Set([
  "-w",
  "--watch",
  "--once",
  "-V",
  "--version",
  "-h",
  "--help",
  "--cwd",
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
  "--model",
  "-y",
  "--yes",
  "--include",
  "--format",
  "--detail-limit",
  "--with-git",
  "-o",
  "--open",
]);
const KNOWN_SUBCOMMANDS = new Set(["watch", "report", "summary"]);

export function getHelp(): string {
  return `Usage: agenthud [command] [options]

Monitors all running Claude Code sessions.

Commands:
  watch (default)               Live TUI — project tree on top, activity
                                viewer on bottom, both updating in real
                                time. Running \`agenthud\` with no
                                command does this.
    -w, --watch                 Explicit alias for the default
    --once                      Print one frame and exit
    --cwd                       Scope to the Claude project containing
                                the current directory. Exits 1 if no
                                such project is found.

  report [--date DATE] [--include TYPES] [--format FORMAT]
         [--detail-limit N] [--with-git]
                                Print activity report for a date
                                (default: today). Markdown or JSON.
    --date YYYY-MM-DD|today|yesterday|-Nd     Date to report on
    --include TYPES             Comma-separated types or "all"
                                Types:   user, response, bash, edit,
                                         thinking, read, glob
                                Default: user, response, bash, edit, thinking
    --format FORMAT             markdown (default) or json
    --detail-limit N            Max chars per detail (default 120;
                                0 = unlimited)
    --with-git                  Merge git commits from each session's
                                project into the timeline

  summary [--date DATE | --last Nd | --from DATE --to DATE]
          [--include TYPES] [--detail-limit N] [--with-git]
          [--prompt TEXT] [--force] [--model NAME] [-y] [-o]
                                Generate an LLM summary via the claude
                                CLI. A single day produces a daily
                                summary; a date range produces a
                                meta-summary built from daily summaries.
    --date YYYY-MM-DD|today|yesterday|-Nd     Date to summarize (default: today)
    --last Nd                   Date range: last N days, ending today
                                (e.g. --last 7d)
    --from YYYY-MM-DD           Range start (use with --to)
    --to YYYY-MM-DD             Range end (use with --from)
    --include TYPES             Activity types fed to the LLM
                                (same shape as report's --include)
    --detail-limit N            Max chars per activity detail in the
                                LLM payload (0 = unlimited)
    --with-git                  Merge git commits into the LLM payload
    --prompt TEXT               Override prompt for this run (daily only)
    --force                     Regenerate even if cached
    --model NAME                Pass --model to claude (e.g. "sonnet",
                                "haiku", or a full model id)
    -y, --yes                   Skip confirmation prompts for new daily
                                summaries
    -o, --open                  Launch the resulting summary in your OS
                                default app once it's written (or read
                                back from cache).

  Defaults for report and summary live under \`report:\` and \`summary:\`
  in ~/.agenthud/config.yaml. Flags override config values per-run; the
  effective values are printed to stderr at the start of each run.

Global options:
  -V, --version                 Show version number
  -h, --help                    Show this help message

Environment:
  CLAUDE_PROJECTS_DIR           Path to the Claude projects directory
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

/**
 * One-line stderr summary of the options that report/summary just
 * resolved through the flag → config → default hierarchy. The line is
 * informational, not actionable — values only, no `(flag)`/`(config)`
 * source markers (read the yaml if you need to know).
 */
export function formatEffectiveOptionsLine(
  command: "report" | "summary",
  fields: {
    include: string[];
    detailLimit?: number;
    withGit: boolean;
    format?: "markdown" | "json";
    model?: string;
  },
): string {
  const parts: string[] = [];
  parts.push(`include=[${fields.include.join(",")}]`);
  if (fields.detailLimit !== undefined) {
    parts.push(
      `detail-limit=${fields.detailLimit === 0 ? "∞" : fields.detailLimit}`,
    );
  }
  parts.push(`with-git=${fields.withGit ? "on" : "off"}`);
  if (fields.format) parts.push(`format=${fields.format}`);
  if (fields.model) parts.push(`model=${fields.model}`);
  return `${command} → ${parts.join(" ")}`;
}

function todayLocalMidnight(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function parseArgs(
  args: string[],
  config?: GlobalConfig,
): CliOptions {
  // `watch` is the explicit form of the default mode — strip it so the
  // rest of parsing sees the same shape it always has.
  if (args[0] === "watch") args = args.slice(1);
  if (args.includes("--help") || args.includes("-h")) {
    return { mode: "watch", command: "help" };
  }
  if (args.includes("--version") || args.includes("-V")) {
    return { mode: "watch", command: "version" };
  }
  if (args.includes("--once")) {
    return args.includes("--cwd")
      ? { mode: "once", scopeToCwd: true }
      : { mode: "once" };
  }

  if (args[0] === "report") {
    const rest = args.slice(1);
    let reportDate = todayLocalMidnight();
    let reportInclude = config?.report.include ?? DEFAULT_INCLUDE_TYPES;
    let reportError: string | undefined;

    // Check for unknown flags in report subcommand. Skip the value
    // following any flag that takes one, otherwise a `-Nd` date like
    // `-1d` gets misread as an unknown flag.
    const FLAGS_WITH_VALUE = new Set([
      "--date",
      "--include",
      "--format",
      "--detail-limit",
    ]);
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (!arg.startsWith("-")) continue;
      if (!KNOWN_REPORT_FLAGS.has(arg)) {
        reportError = `Unknown option: "${arg}". Run agenthud --help for usage.`;
        break;
      }
      if (FLAGS_WITH_VALUE.has(arg)) i++;
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
      if (!includeStr) {
        reportError = "Invalid --include: missing value.";
      } else if (includeStr === "all") {
        reportInclude = ALL_TYPES;
      } else {
        const tokens = includeStr
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const unknown = tokens.filter((t) => !ALL_TYPES.includes(t));
        if (unknown.length > 0) {
          reportError = `Unknown --include type${unknown.length > 1 ? "s" : ""}: ${unknown.map((u) => `"${u}"`).join(", ")}. Valid types: ${ALL_TYPES.join(", ")} (or "all").`;
        } else {
          reportInclude = tokens;
        }
      }
    }

    let reportFormat: "markdown" | "json" = config?.report.format ?? "markdown";
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

    let reportDetailLimit: number | undefined = config?.report.detailLimit;
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

    const reportWithGit =
      rest.includes("--with-git") || (config?.report.withGit ?? false);

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
    let summaryModel: string | undefined;
    let summaryError: string | undefined;

    const FLAGS_WITH_VALUE = new Set([
      "--date",
      "--last",
      "--from",
      "--to",
      "--prompt",
      "--model",
      "--include",
      "--format",
      "--detail-limit",
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

    const modelIdx = rest.indexOf("--model");
    if (modelIdx !== -1) {
      const val = rest[modelIdx + 1];
      if (!val) {
        summaryError = "Invalid --model: missing value (e.g. --model sonnet).";
      } else {
        summaryModel = val;
      }
    }

    if (rest.includes("--force")) summaryForce = true;
    if (rest.includes("-y") || rest.includes("--yes")) summaryAssumeYes = true;
    const summaryOpen =
      rest.includes("--open") || rest.includes("-o") || undefined;

    // Resolve report-shaped options for summary:
    //   CLI flag → config.summary.X → config.report.X → built-in default.
    let summaryInclude: string[] =
      config?.summary.include ??
      config?.report.include ??
      DEFAULT_INCLUDE_TYPES;
    const summaryIncludeIdx = rest.indexOf("--include");
    if (summaryIncludeIdx !== -1) {
      const includeStr = rest[summaryIncludeIdx + 1];
      if (!includeStr) {
        summaryError = summaryError ?? "Invalid --include: missing value.";
      } else if (includeStr === "all") {
        summaryInclude = ALL_TYPES;
      } else {
        const tokens = includeStr
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const unknown = tokens.filter((t) => !ALL_TYPES.includes(t));
        if (unknown.length > 0) {
          summaryError =
            summaryError ??
            `Unknown --include type${unknown.length > 1 ? "s" : ""}: ${unknown
              .map((u) => `"${u}"`)
              .join(", ")}. Valid types: ${ALL_TYPES.join(", ")} (or "all").`;
        } else {
          summaryInclude = tokens;
        }
      }
    }

    let summaryFormat: "markdown" | "json" =
      config?.summary.format ?? config?.report.format ?? "markdown";
    const summaryFormatIdx = rest.indexOf("--format");
    if (summaryFormatIdx !== -1) {
      const fmt = rest[summaryFormatIdx + 1];
      if (fmt === "json" || fmt === "markdown") {
        summaryFormat = fmt;
      } else if (fmt) {
        summaryError =
          summaryError ?? `Invalid format: "${fmt}". Use "markdown" or "json".`;
      } else {
        summaryError =
          summaryError ?? "Invalid format: missing value for --format.";
      }
    }

    let summaryDetailLimit: number | undefined =
      config?.summary.detailLimit ?? config?.report.detailLimit;
    const summaryDetailLimitIdx = rest.indexOf("--detail-limit");
    if (summaryDetailLimitIdx !== -1) {
      const val = rest[summaryDetailLimitIdx + 1];
      const n = Number(val);
      if (!val || Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
        summaryError =
          summaryError ??
          `Invalid --detail-limit: "${val}". Must be a non-negative integer.`;
      } else {
        summaryDetailLimit = n;
      }
    }

    const summaryWithGit =
      rest.includes("--with-git") ||
      (config?.summary.withGit ?? config?.report.withGit ?? false);

    if (summaryModel === undefined && config?.summary.model) {
      summaryModel = config.summary.model;
    }

    return {
      mode: "summary",
      summaryDate,
      summaryFrom,
      summaryTo,
      summaryPrompt,
      summaryForce,
      summaryAssumeYes,
      summaryModel,
      summaryInclude,
      summaryFormat,
      summaryDetailLimit,
      summaryWithGit,
      summaryOpen,
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

  return args.includes("--cwd")
    ? { mode: "watch", scopeToCwd: true }
    : { mode: "watch" };
}
