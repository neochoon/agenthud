import { describe, expect, it } from "vitest";
import { parseSince } from "../../src/data/followSince.js";

const NOW = 1_000_000_000_000;

describe("parseSince", () => {
  it("now → sinceMs === now (no backfill)", () => {
    expect(parseSince("now", NOW)).toEqual({ sinceMs: NOW });
  });
  it("Nh / Nm → relative backfill", () => {
    expect(parseSince("2h", NOW)).toEqual({ sinceMs: NOW - 2 * 3600_000 });
    expect(parseSince("30m", NOW)).toEqual({ sinceMs: NOW - 30 * 60_000 });
  });
  it("Ns → relative backfill in seconds", () => {
    expect(parseSince("60s", NOW)).toEqual({ sinceMs: NOW - 60 * 1000 });
    expect(parseSince("90s", NOW)).toEqual({ sinceMs: NOW - 90_000 });
  });
  it("undefined defaults to now", () => {
    expect(parseSince(undefined, NOW)).toEqual({ sinceMs: NOW });
  });
  it("invalid → error", () => {
    expect(parseSince("banana", NOW)).toHaveProperty("error");
    expect(parseSince("2x", NOW)).toHaveProperty("error");
  });
});
