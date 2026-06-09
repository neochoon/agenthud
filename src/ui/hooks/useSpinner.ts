/**
 * Cycle through braille spinner frames at a fixed interval while
 * `active` is true. Returns the current frame glyph, or an empty
 * string when inactive.
 *
 * Design decision:
 * - Inactive returns `""` (not `null`/`undefined` or a static
 *   glyph) so the consumer can splice it into JSX without
 *   conditional rendering: `<Text>{spinner}{label}</Text>` reads
 *   the same active or inactive, and the layout doesn't reflow
 *   when the spinner stops.
 */

import { useEffect, useState } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function useSpinner(active: boolean, intervalMs = 100): string {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % FRAMES.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);

  return active ? FRAMES[index] : "";
}
