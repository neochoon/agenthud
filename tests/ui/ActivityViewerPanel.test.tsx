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
    const activities = [
      makeActivity("First", 0),
      makeActivity("Last", 1),
    ];
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

  it("renders the sliding arrow in the trailing slot when live", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
        trailingBlankRows={1}
        liveIndicatorPosition={2}
      />,
    );
    expect(lastFrame()).toContain("▸");
  });

  it("hides the arrow when paused (isLive false)", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
        isLive={false}
        scrollOffset={3}
        trailingBlankRows={1}
        liveIndicatorPosition={2}
      />,
    );
    // The motion indicator must not appear over stale content when the
    // viewer is scrolled away from the live edge.
    expect(lastFrame()).not.toContain("▸");
  });

  it("places the arrow at the requested column offset", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
        trailingBlankRows={1}
        liveIndicatorPosition={5}
      />,
    );
    const frame = lastFrame() ?? "";
    // Find the line containing the arrow (only the trailing slot has it).
    const arrowLine = frame
      .split("\n")
      .find((line) => line.includes("▸")) ?? "";
    // Strip leading "│ " box border, then count spaces before the arrow.
    const stripped = arrowLine.replace(/^.*?│\s/, "");
    const spacesBeforeArrow = stripped.indexOf("▸");
    expect(spacesBeforeArrow).toBe(5);
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
