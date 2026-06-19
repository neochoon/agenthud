import { describe, expect, it } from "vitest";
import { compareVersions, versionGte } from "../../src/data/version.js";

describe("compareVersions", () => {
  it("equal versions compare 0", () => {
    expect(compareVersions("2.1.148", "2.1.148")).toBe(0);
  });
  it("compares numerically, not lexically (2.9 < 2.10)", () => {
    expect(compareVersions("2.9", "2.10")).toBe(-1);
    expect(compareVersions("2.10", "2.9")).toBe(1);
  });
  it("a shorter prefix is less than its extension (2.1 < 2.1.1)", () => {
    expect(compareVersions("2.1", "2.1.1")).toBe(-1);
  });
  it("undefined / empty sorts as the lowest", () => {
    expect(compareVersions(undefined, "2.1")).toBe(-1);
    expect(compareVersions("2.1", undefined)).toBe(1);
    expect(compareVersions(undefined, undefined)).toBe(0);
    expect(compareVersions("", "0")).toBe(0);
  });
  it("non-numeric segments count as 0 (never throws)", () => {
    expect(compareVersions("vx", "2")).toBe(-1);
    expect(compareVersions("1.x", "1.0")).toBe(0);
  });
});

describe("versionGte", () => {
  it("true when equal or greater, false when less", () => {
    expect(versionGte("2.2.0", "2.2.0")).toBe(true);
    expect(versionGte("2.3.0", "2.2.0")).toBe(true);
    expect(versionGte("2.1.0", "2.2.0")).toBe(false);
    expect(versionGte(undefined, "2.2.0")).toBe(false);
  });
});
