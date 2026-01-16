import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface CliOptions {
  mode: "watch" | "once";
  command?: "init" | "version" | "help";
}

export function getHelp(): string {
  return `Usage: agenthud [command] [options]

Commands:
  init              Initialize agenthud in current directory

Options:
  -w, --watch       Watch mode (default)
  --once            Run once and exit
  -V, --version     Show version number
  -h, --help        Show this help message
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
  const hasOnce = args.includes("--once");
  const hasVersion = args.includes("--version") || args.includes("-V");
  const hasHelp = args.includes("--help") || args.includes("-h");

  // Check for help flag first
  if (hasHelp) {
    return { mode: "watch", command: "help" };
  }

  // Check for version flag
  if (hasVersion) {
    return { mode: "watch", command: "version" };
  }

  // Check for init command (must be first argument)
  const command = args[0] === "init" ? "init" : undefined;

  // --once takes precedence
  if (hasOnce) {
    return { mode: "once", command };
  }

  // Default is watch mode
  return { mode: "watch", command };
}
