import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../../../src/types/index.js";
import { activityMatches } from "../../../src/ui/search/activityMatch.js";

const a = (label: string, detail: string): ActivityEntry => ({
  timestamp: new Date(0),
  type: "tool",
  icon: "$",
  label,
  detail,
});

describe("activityMatches", () => {
  const acts = [
    a("Bash", "npm test"),
    a("Read", "auth.ts"),
    a("Edit", "main.ts"),
  ];
  it("matches label or one-line detail (smart-case)", () => {
    expect(activityMatches(acts, "auth")).toEqual([1]); // detail
    expect(activityMatches(acts, "edit")).toEqual([2]); // label
  });
  it("empty query → no matches", () => {
    expect(activityMatches(acts, "")).toEqual([]);
  });
});
