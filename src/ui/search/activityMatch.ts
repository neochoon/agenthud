import type { ActivityEntry } from "../../types/index.js";
import { hasMatch } from "./matcher.js";

/** Indices of activities whose label or one-line detail match `query`
 * (smart-case). The multi-line detailBody is intentionally NOT searched
 * here — that is the Detail View's job. Empty for an empty query. */
export function activityMatches(
  activities: ActivityEntry[],
  query: string,
): number[] {
  if (!query) return [];
  const out: number[] = [];
  for (let i = 0; i < activities.length; i++) {
    const a = activities[i];
    if (hasMatch(a.label, query) || hasMatch(a.detail, query)) out.push(i);
  }
  return out;
}
