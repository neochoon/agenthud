import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface OpenCommand {
  command: string;
  args: string[];
}

/**
 * Build the OS-specific command needed to open a file with the user's
 * default application. Returns null on platforms we don't recognise so
 * the caller can fall back to a warning + the printed path.
 *
 * For WSL we prefer `wslview` (from the wslu package) — it knows how
 * to route through to the Windows host's default app. `xdg-open` is
 * the linux fallback when wslview isn't installed; on a headless WSL
 * without a display that will fail but at least the caller sees the
 * non-zero exit and can warn.
 */
export function buildOpenCommand(
  platform: NodeJS.Platform | string,
  path: string,
  opts: { wslView?: boolean } = {},
): OpenCommand | null {
  switch (platform) {
    case "darwin":
      return { command: "open", args: [path] };
    case "linux":
      if (opts.wslView) return { command: "wslview", args: [path] };
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
 * True when this Node process is running inside WSL. Detected by the
 * `WSL_DISTRO_NAME` env var (set by Microsoft's launcher) or by the
 * `microsoft`/`wsl` markers in `/proc/version`.
 */
export function isWSL(): boolean {
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    const ver = readFileSync("/proc/version", "utf-8");
    return /microsoft|wsl/i.test(ver);
  } catch {
    return false;
  }
}

/**
 * Synchronously check whether `command` is on PATH. Used before spawn
 * so we can fail loud when the platform-specific opener isn't
 * installed (e.g. WSL without `xdg-utils` or `wslu`).
 */
export function commandExists(command: string): boolean {
  const PATH = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT?.split(";") ?? [".EXE", ".CMD", ".BAT"]).map(
          (e) => e.toLowerCase(),
        )
      : [""];
  for (const dir of PATH.split(sep)) {
    if (!dir) continue;
    const full = join(dir, command);
    for (const ext of exts) {
      try {
        if (existsSync(full + ext)) return true;
      } catch {
        // ignore — keep walking
      }
    }
  }
  return false;
}

/**
 * Launch the OS default app on `path`. Returns a promise that resolves
 * once we know whether the spawn succeeded — either after a brief
 * grace period (the typical happy path) or as soon as the child errors
 * / exits with a non-zero code. Failures (no command, fast error, bad
 * exit) are reported on stderr so the caller's printed path remains a
 * sensible fallback.
 */
export async function openInDefaultApp(path: string): Promise<void> {
  // Prefer wslview on WSL when it's available (it routes through to
  // the Windows host); otherwise fall back to xdg-open and let the
  // command-exists / exit-code check below surface the failure.
  const wslView = isWSL() && commandExists("wslview");
  const cmd = buildOpenCommand(process.platform, path, { wslView });

  if (!cmd) {
    process.stderr.write(
      `agenthud: --open: no known opener for platform "${process.platform}"\n`,
    );
    return;
  }

  if (!commandExists(cmd.command)) {
    process.stderr.write(
      `agenthud: --open: '${cmd.command}' is not on PATH; cannot open ${path}\n`,
    );
    if (isWSL()) {
      process.stderr.write(
        "agenthud: hint: on WSL install `wslu` (provides wslview) so files open with the Windows host's default app — e.g. `sudo apt install wslu`\n",
      );
    }
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    let child;
    try {
      child = spawn(cmd.command, cmd.args, {
        detached: true,
        stdio: "ignore",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`agenthud: --open failed: ${msg}\n`);
      finish();
      return;
    }

    child.on("error", (err) => {
      process.stderr.write(`agenthud: --open failed: ${err.message}\n`);
      finish();
    });

    // Most openers (open/xdg-open/wslview/cmd start) hand off to the
    // OS and exit within tens of milliseconds; a non-zero exit code
    // here means the dispatch failed (no display, unknown handler,
    // …) and we want to surface that.
    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        process.stderr.write(
          `agenthud: --open: '${cmd.command}' exited with code ${code}\n`,
        );
      }
      finish();
    });

    // Give the child up to 200ms to fail fast. If it's still running
    // by then it almost certainly succeeded (the launched viewer
    // takes over), so we detach and let agenthud return.
    setTimeout(() => {
      if (!settled) {
        child.unref();
        finish();
      }
    }, 200).unref();
  });
}
