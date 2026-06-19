/**
 * `--since` parsing for `agenthud follow` (Phase 1): `now` (default)
 * and relative `<N>h` / `<N>m` / `<N>s`. HH:MM / ISO / `last` are deferred.
 */

export type SinceResult = { sinceMs: number } | { error: string };

const UNIT_MS: Record<string, number> = { h: 3600_000, m: 60_000, s: 1000 };

/** Phase 1: `now` (default) and relative `<N>h` / `<N>m` / `<N>s`.
 * (HH:MM / ISO / `last` are deferred — see the plan's Deferred section.) */
export function parseSince(spec: string | undefined, now: number): SinceResult {
  if (!spec || spec === "now") return { sinceMs: now };
  const m = spec.match(/^(\d+)([hms])$/);
  if (!m) {
    return { error: `Invalid --since: ${spec} (use now, <N>h, <N>m, or <N>s)` };
  }
  const n = Number.parseInt(m[1], 10);
  return { sinceMs: now - n * UNIT_MS[m[2]] };
}
