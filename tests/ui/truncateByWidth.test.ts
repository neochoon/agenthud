import { describe, expect, it } from "vitest";
import { truncateByWidth } from "../../src/ui/constants.js";

describe("truncateByWidth", () => {
  it("returns input unchanged when it fits", () => {
    expect(truncateByWidth("hello", 10)).toBe("hello");
  });

  it("returns input unchanged when width exactly matches", () => {
    expect(truncateByWidth("hello", 5)).toBe("hello");
  });

  it("appends an ellipsis (1 cell) when truncated", () => {
    // "hello world" is 11 cells; cap at 6 -> "hello…" (5 chars + "…" = 6).
    expect(truncateByWidth("hello world", 6)).toBe("hello…");
  });

  it("keeps the beginning, not the end", () => {
    expect(truncateByWidth("the quick brown fox", 9)).toBe("the quic…");
  });

  it("counts CJK characters as width 2", () => {
    // Each Korean syllable is 2 cells. "한국어테스트" is 12 cells; cap at 7
    // means we can fit 3 syllables (6 cells) + "…" (1 cell) = 7 cells total.
    expect(truncateByWidth("한국어테스트", 7)).toBe("한국어…");
  });

  it("returns just the ellipsis when width is 1", () => {
    expect(truncateByWidth("anything long", 1)).toBe("…");
  });

  it("returns empty string when width is 0 or negative", () => {
    expect(truncateByWidth("anything", 0)).toBe("");
    expect(truncateByWidth("anything", -3)).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(truncateByWidth("", 10)).toBe("");
  });

  it("does not split a wide-char glyph mid-cell", () => {
    // Cap at 6 cells with mixed ASCII + Korean: "ab한국" is 2 + 4 = 6 cells.
    // At cap 5 we should NOT include the second Korean char (would overflow).
    expect(truncateByWidth("ab한국xy", 5)).toBe("ab한…");
  });
});
