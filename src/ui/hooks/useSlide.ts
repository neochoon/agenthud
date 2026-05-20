import { useEffect, useState } from "react";

/**
 * Returns an integer position in [0, positions) that advances on every
 * `intervalMs` tick while `active` is true, wrapping back to 0. When
 * `active` is false, the position freezes (and stays at whatever it
 * last was — typically 0 since we initialize there).
 *
 * Used by the activity viewer's live-edge indicator: an arrow slides
 * across a fixed window of cells while the viewer is in LIVE mode and
 * the app is in watch mode.
 */
export function useSlide(
  active: boolean,
  positions: number,
  intervalMs = 180,
): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % positions);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [active, positions, intervalMs]);

  return index;
}
