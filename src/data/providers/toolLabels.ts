/**
 * Canonical tool labels — single naming scheme that all providers
 * map into so downstream code (report filters, summary input,
 * detail viewer dispatch) only has to know one taxonomy.
 *
 * Claude already uses these names verbatim (`Read`, `Bash`, ...) so
 * its parser stamps them as-is. Kiro uses lowercase snake_case
 * (`read`, `shell`, `web_fetch`, `subagent`, `introspect`) — we
 * translate at the parser boundary. Future providers (OpenCode,
 * Kiro IDE) extend the mapping here without touching consumers.
 *
 * Design decision:
 * - Mapping is a `Map<string, string>` not a switch so unknown
 *   tools fall through to their raw name (preserves visibility
 *   when a provider ships a new tool we haven't catalogued yet).
 * - Kiro's `introspect` collapses to `Read` because semantically
 *   it's "look at the project structure" — same bucket as a
 *   file-system read. Treating it as its own label would split
 *   the `read` filter category and surprise users.
 * - Both `task` and `subagent` collapse to `Task` since they
 *   represent the same concept (delegate to a sub-agent).
 */

const KIRO_TO_CANONICAL: Map<string, string> = new Map([
  ["read", "Read"],
  ["introspect", "Read"],
  ["shell", "Bash"],
  ["bash", "Bash"],
  ["write", "Write"],
  ["edit", "Edit"],
  ["grep", "Grep"],
  ["glob", "Glob"],
  ["web_fetch", "WebFetch"],
  ["fetch", "WebFetch"],
  ["web_search", "WebSearch"],
  ["search", "WebSearch"],
  ["task", "Task"],
  ["subagent", "Task"],
  ["todo", "TodoWrite"],
  ["todowrite", "TodoWrite"],
  ["ask", "AskUserQuestion"],
  ["askuserquestion", "AskUserQuestion"],
]);

/** Translate a Kiro raw tool name to the canonical label. Unknown
 * names pass through as-is so a new provider tool surfaces with
 * its original identity instead of being silently mislabeled. */
export function canonicalKiroToolLabel(raw: string): string {
  return KIRO_TO_CANONICAL.get(raw.toLowerCase()) ?? raw;
}
