import { useCallback, useEffect, useRef, useState } from "react";

export interface VisualFeedback {
  isRunning: boolean;
  justRefreshed: boolean;
  justCompleted: boolean;
}

const DEFAULT_VISUAL_STATE: VisualFeedback = {
  isRunning: false,
  justRefreshed: false,
  justCompleted: false,
};

const FEEDBACK_DURATION = 1500; // 1.5 seconds

interface UseVisualFeedbackOptions {
  panels: string[];
}

interface UseVisualFeedbackResult {
  states: Record<string, VisualFeedback>;
  setRunning: (panel: string, running: boolean) => void;
  setRefreshed: (panel: string) => void;
  setCompleted: (panel: string) => void;
  startAsync: (panel: string) => void;
  endAsync: (panel: string, opts?: { completed?: boolean }) => void;
  getState: (panel: string) => VisualFeedback;
}

export function useVisualFeedback({
  panels,
}: UseVisualFeedbackOptions): UseVisualFeedbackResult {
  // Initialize states for all panels
  const [states, setStates] = useState<Record<string, VisualFeedback>>(() => {
    const initial: Record<string, VisualFeedback> = {};
    for (const panel of panels) {
      initial[panel] = { ...DEFAULT_VISUAL_STATE };
    }
    return initial;
  });

  // Track timeouts for cleanup
  const timeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      for (const timeout of timeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      timeoutsRef.current.clear();
    };
  }, []);

  // Helper to update a single panel's state
  const updateState = useCallback(
    (panel: string, update: Partial<VisualFeedback>) => {
      setStates((prev) => ({
        ...prev,
        [panel]: { ...(prev[panel] || DEFAULT_VISUAL_STATE), ...update },
      }));
    },
    [],
  );

  // Helper to schedule auto-clear of a feedback flag
  const scheduleAutoClear = useCallback(
    (panel: string, key: keyof VisualFeedback) => {
      // Clear existing timeout for this panel+key combo
      const timeoutKey = `${panel}:${key}`;
      const existingTimeout = timeoutsRef.current.get(timeoutKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Schedule new timeout
      const timeout = setTimeout(() => {
        updateState(panel, { [key]: false });
        timeoutsRef.current.delete(timeoutKey);
      }, FEEDBACK_DURATION);

      timeoutsRef.current.set(timeoutKey, timeout);
    },
    [updateState],
  );

  // Set isRunning state
  const setRunning = useCallback(
    (panel: string, running: boolean) => {
      updateState(panel, { isRunning: running });
    },
    [updateState],
  );

  // Set justRefreshed with auto-clear
  const setRefreshed = useCallback(
    (panel: string) => {
      updateState(panel, { justRefreshed: true });
      scheduleAutoClear(panel, "justRefreshed");
    },
    [updateState, scheduleAutoClear],
  );

  // Set justCompleted with auto-clear
  const setCompleted = useCallback(
    (panel: string) => {
      updateState(panel, { justCompleted: true });
      scheduleAutoClear(panel, "justCompleted");
    },
    [updateState, scheduleAutoClear],
  );

  // Start async operation
  const startAsync = useCallback(
    (panel: string) => {
      setRunning(panel, true);
    },
    [setRunning],
  );

  // End async operation
  const endAsync = useCallback(
    (panel: string, opts?: { completed?: boolean }) => {
      setRunning(panel, false);
      if (opts?.completed) {
        setCompleted(panel);
      } else {
        setRefreshed(panel);
      }
    },
    [setRunning, setRefreshed, setCompleted],
  );

  // Get state for a panel (returns default if unknown)
  const getState = useCallback(
    (panel: string): VisualFeedback => {
      return states[panel] || { ...DEFAULT_VISUAL_STATE };
    },
    [states],
  );

  return {
    states,
    setRunning,
    setRefreshed,
    setCompleted,
    startAsync,
    endAsync,
    getState,
  };
}
