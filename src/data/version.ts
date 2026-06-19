/**
 * Compare provider CLI versions that use a dotted semver-ish scheme
 * (claude `2.1.148`, codex `0.139.0`). Not every provider uses this:
 * kiro is a `v1` schema tag, opencode is a migration id — they compare
 * their own way. So this is a helper for the semver providers, not a
 * mandated interface. `SessionNode.version` stays an opaque string.
 */
export function compareVersions(a?: string, b?: string): -1 | 0 | 1 {
  const pa = segments(a);
  const pb = segments(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** `a >= b` under {@link compareVersions}. Reads as `versionGte(v, "2.2.0")`. */
export function versionGte(a?: string, b?: string): boolean {
  return compareVersions(a, b) >= 0;
}

// "2.1.148" -> [2,1,148]. Missing/empty/non-numeric segments become 0
// so an unknown version sorts lowest and never takes a newer-version branch.
function segments(v?: string): number[] {
  if (!v) return [];
  return v.split(".").map((s) => {
    const n = Number.parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}
