/**
 * Single source of truth for the app's data directory
 * (`~/.agenthud`). The `AGENTHUD_HOME` env override exists so test
 * suites and CI smoke runs can point the app at a throwaway
 * directory instead of touching the developer's real home — and as
 * a user-facing escape hatch for mounted/synced setups, mirroring
 * `CLAUDE_PROJECTS_DIR` / `KIRO_SESSIONS_DIR`.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export function agenthudHome(): string {
  return process.env.AGENTHUD_HOME ?? join(homedir(), ".agenthud");
}
