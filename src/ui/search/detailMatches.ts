import { hasMatch } from "./matcher.js";

/** Indices of body lines that contain a match for `query`, in order.
 * Drives the Detail View's `n`/`N` jump. Empty for an empty query. */
export function detailMatchLines(lines: string[], query: string): number[] {
  if (!query) return [];
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (hasMatch(lines[i], query)) out.push(i);
  }
  return out;
}
