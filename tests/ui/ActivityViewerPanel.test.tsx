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

  it("shows newest activity first (at top of rendered output)", () => {
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
    expect(newestIdx).toBeLessThan(oldestIdx);
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
    expect(lastFrame()).toContain("↓5");
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
    expect(lastFrame()).toContain("+3↑");
  });
});
