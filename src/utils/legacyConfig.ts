import { join, resolve } from "node:path";

/**
 * Returns true if a `.agenthud/config.yaml` under `cwd` should be treated as a
 * legacy project-level config (and offered for migration). Returns false when
 * the path collides with the global `~/.agenthud/config.yaml`, which happens
 * if the user runs agenthud from their home directory.
 */
export function isLegacyProjectConfig(cwd: string, home: string): boolean {
  const legacy = resolve(join(cwd, ".agenthud", "config.yaml"));
  const global = resolve(join(home, ".agenthud", "config.yaml"));
  return legacy !== global;
}
