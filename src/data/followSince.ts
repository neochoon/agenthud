/**
 * `--since` parsing for `agenthud follow` (Phase 1): `now` (default)
 * and relative `<N>h` / `<N>m`. HH:MM / ISO / `last` are deferred.
 */

export type SinceResult = { sinceMs: number } | { error: string };

/** Phase 1: `now` (default) and relative `<N>h` / `<N>m`.
 * (HH:MM / ISO / `last` are deferred — see the plan's Deferred section.) */
export function parseSince(spec: string | undefined, now: number): SinceResult {
  if (!spec || spec === "now") return { sinceMs: now };
  const m = spec.match(/^(\d+)([hm])$/);
  if (!m) return { error: `Invalid --since: ${spec} (use now, <N>h, or <N>m)` };
  const n = Number.parseInt(m[1], 10);
  const unitMs = m[2] === "h" ? 3600_000 : 60_000;
  return { sinceMs: now - n * unitMs };
}
