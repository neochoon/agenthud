import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface CliOptions {
  mode: "watch" | "once";
  command?: "version" | "help";
}

export function getHelp(): string {
  return `Usage: agenthud [options]

Monitors all running Claude Code sessions in real-time.

Options:
  -w, --watch       Watch mode (default) — live updates
  --once            Print once and exit
  -V, --version     Show version number
  -h, --help        Show this help message

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
  return { mode: "watch" };
}
