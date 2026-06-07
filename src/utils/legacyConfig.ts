import { join, resolve } from "node:path";
import { isWSL as detectWSL } from "./platform.js";

// `/mnt/<drive>/Users/<name>` — the WSL mount of a Windows-side user
// home. Only meaningful when we know we're inside WSL.
const WSL_WINDOWS_USER_HOME = /^\/mnt\/[a-z]\/Users\/[^/]+\/?$/i;

/**
 * Returns true if a `.agenthud/config.yaml` under `cwd` should be
 * treated as a legacy project-level config (and offered for
 * migration). Returns false when the path is in fact a global config
 * we shouldn't touch — currently two cases:
 *
 *   1. `cwd` is literally the user's home directory (the existing
 *      guard — covers every native platform). `homedir()` is the
 *      source of truth here.
 *
 *   2. We're running inside WSL and `cwd` looks like a
 *      `/mnt/<drive>/Users/<name>` mount of the Windows-side user
 *      home. In that case `homedir()` lies — it reports the Linux
 *      home (`/home/<name>`) — but the `.agenthud/config.yaml`
 *      sitting in the Windows user dir is the Windows-native global
 *      config and deleting it would wipe real settings.
 *
 * `opts.isWSL` is injectable for tests; in real use the default
 * runtime detector fires.
 */
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
