import { useEffect, useState } from "react";

/**
 * Monotonic counter that increments every `intervalMs` while `active` is
 * true. Stops (freezes the value) when `active` flips to false. Use the
 * returned integer with `% N` to drive any sliding / sweeping animation
 * whose period depends on per-frame content.
 *
 * Distinct from `useSpinner` (which returns a glyph) so we can drive an
 * animation whose modulus changes per row (e.g. a flashlight sweep
 * scaled to the row's character width).
 */
export function useTick(active: boolean, intervalMs = 100): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN((x) => x + 1), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return n;
}
