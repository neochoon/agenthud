/**
 * Shared UI constants — time thresholds, panel widths, terminal
 * limits, box-drawing characters — plus the display-width helpers
 * (`getDisplayWidth`, `getInnerWidth`, `createTitleLine`,
 * `createBottomLine`) used by every panel for borders and
 * truncation.
 *
 * Design decision:
 * - `getDisplayWidth` is memoized across calls. Without
 *   memoization, repeated `stringWidth` invocations on the same
 *   string across renders cost ~17% CPU on a 60-row tree
 *   (measured in v0.9.0). The cache survives renders and is
 *   stable across the process lifetime — no invalidation needed
 *   since string display width is a pure function.
 *
 * Gotcha:
 * - `THIRTY_MINUTES_MS` and `ONE_HOUR_MS` are imported by
 *   `src/data/sessions.ts` and `src/data/sessionLiveness.ts` —
 *   a data → ui layer violation flagged in those files. The
 *   constants should move to `src/utils/timeConstants.ts` (or
 *   live on `types/index.ts`) on a future refactor; keeping them
 *   here for now to avoid mixing the move with unrelated work.
 */

// Time constants (in milliseconds)
export const THIRTY_SECONDS_MS = 30 * 1000;
export const THIRTY_MINUTES_MS = 30 * 60 * 1000;
export const ONE_HOUR_MS = 60 * 60 * 1000;
export const FIVE_MINUTES_MS = 5 * 60 * 1000;

// Default panel width (can be overridden via config)
export const DEFAULT_PANEL_WIDTH = 70;

// Terminal width limits
export const MIN_TERMINAL_WIDTH = 50;
export const MAX_TERMINAL_WIDTH = 120;
export const DEFAULT_FALLBACK_WIDTH = 80;

/**
 * Get terminal width with min/max limits.
 * Returns the terminal width capped at MAX_TERMINAL_WIDTH (120),
 * with a minimum of MIN_TERMINAL_WIDTH (50).
 * Falls back to DEFAULT_FALLBACK_WIDTH (80) if detection fails.
 */
export function getTerminalWidth(): number {
  const columns = process.stdout.columns;
  if (!columns || columns <= 0) {
    return DEFAULT_FALLBACK_WIDTH;
  }
  return Math.min(Math.max(columns, MIN_TERMINAL_WIDTH), MAX_TERMINAL_WIDTH);
}

// Legacy exports for backward compatibility (use functions with width param for new code)
export const PANEL_WIDTH = DEFAULT_PANEL_WIDTH;
export const CONTENT_WIDTH = DEFAULT_PANEL_WIDTH - 4;
export const INNER_WIDTH = DEFAULT_PANEL_WIDTH - 2;

// Calculate widths based on panel width
export function getContentWidth(panelWidth: number): number {
  return panelWidth - 4;
}

export function getInnerWidth(panelWidth: number): number {
  return panelWidth - 2;
}

// Box drawing characters
export const BOX = {
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
  h: "─",
  v: "│",
  ml: "├",
  mr: "┤",
};

// Create a title line with label on left and suffix on right
// Example: "┌─ Git ───────────────────────────────── ↻ 25s ─┐"
export function createTitleLine(
  label: string,
  suffix: string = "",
  panelWidth: number = DEFAULT_PANEL_WIDTH,
): string {
  const leftPart = `${BOX.h} ${label} `;
  const rightPart = suffix ? ` ${suffix} ${BOX.h}` : "";
  // Use display width for both parts to handle special characters correctly
  const leftWidth = getDisplayWidth(leftPart);
  const rightWidth = suffix ? getDisplayWidth(rightPart) : 0;
  const dashCount = panelWidth - 1 - leftWidth - rightWidth - 1;
  const dashes = BOX.h.repeat(Math.max(0, dashCount));
  return BOX.tl + leftPart + dashes + rightPart + BOX.tr;
}

// Create bottom line
export function createBottomLine(
  panelWidth: number = DEFAULT_PANEL_WIDTH,
): string {
  return BOX.bl + BOX.h.repeat(getInnerWidth(panelWidth)) + BOX.br;
}

// Create separator line with title (for sub-sections)
// Example: "├─ Todo (3/6) ──────────────────────────────────────┤"
export function createSeparatorLine(
  title: string,
  panelWidth: number = DEFAULT_PANEL_WIDTH,
): string {
  const leftPart = `${BOX.h} ${title} `;
  const leftWidth = leftPart.length;
  const dashCount = panelWidth - 1 - leftWidth - 1; // ml + leftPart + dashes + mr
  const dashes = BOX.h.repeat(Math.max(0, dashCount));
  return BOX.ml + leftPart + dashes + BOX.mr;
}

// Pad content to fit inner width (content goes between │ and │)
export function padLine(
  content: string,
  panelWidth: number = DEFAULT_PANEL_WIDTH,
): string {
  const innerWidth = getInnerWidth(panelWidth);
  const padding = innerWidth - content.length;
  return content + " ".repeat(Math.max(0, padding));
}

// Separator line for content area
export function createSeparator(
  panelWidth: number = DEFAULT_PANEL_WIDTH,
): string {
  return "─".repeat(getContentWidth(panelWidth));
}

// Legacy separator (for backward compatibility)
export const SEPARATOR = "─".repeat(CONTENT_WIDTH);

// Truncate text to fit within max length, adding "..." if needed
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Truncate `text` so its terminal display width fits in `maxWidth` cells,
 * keeping the *beginning* and appending a single-cell ellipsis ("…") when
 * trimmed. Iterates code points (not UTF-16 units) and measures each one
 * with `getDisplayWidth` so CJK / emoji boundaries are respected.
 *
 * Use this for prose-shaped content (task descriptions, prompts, etc.).
 * For path-shaped content where the tail is the important part, use a
 * path-aware truncator instead.
 */
export function truncateByWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (getDisplayWidth(text) <= maxWidth) return text;
  if (maxWidth === 1) return "…";
  const ellipsisWidth = 1;
  let acc = "";
  let used = 0;
  for (const ch of text) {
    const w = getDisplayWidth(ch);
    if (used + w + ellipsisWidth > maxWidth) break;
    acc += ch;
    used += w;
  }
  return `${acc}…`;
}

// Use string-width for accurate terminal width calculation.
// Cached because stringWidth runs Unicode regex (emoji, wide chars) which is
// expensive — and we call it with the same icons/labels thousands of times per
// second during re-renders. CPU profiling showed it at ~17% of total runtime.
import stringWidth from "string-width";

const widthCache = new Map<string, number>();
export function getDisplayWidth(s: string): number {
  const cached = widthCache.get(s);
  if (cached !== undefined) return cached;
  const w = stringWidth(s);
  widthCache.set(s, w);
  return w;
}
