/**
 * Monotonic frame counter that increments every `intervalMs` while
 * `active` is true; freezes the value when `active` flips to false.
 *
 * Design decision:
 * - Distinct from `useSpinner` (which returns a glyph) because
 *   some animations — a flashlight sweep, a sliding cursor — have
 *   a modulus that depends on per-row content (e.g. the row's
 *   character width). Returning a raw integer lets callers do
 *   `% N` where `N` varies per render.
 */

import { useEffect, useState } from "react";

export function useTick(active: boolean, intervalMs = 100): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN((x) => x + 1), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return n;
}
