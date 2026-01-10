export interface CliOptions {
  mode: "watch" | "once";
  command?: "init";
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
  const hasWatch = args.includes("--watch") || args.includes("-w");

  // Check for init command (must be first argument)
  const command = args[0] === "init" ? "init" : undefined;

  // --once takes precedence
  if (hasOnce) {
    return { mode: "once", command };
  }

  // Default is watch mode
  return { mode: "watch", command };
}
