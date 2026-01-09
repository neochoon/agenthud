export interface CliOptions {
  mode: "watch" | "once";
}

export function parseArgs(args: string[]): CliOptions {
  const hasOnce = args.includes("--once");
  const hasWatch = args.includes("--watch") || args.includes("-w");

  // --once takes precedence
  if (hasOnce) {
    return { mode: "once" };
  }

  // Default is watch mode
  return { mode: "watch" };
}
