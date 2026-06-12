/**
 * Backward-compat re-export shim. The Claude-specific JSONL parser
 * now lives at `providers/claude-activity.ts` so each provider can
 * own its own record-format translator. Existing callers
 * (`sessionHistory.ts`, the test suite, etc.) still import from
 * here unchanged — provider routing happens at the
 * `SessionProvider.parseActivities` boundary.
 */

export {
  getToolDetail,
  parseActivitiesFromLines,
  parseModelName,
} from "./providers/claude-activity.js";
