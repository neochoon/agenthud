// Default panel width (can be overridden via config)
export const DEFAULT_PANEL_WIDTH = 70;

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

/**
 * Calculate the display width of a string in the terminal.
 * Emojis typically display as 2 characters wide.
 */
export function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0) || 0;
    // Emoji ranges
    if (
      (code >= 0x1f300 && code <= 0x1f9ff) || // Misc symbols, emoticons, etc.
      (code >= 0x2600 && code <= 0x26ff) || // Misc symbols
      (code >= 0x2700 && code <= 0x27bf) || // Dingbats (includes ✏)
      (code >= 0x1f600 && code <= 0x1f64f) || // Emoticons
      (code >= 0x1f680 && code <= 0x1f6ff) // Transport symbols
    ) {
      width += 2;
    } else if (code === 0xfe0f) {
      // Variation selector - skip (already counted in base emoji)
      continue;
    } else if (
      // CJK characters (Korean, Chinese, Japanese) - 2 wide
      (code >= 0xac00 && code <= 0xd7af) || // Korean Hangul syllables
      (code >= 0x1100 && code <= 0x11ff) || // Korean Hangul Jamo
      (code >= 0x3130 && code <= 0x318f) || // Korean Hangul Compatibility Jamo
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
      (code >= 0x3000 && code <= 0x303f) || // CJK Symbols
      (code >= 0xff00 && code <= 0xffef) // Fullwidth forms
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}
