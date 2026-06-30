import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../../src/types/index.js";
import { ActivityViewerPanel } from "../../src/ui/ActivityViewerPanel.js";

const makeActivity = (label: string, i: number): ActivityEntry => ({
  timestamp: new Date(1_700_000_000_000 + i * 1000),
  type: "tool",
  icon: "○",
  label,
  detail: `file${i}.ts`,
});

const baseProps = {
  sessionName: "s",
  scrollOffset: 0,
  isLive: true,
  newCount: 0,
  visibleRows: 10,
  width: 80,
  cursorLine: 0,
  hasFocus: false,
};

describe("ActivityViewerPanel", () => {
  it("renders session name in title", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
        sessionName="feat/auth"
      />,
    );
    expect(lastFrame()).toContain("feat/auth");
  });

  it("renders activity label and detail", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
      />,
    );
    expect(lastFrame()).toContain("Read");
    expect(lastFrame()).toContain("file0.ts");
  });

  it("shows LIVE indicator when isLive is true", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
      />,
    );
    expect(lastFrame()).toContain("LIVE");
  });

  it("shows PAUSED indicator when isLive is false", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
        isLive={false}
      />,
    );
    expect(lastFrame()).toContain("PAUSED");
  });

  it("shows empty message when no activities", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel {...baseProps} activities={[]} />,
    );
    expect(lastFrame()).toContain("No activity");
  });

  it("shows newest activity at the bottom (tail-style)", () => {
    const activities = [
      makeActivity("OldestAction", 0),
      makeActivity("MiddleAction", 1),
      makeActivity("NewestAction", 2),
    ];
    const { lastFrame } = render(
      <ActivityViewerPanel {...baseProps} activities={activities} />,
    );
    const frame = lastFrame() ?? "";
    const newestIdx = frame.indexOf("NewestAction");
    const oldestIdx = frame.indexOf("OldestAction");
    expect(newestIdx).toBeGreaterThanOrEqual(0);
    expect(oldestIdx).toBeGreaterThanOrEqual(0);
    // newest must appear AFTER oldest in the rendered frame (bottom-feed)
    expect(newestIdx).toBeGreaterThan(oldestIdx);
  });

  it("pads empty rows at the top when activities are sparse", () => {
    // Few activities + tall viewport → content sits at the bottom,
    // empty rows above. Verify the last content row is the newest.
    const activities = [makeActivity("First", 0), makeActivity("Last", 1)];
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={activities}
        visibleRows={10}
      />,
    );
    const lines = (lastFrame() ?? "").split("\n");
    // Strip box borders to find content lines
    const contentLines = lines
      .map((l) => l.trim())
      .filter((l) => l.includes("│") || l.includes("|"));
    const firstIdx = lines.findIndex((l) => l.includes("First"));
    const lastIdx = lines.findIndex((l) => l.includes("Last"));
    expect(lastIdx).toBeGreaterThan(firstIdx);
    expect(contentLines.length).toBeGreaterThan(0);
  });

  it("shows PAUSED title with scroll position indicator", () => {
    const activities = Array.from({ length: 20 }, (_, i) =>
      makeActivity("Read", i),
    );
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={activities}
        scrollOffset={5}
        isLive={false}
      />,
    );
    expect(lastFrame()).toContain("PAUSED");
    // ↑N = scrolled up N entries from the live edge (newer entries hidden below)
    expect(lastFrame()).toContain("↑5");
  });

  it("shows MM/DD prefix for activities from a different day", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const activity: ActivityEntry = {
      timestamp: yesterday,
      type: "tool",
      icon: "○",
      label: "Read",
      detail: "old.ts",
    };
    const { lastFrame } = render(
      <ActivityViewerPanel {...baseProps} activities={[activity]} />,
    );
    const frame = lastFrame() ?? "";
    const month = String(yesterday.getMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getDate()).padStart(2, "0");
    expect(frame).toContain(`${month}/${day}`);
  });

  it("does not show date prefix for today's activities", () => {
    const now = new Date();
    const activity: ActivityEntry = {
      timestamp: now,
      type: "tool",
      icon: "○",
      label: "Read",
      detail: "new.ts",
    };
    const { lastFrame } = render(
      <ActivityViewerPanel {...baseProps} activities={[activity]} />,
    );
    const frame = lastFrame() ?? "";
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    expect(frame).not.toContain(`${month}/${day}`);
  });

  it("shows new item badge in PAUSED title when newCount > 0", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
        scrollOffset={1}
        isLive={false}
        newCount={3}
      />,
    );
    // +N↓ = N new entries arrived below the current view
    expect(lastFrame()).toContain("+3↓");
  });

  it("replaces the newest row's icon with the live spinner frame when live", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Older", 0), makeActivity("Newest", 1)]}
        liveSpinnerFrame="⠧"
      />,
    );
    const frame = lastFrame() ?? "";
    // Spinner glyph should appear; the static icon ("○") still appears on
    // the older row only.
    expect(frame).toContain("⠧");
    // The newest row's icon is replaced — only the older row keeps "○".
    expect(frame.match(/○/g)?.length ?? 0).toBe(1);
  });

  it("does not replace any icon when paused (isLive false)", () => {
    // Three activities, scrollOffset 1 → top 2 visible (newest hidden below).
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[
          makeActivity("A", 0),
          makeActivity("B", 1),
          makeActivity("C", 2),
        ]}
        isLive={false}
        scrollOffset={1}
        liveSpinnerFrame="⠧"
      />,
    );
    const frame = lastFrame() ?? "";
    // Spinner glyph must not appear over stale content.
    expect(frame).not.toContain("⠧");
    // Two visible rows, both keep their static icon.
    expect(frame.match(/○/g)?.length ?? 0).toBe(2);
  });

  it("does not replace any icon when there are no activities", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[]}
        liveSpinnerFrame="⠧"
      />,
    );
    expect(lastFrame()).not.toContain("⠧");
  });

  it("does not animate when liveSpinnerFrame is null/undefined", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
        liveSpinnerFrame={null}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame.match(/○/g)?.length ?? 0).toBe(1);
  });

  it("flattens multi-line detail to a single line in the viewer", () => {
    const multiLineActivity: ActivityEntry = {
      timestamp: new Date(1_700_000_000_000),
      type: "response",
      icon: "◀",
      label: "Response",
      detail: "Paragraph one.\n\nParagraph two.\n\nParagraph three.",
    };
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[multiLineActivity]}
        width={120}
      />,
    );
    const frame = lastFrame() ?? "";
    // All paragraphs should appear on one line (no raw newlines in rendered output)
    expect(frame).toContain("Paragraph one.");
    expect(frame).toContain("Paragraph two.");
    // The rendered frame should not contain a literal newline between the paragraphs
    // (they're collapsed to spaces)
    expect(frame).not.toMatch(/Paragraph one\.\s*\n\s*Paragraph two\./);
  });
});

