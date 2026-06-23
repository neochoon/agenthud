/**
 * Shared time durations in milliseconds.
 *
 * Lives in `utils/` (not `ui/`) because the consumers are the data layer —
 * session liveness and every provider's hot/warm staleness thresholds.
 * Keeping them here avoids a data → ui import.
 */

export const FIVE_MINUTES_MS = 5 * 60 * 1000;
export const THIRTY_MINUTES_MS = 30 * 60 * 1000;
export const ONE_HOUR_MS = 60 * 60 * 1000;
