import { useEffect, useState } from "react";

/**
 * Returns the current Date, ticking on a fixed interval so consumers
 * re-render. Default cadence is 1 second — enough for an HH:MM:SS
 * display without burning cycles.
 */
export function useClock(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
