// Time constants (in milliseconds)
export const THIRTY_SECONDS_MS = 30 * 1000;
export const FIVE_MINUTES_MS = 5 * 60 * 1000;

// Default panel width (can be overridden via config)
export const DEFAULT_PANEL_WIDTH = 70;

// Terminal width limits
export const MIN_TERMINAL_WIDTH = 50;
export const MAX_TERMINAL_WIDTH = 120;
export const DEFAULT_FALLBACK_WIDTH = 80;

// For testing - allows mocking process.stdout.columns
let stdoutColumnsFn: () => number | undefined = () => process.stdout.columns;

export function setStdoutColumnsFn(fn: () => number | undefined): void {
  stdoutColumnsFn = fn;
}

export function resetStdoutColumnsFn(): void {
  stdoutColumnsFn = () => process.stdout.columns;
}

/**
 * Get terminal width with min/max limits.
 * Returns the terminal width capped at MAX_TERMINAL_WIDTH (120),
 * with a minimum of MIN_TERMINAL_WIDTH (50).
 * Falls back to DEFAULT_FALLBACK_WIDTH (80) if detection fails.
 */
export function getTerminalWidth(): number {
  const columns = stdoutColumnsFn();
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
export function createTitleLine(label: string, suffix: string = "", panelWidth: number = DEFAULT_PANEL_WIDTH): string {
  const leftPart = BOX.h + " " + label + " ";
  const rightPart = suffix ? " " + suffix + " " + BOX.h : "";
  // Use display width for suffix since it may contain emojis
  const leftWidth = leftPart.length;
  const rightWidth = suffix ? 1 + getDisplayWidth(suffix) + 1 + 1 : 0; // space + suffix + space + dash
  const dashCount = panelWidth - 1 - leftWidth - rightWidth - 1;
  const dashes = BOX.h.repeat(Math.max(0, dashCount));
  return BOX.tl + leftPart + dashes + rightPart + BOX.tr;
}

// Create bottom line
export function createBottomLine(panelWidth: number = DEFAULT_PANEL_WIDTH): string {
  return BOX.bl + BOX.h.repeat(getInnerWidth(panelWidth)) + BOX.br;
}

// Create separator line with title (for sub-sections)
// Example: "├─ Todo (3/6) ──────────────────────────────────────┤"
export function createSeparatorLine(title: string, panelWidth: number = DEFAULT_PANEL_WIDTH): string {
  const leftPart = BOX.h + " " + title + " ";
  const leftWidth = leftPart.length;
  const dashCount = panelWidth - 1 - leftWidth - 1; // ml + leftPart + dashes + mr
  const dashes = BOX.h.repeat(Math.max(0, dashCount));
  return BOX.ml + leftPart + dashes + BOX.mr;
}

// Pad content to fit inner width (content goes between │ and │)
export function padLine(content: string, panelWidth: number = DEFAULT_PANEL_WIDTH): string {
  const innerWidth = getInnerWidth(panelWidth);
  const padding = innerWidth - content.length;
  return content + " ".repeat(Math.max(0, padding));
}

// Separator line for content area
export function createSeparator(panelWidth: number = DEFAULT_PANEL_WIDTH): string {
  return "─".repeat(getContentWidth(panelWidth));
}

// Legacy separator (for backward compatibility)
export const SEPARATOR = "─".repeat(CONTENT_WIDTH);

// Truncate text to fit within max length, adding "..." if needed
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

// Use string-width for accurate terminal width calculation
import stringWidth from "string-width";
export const getDisplayWidth = stringWidth;
