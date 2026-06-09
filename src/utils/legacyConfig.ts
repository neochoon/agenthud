/**
 * Decide whether a `.agenthud/config.yaml` under `cwd` should be
 * treated as a *legacy project-level* config that the user should
 * be prompted to migrate, or as the *global* config that must
 * never be touched. Used by the migration prompt at boot.
 *
 * Design decisions:
 * - Returns false (= "this IS the global config, leave alone") in
 *   two cases: cwd literally equals home (covers every native
 *   platform), AND cwd is a `/mnt/<drive>/Users/<name>` Windows
 *   user-home mount when running inside WSL.
 * - `opts.isWSL` is dependency-injectable so tests don't have to
 *   either stub `/proc/version` or skip on non-WSL runners.
 *
 * Gotcha:
 * - Inside WSL, `homedir()` returns the Linux home
 *   (`/home/<name>`) but the user often runs from
 *   `/mnt/c/Users/<name>` — the Windows-side home. Without the
 *   WSL guard, agenthud's "is this a project-level config?" check
 *   wrongly returns true and the migration prompt offers to
 *   delete the Windows-native global config. v0.12.4 added this
 *   as a data-loss guard.
 */

import { join, resolve } from "node:path";
import { isWSL as detectWSL } from "./platform.js";

// `/mnt/<drive>/Users/<name>` — the WSL mount of a Windows-side user
// home. Only meaningful when we know we're inside WSL.
const WSL_WINDOWS_USER_HOME = /^\/mnt\/[a-z]\/Users\/[^/]+\/?$/i;

export function isLegacyProjectConfig(
  cwd: string,
  home: string,
  opts: { isWSL?: boolean } = {},
): boolean {
  const legacy = resolve(join(cwd, ".agenthud", "config.yaml"));
  const global = resolve(join(home, ".agenthud", "config.yaml"));
  if (legacy === global) return false;

  const wsl = opts.isWSL ?? detectWSL();
  if (wsl && WSL_WINDOWS_USER_HOME.test(cwd)) return false;

  return true;
}
