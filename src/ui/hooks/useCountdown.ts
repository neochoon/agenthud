import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface PanelInterval {
  interval: number | null; // ms, null = manual
}

interface UseCountdownOptions {
  panels: Record<string, PanelInterval>;
  customPanels?: Record<string, PanelInterval>;
  enabled: boolean;
}

interface UseCountdownResult {
  countdowns: Record<string, number | null>;
  reset: (panelName: string) => void;
  resetAll: () => void;
}

// Convert ms interval to seconds, or null for manual
function toSeconds(intervalMs: number | null): number | null {
  if (intervalMs === null) return null;
  return Math.floor(intervalMs / 1000);
}

export function useCountdown({
  panels,
  customPanels,
  enabled,
}: UseCountdownOptions): UseCountdownResult {
  // Build initial countdowns from intervals
  const initialCountdowns = useMemo(() => {
    const result: Record<string, number | null> = {};

    for (const [name, config] of Object.entries(panels)) {
      result[name] = toSeconds(config.interval);
    }

    if (customPanels) {
      for (const [name, config] of Object.entries(customPanels)) {
        result[name] = toSeconds(config.interval);
      }
    }

    return result;
  }, [panels, customPanels]);

  // Store interval values for reset
  const intervalSeconds = useMemo(() => {
    const result: Record<string, number | null> = {};

    for (const [name, config] of Object.entries(panels)) {
      result[name] = toSeconds(config.interval);
    }

    if (customPanels) {
      for (const [name, config] of Object.entries(customPanels)) {
        result[name] = toSeconds(config.interval);
      }
    }

    return result;
  }, [panels, customPanels]);

  const [countdowns, setCountdowns] =
    useState<Record<string, number | null>>(initialCountdowns);

  // Keep ref to latest intervalSeconds to avoid stale closures
  const intervalSecondsRef = useRef(intervalSeconds);
  intervalSecondsRef.current = intervalSeconds;

  // Tick every second when enabled
  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(() => {
      setCountdowns((prev) => {
        const next: Record<string, number | null> = {};

        for (const [name, value] of Object.entries(prev)) {
          if (value === null) {
            // Manual panel - stays null
            next[name] = null;
          } else if (value > 1) {
            // Decrement but stop at 1
            next[name] = value - 1;
          } else {
            // Already at 1, stay at 1
            next[name] = 1;
          }
        }

        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [enabled]);

  // Reset single panel countdown
  const reset = useCallback((panelName: string) => {
    const interval = intervalSecondsRef.current[panelName];
    if (interval === null || interval === undefined) return;

    setCountdowns((prev) => ({
      ...prev,
      [panelName]: interval,
    }));
  }, []);

  // Reset all panel countdowns
  const resetAll = useCallback(() => {
    setCountdowns((prev) => {
      const next: Record<string, number | null> = {};

      for (const name of Object.keys(prev)) {
        const interval = intervalSecondsRef.current[name];
        next[name] = interval ?? prev[name];
      }

      return next;
    });
  }, []);

  return {
    countdowns,
    reset,
    resetAll,
  };
}
