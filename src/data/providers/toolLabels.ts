/**
 * Canonical tool labels — single naming scheme that all providers
 * map into so downstream code (report filters, summary input,
 * detail viewer dispatch, per-tool icons) only has to know one
 * taxonomy.
 *
 * Claude already uses these names verbatim (`Read`, `Bash`, ...) so
 * its parser stamps them as-is. Kiro and OpenCode use lowercase
 * names (`read`, `shell`/`bash`, `web_fetch`/`webfetch`, ...) — they
 * translate at the parser boundary via `canonicalToolLabel`.
 *
 * Design decisions:
 * - Mapping is a `Map<string, string>` not a switch so unknown
 *   tools fall through to their raw name (preserves visibility
 *   when a provider ships a new tool we haven't catalogued yet —
 *   e.g. OpenCode MCP tools like `mcp_acme_doThing`).
 * - Kiro's `introspect` collapses to `Read` because semantically
 *   it's "look at the project structure" — same bucket as a
 *   file-system read. Treating it as its own label would split
 *   the `read` filter category and surprise users.
 * - Both `task` and `subagent` collapse to `Task` since they
 *   represent the same concept (delegate to a sub-agent).
 * - Entries added for OpenCode's vocabulary (shared, not gated per
 *   provider): `webfetch`/`websearch` (one word, vs Kiro's
 *   `web_fetch`/`web_search`), `list` → `Glob` (directory enumeration
 *   sits in the read/glob bucket), `patch` → `Edit` (a diff is an edit).
 */

import { ICONS } from "../../types/index.js";

const RAW_TOOL_TO_CANONICAL: Map<string, string> = new Map([
  ["read", "Read"],
  ["introspect", "Read"],
  ["shell", "Bash"],
  ["bash", "Bash"],
  ["write", "Write"],
  ["edit", "Edit"],
  ["patch", "Edit"],
  ["grep", "Grep"],
  ["glob", "Glob"],
  ["list", "Glob"],
  ["web_fetch", "WebFetch"],
  ["webfetch", "WebFetch"],
  ["fetch", "WebFetch"],
  ["web_search", "WebSearch"],
  ["websearch", "WebSearch"],
  ["search", "WebSearch"],
  ["task", "Task"],
  ["subagent", "Task"],
  ["todo", "TodoWrite"],
  ["todowrite", "TodoWrite"],
  ["ask", "AskUserQuestion"],
  ["askuserquestion", "AskUserQuestion"],
]);

/** Translate a provider's raw tool name to the canonical label.
 * Unknown names pass through as-is so a new provider tool surfaces
 * with its original identity instead of being silently mislabeled. */
export function canonicalToolLabel(raw: string): string {
  return RAW_TOOL_TO_CANONICAL.get(raw.toLowerCase()) ?? raw;
}

/** Icon for a canonical label. Canonical labels match the keys of the
 * shared ICONS table, so this is a straight lookup; anything we don't
 * recognize (a passed-through raw tool name) falls back to
 * `ICONS.Default` — still a printable glyph, not blank. */
export function iconForCanonicalLabel(label: string): string {
  return (ICONS as Record<string, string>)[label] ?? ICONS.Default;
}
