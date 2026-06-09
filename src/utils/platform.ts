/**
 * Detect whether this Node process is running inside WSL — via the
 * `WSL_DISTRO_NAME` env var (set by Microsoft's launcher) or the
 * `microsoft`/`wsl` markers in `/proc/version`.
 *
 * Design decision:
 * - Result cached for the lifetime of the process. Neither signal
 *   changes mid-run, and `--open` calls (which check WSL) can
 *   fire repeatedly — re-reading `/proc/version` every time would
 *   be wasted syscalls.
 *
 * Gotcha:
 * - Only used as an environment detector — don't read it before
 *   `process.env` is populated (i.e. don't call from a module
 *   top-level that runs at import time on Node where env stripping
 *   could matter). All current call sites are inside functions, so
 *   this is fine in practice.
 */

import { readFileSync } from "node:fs";

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
