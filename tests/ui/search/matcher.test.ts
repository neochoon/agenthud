import { describe, expect, it } from "vitest";
import {
  hasMatch,
  isCaseSensitive,
  matchRanges,
} from "../../../src/ui/search/matcher.js";

describe("isCaseSensitive (smart-case)", () => {
  it("all-lowercase query → case-insensitive (false)", () => {
    expect(isCaseSensitive("auth")).toBe(false);
  });
  it("any uppercase → case-sensitive (true)", () => {
    expect(isCaseSensitive("Auth")).toBe(true);
  });
});

describe("matchRanges", () => {
  it("empty query → no ranges", () => {
    expect(matchRanges("anything", "")).toEqual([]);
  });
  it("smart-case: lowercase query matches any case", () => {
    expect(matchRanges("Auth and AUTH", "auth")).toEqual([
      { start: 0, end: 4 },
      { start: 9, end: 13 },
    ]);
  });
  it("smart-case: uppercase query is case-sensitive", () => {
    expect(matchRanges("Auth and auth", "Auth")).toEqual([
      { start: 0, end: 4 },
    ]);
  });
  it("returns non-overlapping ranges left to right", () => {
    expect(matchRanges("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });
  it("no match → empty", () => {
    expect(matchRanges("abc", "xyz")).toEqual([]);
  });
});

describe("hasMatch", () => {
  it("true on substring hit, false on miss/empty", () => {
    expect(hasMatch("activityParser", "Parser")).toBe(true); // smart-case sensitive
    expect(hasMatch("activityParser", "parser")).toBe(true); // insensitive
    expect(hasMatch("activityParser", "zzz")).toBe(false);
    expect(hasMatch("x", "")).toBe(false);
  });
});
