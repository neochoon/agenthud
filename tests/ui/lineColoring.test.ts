import { describe, expect, it } from "vitest";
import {
  classifyCodeFences,
  classifyDiffLines,
  getLineStyle,
} from "../../src/ui/lineColoring.js";

describe("classifyDiffLines", () => {
  it("tags added lines (start with +) as diff-add", () => {
    expect(classifyDiffLines(["+const x = 1;"])).toEqual(["diff-add"]);
  });

  it("tags removed lines (start with -) as diff-remove", () => {
    expect(classifyDiffLines(["-const x = 1;"])).toEqual(["diff-remove"]);
  });

  it("tags hunk headers (@@ ... @@) as diff-hunk", () => {
    expect(classifyDiffLines(["@@ -10,3 +10,4 @@ function foo()"])).toEqual([
      "diff-hunk",
    ]);
  });

  it("tags +++ / --- file headers as diff-meta, NOT diff-add/remove", () => {
    expect(classifyDiffLines(["+++ b/src/foo.ts", "--- a/src/foo.ts"])).toEqual(
      ["diff-meta", "diff-meta"],
    );
  });

  it("tags 'diff --git', 'index ', 'commit ', 'Author:', 'Date:' as diff-meta", () => {
    expect(
      classifyDiffLines([
        "diff --git a/foo b/foo",
        "index 1234..5678 100644",
        "commit abc1234",
        "Author: Foo <foo@example.com>",
        "Date:   2026-05-19",
      ]),
    ).toEqual([
      "diff-meta",
      "diff-meta",
      "diff-meta",
      "diff-meta",
      "diff-meta",
    ]);
  });

  it("tags plain content as prose", () => {
    expect(classifyDiffLines(["unchanged line", " context line"])).toEqual([
      "prose",
      "prose",
    ]);
  });

  it("classifies a small realistic diff block", () => {
    const lines = [
      "commit abc1234",
      "Author: Foo <foo@example.com>",
      "Date:   2026-05-19",
      "",
      "    Subject line",
      "",
      "diff --git a/x b/x",
      "index 0..1 100644",
      "--- a/x",
      "+++ b/x",
      "@@ -1,2 +1,3 @@",
      " context",
      "-old",
      "+new",
    ];
    expect(classifyDiffLines(lines)).toEqual([
      "diff-meta",
      "diff-meta",
      "diff-meta",
      "prose",
      "prose",
      "prose",
      "diff-meta",
      "diff-meta",
      "diff-meta",
      "diff-meta",
      "diff-hunk",
      "prose",
      "diff-remove",
      "diff-add",
    ]);
  });
});

describe("classifyCodeFences", () => {
  it("tags fence markers as code-fence and inner lines as code", () => {
    const lines = ["before", "```ts", "const x = 1;", "```", "after"];
    expect(classifyCodeFences(lines)).toEqual([
      "prose",
      "code-fence",
      "code",
      "code-fence",
      "prose",
    ]);
  });

  it("handles fences with no language tag", () => {
    expect(classifyCodeFences(["```", "x", "```"])).toEqual([
      "code-fence",
      "code",
      "code-fence",
    ]);
  });

  it("handles multiple separate fences", () => {
    const lines = ["```", "a", "```", "between", "```", "b", "```"];
    expect(classifyCodeFences(lines)).toEqual([
      "code-fence",
      "code",
      "code-fence",
      "prose",
      "code-fence",
      "code",
      "code-fence",
    ]);
  });

  it("treats unclosed fence as code until end-of-input", () => {
    expect(classifyCodeFences(["```ts", "let y = 2;", "still code"])).toEqual([
      "code-fence",
      "code",
      "code",
    ]);
  });

  it("ignores leading whitespace before fence marker", () => {
    expect(classifyCodeFences(["  ```ts", "x", "  ```"])).toEqual([
      "code-fence",
      "code",
      "code-fence",
    ]);
  });

  it("returns all prose when there are no fences", () => {
    expect(classifyCodeFences(["a", "b", "c"])).toEqual([
      "prose",
      "prose",
      "prose",
    ]);
  });
});

describe("getLineStyle", () => {
  it("returns green for diff-add", () => {
    expect(getLineStyle("diff-add")).toEqual({ color: "green" });
  });

  it("returns red for diff-remove", () => {
    expect(getLineStyle("diff-remove")).toEqual({ color: "red" });
  });

  it("returns cyan for diff-hunk", () => {
    expect(getLineStyle("diff-hunk")).toEqual({ color: "cyan" });
  });

  it("returns dim for diff-meta", () => {
    expect(getLineStyle("diff-meta")).toEqual({ dimColor: true });
  });

  it("returns cyan for code and code-fence", () => {
    expect(getLineStyle("code")).toEqual({ color: "cyan" });
    expect(getLineStyle("code-fence").color).toBeDefined();
  });

  it("returns empty style for prose", () => {
    expect(getLineStyle("prose")).toEqual({});
  });
});
