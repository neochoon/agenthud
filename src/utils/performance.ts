import { performance } from "node:perf_hooks";

const DEFAULT_CLEANUP_INTERVAL = 60000; // 60 seconds

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Clear all performance marks and measures to prevent memory leaks.
 * This prevents the "Possible perf_hooks memory leak detected" warning
 * that occurs when the performance entry buffer exceeds its limit.
 */
export function clearPerformanceEntries(): void {
  performance.clearMarks();
  performance.clearMeasures();
}

/**
 * Start periodic cleanup of performance entries.
 * @param intervalMs - Cleanup interval in milliseconds (default: 60000)
 */
export function startPerformanceCleanup(
  intervalMs: number = DEFAULT_CLEANUP_INTERVAL,
): void {
  if (cleanupInterval !== null) {
    clearInterval(cleanupInterval);
  }

  cleanupInterval = setInterval(() => {
    clearPerformanceEntries();
  }, intervalMs);
}

/**
 * Stop the periodic performance cleanup.
 */
export function stopPerformanceCleanup(): void {
  if (cleanupInterval !== null) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
