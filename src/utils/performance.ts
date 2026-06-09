/**
 * Periodic cleanup of `performance.mark` / `performance.measure`
 * entries. Dodges the "Possible perf_hooks memory leak detected"
 * Node warning that fires when the buffer exceeds its default
 * limit (10k entries).
 *
 * Design decision:
 * - Run as an opt-in background interval owned by the App; safe
 *   to call `stopPerformanceCleanup` more than once (clears the
 *   handle and re-nulls it). Default 60s interval is tuned to
 *   stay well under the buffer limit even on hot Ink renders.
 *
 * Gotcha:
 * - `src/index.ts` pins `NODE_ENV=production` precisely to stop
 *   React from emitting per-render perf marks (the v0.9.0
 *   ~600KB/s leak). Even with that, some deps still emit marks
 *   at runtime — the buffer fills more slowly but eventually
 *   trips the warning if uncleared. This cleanup is the
 *   belt-and-braces for the env pin.
 */

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
