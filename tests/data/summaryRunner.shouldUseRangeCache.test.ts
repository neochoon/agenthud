import { describe, expect, it } from "vitest";
import { shouldUseRangeCache } from "../../src/data/summaryRunner.js";

function date(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d);
}

describe("shouldUseRangeCache", () => {
  const today = date(2026, 5, 17);
  const past3Days = [date(2026, 5, 11), date(2026, 5, 12), date(2026, 5, 13)];
  const lastWeekIncludingToday = [
    date(2026, 5, 11),
    date(2026, 5, 12),
    date(2026, 5, 13),
    date(2026, 5, 14),
    date(2026, 5, 15),
    date(2026, 5, 16),
    date(2026, 5, 17),
  ];

  it("returns true for past-only range with existing cache and no --force", () => {
    expect(shouldUseRangeCache(false, past3Days, today, true)).toBe(true);
  });

  it("returns false when --force is set even with cache and past-only range", () => {
    expect(shouldUseRangeCache(true, past3Days, today, true)).toBe(false);
  });

  it("returns false when cache file does not exist", () => {
    expect(shouldUseRangeCache(false, past3Days, today, false)).toBe(false);
  });

  it("returns false when today is in the range (bug fix: stale cache)", () => {
    // Regression: previously the cache was returned even when today was in
    // the range, but today's activity grows throughout the day so the
    // cached summary is necessarily stale.
    expect(
      shouldUseRangeCache(false, lastWeekIncludingToday, today, true),
    ).toBe(false);
  });

  it("returns false when only today is in the range", () => {
    expect(shouldUseRangeCache(false, [today], today, true)).toBe(false);
  });
});
