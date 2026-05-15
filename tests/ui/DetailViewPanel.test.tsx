import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../../src/types/index.js";
import { DetailViewPanel, wrapText } from "../../src/ui/DetailViewPanel.js";

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
