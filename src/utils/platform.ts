import { readFileSync } from "node:fs";

/**
 * True when this Node process is running inside WSL. Detected by the
 * `WSL_DISTRO_NAME` env var (set by Microsoft's launcher) or the
 * `microsoft`/`wsl` markers in `/proc/version`. Result is cached for
 * the lifetime of the process — neither signal changes mid-run.
 */
let cached: boolean | null = null;
export function isWSL(): boolean {
  if (cached !== null) return cached;
  if (process.env.WSL_DISTRO_NAME) {
    cached = true;
    return cached;
  }
  try {
    const ver = readFileSync("/proc/version", "utf-8");
    cached = /microsoft|wsl/i.test(ver);
  } catch {
    cached = false;
  }
  return cached;
}
