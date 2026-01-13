import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export interface CliOptions {
  mode: "watch" | "once";
  command?: "init" | "version";
}

export function getVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const packageJson = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf-8")
  );
  return packageJson.version;
}

// Dependency injection for testing
type ClearFn = () => void;
let clearFn: ClearFn = () => console.clear();

export function setClearFn(fn: ClearFn): void {
  clearFn = fn;
}

export function resetClearFn(): void {
  clearFn = () => console.clear();
}

export function clearScreen(): void {
  clearFn();
}

export function parseArgs(args: string[]): CliOptions {
  const hasOnce = args.includes("--once");
  const hasVersion = args.includes("--version") || args.includes("-V");

  // Check for version flag first
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
