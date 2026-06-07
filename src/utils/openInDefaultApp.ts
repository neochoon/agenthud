import { spawn } from "node:child_process";

export interface OpenCommand {
  command: string;
  args: string[];
}

/**
 * Build the OS-specific command needed to open a file with the user's
 * default application. Returns null on platforms we don't recognize so
 * the caller can fall back to a warning + the printed path.
 *
 * Paths are passed through verbatim — `spawn` handles quoting at the
 * argument boundary, so caller-supplied spaces / unicode are fine.
 */
export function buildOpenCommand(
  platform: NodeJS.Platform | string,
  path: string,
): OpenCommand | null {
  switch (platform) {
    case "darwin":
      return { command: "open", args: [path] };
    case "linux":
      return { command: "xdg-open", args: [path] };
    case "win32":
      // The empty-string after `start` is the window title — Windows
      // treats the first quoted argument to `start` as the title, so a
      // path with spaces would otherwise be eaten as the title and the
      // file would never open.
      return { command: "cmd", args: ["/c", "start", "", path] };
    default:
      return null;
  }
}

/**
 * Launch the OS default app on `path` and return immediately. Failures
 * (no command, spawn error, missing handler like `xdg-open` on
 * minimal Linux) are reported on stderr; the agenthud process keeps
 * going so the path it already printed remains the user's fallback.
 */
export function openInDefaultApp(path: string): void {
  const cmd = buildOpenCommand(process.platform, path);
  if (!cmd) {
    process.stderr.write(
      `agenthud: --open: no known opener for platform "${process.platform}"\n`,
    );
    return;
  }
  try {
    const child = spawn(cmd.command, cmd.args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (err) => {
      process.stderr.write(`agenthud: --open failed: ${err.message}\n`);
    });
    child.unref();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`agenthud: --open failed: ${msg}\n`);
  }
}
