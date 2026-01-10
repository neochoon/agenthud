// Panel width in characters (excluding border)
// 60 provides good readability without being too wide
export const PANEL_WIDTH = 60;

// Content width (panel width - borders - padding)
export const CONTENT_WIDTH = PANEL_WIDTH - 4;

// Inner width (panel width - left and right borders)
export const INNER_WIDTH = PANEL_WIDTH - 2;

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
export function createTitleLine(label: string, suffix: string = ""): string {
  const leftPart = BOX.h + " " + label + " ";
  const rightPart = suffix ? " " + suffix + " " + BOX.h : "";
  const dashCount = PANEL_WIDTH - 1 - leftPart.length - rightPart.length - 1;
  const dashes = BOX.h.repeat(Math.max(0, dashCount));
  return BOX.tl + leftPart + dashes + rightPart + BOX.tr;
}

// Create bottom line
export function createBottomLine(): string {
  return BOX.bl + BOX.h.repeat(INNER_WIDTH) + BOX.br;
}

// Pad content to fit inner width (content goes between │ and │)
export function padLine(content: string): string {
  const padding = INNER_WIDTH - content.length;
  return content + " ".repeat(Math.max(0, padding));
}

// Separator line for content area
export const SEPARATOR = "─".repeat(CONTENT_WIDTH);

// Truncate text to fit within max length, adding "..." if needed
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}