describe("ActivityViewerPanel — row width alignment", () => {
  it("pads the empty-state line to the full panel width (right border aligned)", () => {
    const W = 80;
    const { lastFrame } = render(
      <ActivityViewerPanel {...baseProps} activities={[]} width={W} />,
    );
    const lines = (lastFrame() ?? "").split("\n").filter(Boolean);
    expect(lines.some((l) => l.includes("No activity yet"))).toBe(true);
    for (const l of lines) expect([...l].length).toBe(W);
  });
});

describe("ActivityViewerPanel — sub-agent summary header", () => {
  const summary = {
    status: "done" as const,
    steps: 3,
    durationMs: 134000,
    intent: "Research the thing",
    result: "Recommends option B",
    model: "sonnet-4.6",
  };

  it("renders the header (intent/result/steps) when subAgentSummary is set", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
        subAgentSummary={summary}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Research the thing"); // intent
    expect(out).toContain("3 steps"); // metric chip
    expect(out).toContain("Recommends option B"); // result
    expect(out).toContain("activity"); // divider label
    expect(out).toContain("Read"); // stream still present below
  });

  it("renders no header for a main session (prop absent)", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).not.toContain("3 steps");
    expect(out).not.toContain("↵ drill in");
  });
});

describe("ActivityViewerPanel search", () => {
  const acts = [
    makeActivity("Read", 0),
    makeActivity("Bash", 1),
    makeActivity("Edit", 2),
  ];

  it("empty query shows the full list (no narrow)", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={acts}
        searchQuery=""
        searchHits={[]}
        searchSelected={0}
      />,
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("Read");
    expect(f).toContain("Bash");
    expect(f).toContain("Edit");
    expect(f).not.toContain("No matches");
  });

  it("non-empty query with zero matches narrows to empty", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={acts}
        searchQuery="zzz"
        searchHits={[]}
        searchSelected={0}
      />,
    );
    expect(lastFrame() ?? "").toContain("No matches");
  });
});
