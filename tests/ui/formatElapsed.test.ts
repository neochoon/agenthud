import { describe, expect, it } from "vitest";
import { formatElapsed } from "../../src/ui/SessionTreePanel.js";

// Pin "now" so the test isn't timing-dependent.
const NOW = 1_700_000_000_000; // arbitrary fixed timestamp
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatElapsed", () => {
  it("returns <1s when the session was just touched", () => {
    expect(formatElapsed(NOW, NOW)).toBe("<1s");
  });

  it("returns Ns for sub-minute elapsed", () => {
    expect(formatElapsed(NOW - 5 * SEC, NOW)).toBe("5s");
  });

  it("returns Nm for sub-hour elapsed", () => {
    expect(formatElapsed(NOW - 7 * MIN, NOW)).toBe("7m");
  });

  it("returns Nh (no minutes) under a day", () => {
    expect(formatElapsed(NOW - (2 * HOUR + 30 * MIN), NOW)).toBe("2h");
    expect(formatElapsed(NOW - (17 * HOUR + 6 * MIN), NOW)).toBe("17h");
  });

  it("returns Nd at the 24h+ mark instead of NhMm", () => {
    expect(formatElapsed(NOW - 25 * HOUR, NOW)).toBe("1d");
    expect(formatElapsed(NOW - 3 * DAY, NOW)).toBe("3d");
    expect(formatElapsed(NOW - 6 * DAY, NOW)).toBe("6d");
  });

  it("returns Nw once a week has passed", () => {
    expect(formatElapsed(NOW - 7 * DAY, NOW)).toBe("1w");
    expect(formatElapsed(NOW - 21 * DAY, NOW)).toBe("3w");
  });

  it("returns Nmo once a month has passed (30-day buckets)", () => {
    expect(formatElapsed(NOW - 30 * DAY, NOW)).toBe("1mo");
    expect(formatElapsed(NOW - 90 * DAY, NOW)).toBe("3mo");
  });

  it("returns Ny once a year has passed", () => {
    expect(formatElapsed(NOW - 365 * DAY, NOW)).toBe("1y");
    expect(formatElapsed(NOW - 2 * 365 * DAY, NOW)).toBe("2y");
  });

  it("clamps negative elapsed (future timestamp) to <1s", () => {
    expect(formatElapsed(NOW + 5 * SEC, NOW)).toBe("<1s");
  });
});
