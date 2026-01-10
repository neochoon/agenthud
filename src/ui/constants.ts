// Panel width in characters (excluding border)
// 60 provides good readability without being too wide
export const PANEL_WIDTH = 60;

// Content width (panel width - borders - padding)
export const CONTENT_WIDTH = PANEL_WIDTH - 4;

// Separator line for content area
export const SEPARATOR = "─".repeat(CONTENT_WIDTH);

// Truncate text to fit within max length, adding "..." if needed
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}
