import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../../src/types/index.js";
import {
  DetailViewPanel,
  wrapClassified,
  wrapText,
} from "../../src/ui/DetailViewPanel.js";
import { classifyCodeFences } from "../../src/ui/lineColoring.js";

const makeActivity = (
  overrides: Partial<ActivityEntry> = {},
): ActivityEntry => ({
  timestamp: new Date("2025-01-15T10:23:45.000Z"),
  type: "thinking",
  icon: "…",
  label: "Thinking",
  detail:
    "I need to carefully analyze this problem and figure out the best approach.",
  ...overrides,
});

describe("DetailViewPanel", () => {
  it("renders the label in the title", () => {
    const { lastFrame } = render(
      <DetailViewPanel
        activity={makeActivity()}
        sessionName="myproject"
        width={80}
        visibleRows={10}
        scrollOffset={0}
      />,
    );
    expect(lastFrame()).toContain("Thinking");
  });

  it("renders the full detail text", () => {
    const { lastFrame } = render(
      <DetailViewPanel
        activity={makeActivity({
          detail: "This is the full content of the activity.",
        })}
        sessionName="myproject"
        width={80}
        visibleRows={10}
        scrollOffset={0}
      />,
    );
    expect(lastFrame()).toContain("This is the full content of the activity.");
  });

  it("wraps long text across multiple lines", () => {
    const longDetail =
      "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12 word13 word14";
    const { lastFrame } = render(
      <DetailViewPanel
        activity={makeActivity({ detail: longDetail })}
        sessionName="myproject"
        width={40}
        visibleRows={10}
        scrollOffset={0}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("word1");
    expect(frame).toContain("word14");
  });

  it("shows scroll indicator when content exceeds visible rows", () => {
    const longDetail = Array.from(
      { length: 30 },
      (_, i) => `Line number ${i + 1}`,
    ).join(" ");
    const { lastFrame } = render(
      <DetailViewPanel
        activity={makeActivity({ detail: longDetail })}
        sessionName="myproject"
        width={80}
        visibleRows={5}
        scrollOffset={0}
      />,
    );
    expect(lastFrame()).toContain("/");
  });

  it("renders the icon in the title", () => {
    const { lastFrame } = render(
      <DetailViewPanel
        activity={makeActivity({ icon: "$", label: "Bash", type: "tool" })}
        sessionName="myproject"
        width={80}
        visibleRows={10}
        scrollOffset={0}
      />,
    );
    expect(lastFrame()).toContain("$");
    expect(lastFrame()).toContain("Bash");
  });

  it("shows empty placeholder when detail is empty", () => {
    const { lastFrame } = render(
      <DetailViewPanel
        activity={makeActivity({ detail: "" })}
        sessionName="myproject"
        width={80}
        visibleRows={10}
        scrollOffset={0}
      />,
    );
    expect(lastFrame()).toContain("(empty)");
  });

  it("preserves multi-line detail as separate visual lines", () => {
    const { lastFrame } = render(
      <DetailViewPanel
        activity={makeActivity({
          detail: "Paragraph one.\n\nParagraph two.\n\nParagraph three.",
        })}
        sessionName="myproject"
        width={80}
        visibleRows={10}
        scrollOffset={0}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Paragraph one.");
    expect(frame).toContain("Paragraph two.");
    expect(frame).toContain("Paragraph three.");
    // The paragraphs must appear on separate lines in the rendered output
    const oneIdx = frame.indexOf("Paragraph one.");
    const twoIdx = frame.indexOf("Paragraph two.");
    expect(twoIdx).toBeGreaterThan(oneIdx);
    // There must be a newline between them
    expect(frame.slice(oneIdx, twoIdx)).toContain("\n");
  });

  it("renders an Edit diff body in the detail view", () => {
    const { lastFrame } = render(
      <DetailViewPanel
        activity={makeActivity({
          type: "tool",
          icon: "~",
          label: "Edit",
          detail: "App.tsx L45-47 +1 -1",
          detailBody: "@@ -45,3 +45,3 @@\n ctx\n-old line\n+new line",
          detailKind: "diff",
        })}
        sessionName="myproject"
        width={80}
        visibleRows={10}
        scrollOffset={0}
      />,
    );
    const frame = lastFrame() ?? "";
    // detailBody is shown (not the short row detail). We don't assert ANSI
    // color codes here: CI runs without a TTY, so ink/chalk emit plain text.
    // Diff coloring itself is covered by lineColoring.test.ts.
    expect(frame).toContain("+new line");
    expect(frame).toContain("@@ -45,3 +45,3 @@");
  });

  it("renders a Write content body as code", () => {
    const { lastFrame } = render(
      <DetailViewPanel
        activity={makeActivity({
          type: "tool",
          icon: "~",
          label: "Write",
          detail: "a.ts L1-2 +2",
          detailBody: "const a = 1;\nconst b = 2;",
          detailKind: "code",
        })}
        sessionName="myproject"
        width={80}
        visibleRows={10}
        scrollOffset={0}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("const a = 1;");
    expect(frame).toContain("const b = 2;");
  });

  it("falls back to detail when there is no detailBody", () => {
    const { lastFrame } = render(
      <DetailViewPanel
        activity={makeActivity({
          detail: "plain detail text",
          detailBody: undefined,
        })}
        sessionName="myproject"
        width={80}
        visibleRows={10}
        scrollOffset={0}
      />,
    );
    expect(lastFrame()).toContain("plain detail text");
  });
});

describe("wrapText", () => {
  it("preserves newlines as line breaks", () => {
    const text = "line one\nline two\nline three";
    const result = wrapText(text, 80);
    expect(result).toEqual(["line one", "line two", "line three"]);
  });

  it("preserves blank lines", () => {
    const text = "first\n\nsecond";
    const result = wrapText(text, 80);
    expect(result).toEqual(["first", "", "second"]);
  });

  it("word-wraps long lines independently", () => {
    const text = "short\n" + "word ".repeat(20).trim();
    const result = wrapText(text, 30);
    expect(result[0]).toBe("short");
    expect(result.length).toBeGreaterThan(2);
  });
});

describe("wrapClassified whitespace", () => {
  it("preserves leading indentation when preserveWhitespace is true", () => {
    const code = "function f() {\n    const x = 1;\n        return x;";
    const out = wrapClassified(code, 80, classifyCodeFences, true);
    expect(out.map((l) => l.text)).toEqual([
      "function f() {",
      "    const x = 1;",
      "        return x;",
    ]);
  });

  it("hard-wraps a long line by width while keeping leading spaces", () => {
    const line = `${"  "}${"a".repeat(10)}`; // 2 spaces + 10 a's = width 12
    const out = wrapClassified(line, 6, classifyCodeFences, true);
    // every original character is preserved across the wrapped chunks
    expect(out.map((l) => l.text).join("")).toBe(line);
    expect(out.length).toBeGreaterThan(1);
    expect(out[0].text.startsWith("  ")).toBe(true);
  });

  it("still word-wraps (collapsing runs) for prose by default", () => {
    const out = wrapClassified("    indented prose", 80, classifyCodeFences);
    expect(out[0].text).toBe("indented prose");
  });
});

describe("DetailViewPanel code body indentation", () => {
  it("preserves indentation when rendering a code detailBody", () => {
    const { lastFrame } = render(
      <DetailViewPanel
        activity={makeActivity({
          type: "tool",
          icon: "○",
          label: "Read",
          detail: "a.ts L1-3",
          detailBody: "function f() {\n    const x = 1;\n}",
          detailKind: "code",
        })}
        sessionName="myproject"
        width={80}
        visibleRows={10}
        scrollOffset={0}
      />,
    );
    expect(lastFrame()).toContain("    const x = 1;");
  });
});
