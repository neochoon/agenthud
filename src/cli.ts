import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ALL_TYPES = ["response", "bash", "edit", "thinking", "read", "glob", "user"];
const DEFAULT_TYPES = ["response", "bash", "edit", "thinking"];

export interface CliOptions {
  mode: "watch" | "once" | "report";
  command?: "version" | "help";
  reportDate?: Date;
  reportInclude?: string[];
  reportError?: string;
}

export function getHelp(): string {
  return `Usage: agenthud [options]

Monitors all running Claude Code sessions in real-time.

Options:
  -w, --watch                   Watch mode (default) — live updates
  --once                        Print once and exit
  -V, --version                 Show version number
  -h, --help                    Show this help message

Commands:
  report [--date DATE] [--include TYPES]
                                Print activity report for a date (default: today)
    --date YYYY-MM-DD|today     Date to report on
    --include TYPES             Comma-separated types or "all"
                                Types: response,bash,edit,thinking,read,glob,user
                                Default: response,bash,edit,thinking

Environment:
  CLAUDE_PROJECTS_DIR           Path to Claude projects directory
                                (default: ~/.claude/projects)

Config: ~/.agenthud/config.yaml
Logs:   ~/.agenthud/logs/
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

function parseUTCMidnight(dateStr: string): Date | null {
  if (dateStr === "today") {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function todayUTCMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
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
    let reportDate = todayUTCMidnight();
    let reportInclude = DEFAULT_TYPES;
    let reportError: string | undefined;

    const dateIdx = rest.indexOf("--date");
    if (dateIdx !== -1) {
      const dateStr = rest[dateIdx + 1];
      if (!dateStr) {
        reportError = "Invalid date: missing value for --date";
      } else {
        const parsed = parseUTCMidnight(dateStr);
        if (!parsed) {
          reportError = `Invalid date: "${dateStr}". Use YYYY-MM-DD or "today".`;
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
        reportInclude = includeStr.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }

    return { mode: "report", reportDate, reportInclude, reportError };
  }

  return { mode: "watch" };
}
