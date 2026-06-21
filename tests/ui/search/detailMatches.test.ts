import { describe, expect, it } from "vitest";
import { detailMatchLines } from "../../../src/ui/search/detailMatches.js";

describe("detailMatchLines", () => {
  const lines = ["import foo", "const x = 1", "foo(x)", "done"];
  it("returns indices of lines containing the query (smart-case)", () => {
    expect(detailMatchLines(lines, "foo")).toEqual([0, 2]);
  });
  it("empty query → no matches", () => {
    expect(detailMatchLines(lines, "")).toEqual([]);
  });
  it("uppercase query is case-sensitive", () => {
    expect(detailMatchLines(["Foo", "foo"], "Foo")).toEqual([0]);
  });
});
