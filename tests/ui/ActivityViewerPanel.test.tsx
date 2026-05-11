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

describe("ActivityViewerPanel", () => {
  it("renders session name in title", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        activities={[makeActivity("Read", 0)]}
        sessionName="feat/auth"
        hasFocus={false}
        scrollOffset={0}
        isLive={true}
        visibleRows={10}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("feat/auth");
  });

  it("renders activity label and detail", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        activities={[makeActivity("Read", 0)]}
        sessionName="session"
        hasFocus={false}
        scrollOffset={0}
        isLive={true}
        visibleRows={10}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("Read");
    expect(lastFrame()).toContain("file0.ts");
  });

  it("shows LIVE indicator when isLive is true", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        activities={[makeActivity("Read", 0)]}
        sessionName="s"
        hasFocus={false}
        scrollOffset={0}
        isLive={true}
        visibleRows={10}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("LIVE");
  });

  it("shows PAUSED indicator when isLive is false", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        activities={[makeActivity("Read", 0)]}
        sessionName="s"
        hasFocus={false}
        scrollOffset={0}
        isLive={false}
        visibleRows={10}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("PAUSED");
  });

  it("shows empty message when no activities", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        activities={[]}
        sessionName="s"
        hasFocus={false}
        scrollOffset={0}
        isLive={true}
        visibleRows={10}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("No activity");
  });
});
