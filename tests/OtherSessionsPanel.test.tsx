import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { OtherSessionsPanel } from "../src/ui/OtherSessionsPanel.js";
import type { OtherSessionsData } from "../src/data/otherSessions.js";

describe("OtherSessionsPanel", () => {
  const createMockData = (overrides: Partial<OtherSessionsData> = {}): OtherSessionsData => ({
    totalProjects: 3,
    activeCount: 2,
    recentSession: {
      projectPath: "/Users/test/myproject",
      projectName: "myproject",
      lastModified: new Date(),
      lastMessage: "Last assistant message here",
      isActive: true,
      relativeTime: "30s ago",
    },
    timestamp: new Date().toISOString(),
    ...overrides,
  });

  describe("header line", () => {
    it("shows total projects and active count", () => {
      const data = createMockData();

      const { lastFrame } = render(<OtherSessionsPanel data={data} />);

      expect(lastFrame()).toContain("3 projects");
      expect(lastFrame()).toContain("2 active");
    });

    it("shows singular 'project' when only one", () => {
      const data = createMockData({ totalProjects: 1, activeCount: 1 });

      const { lastFrame } = render(<OtherSessionsPanel data={data} />);

      expect(lastFrame()).toContain("1 project");
      expect(lastFrame()).not.toContain("1 projects");
    });

    it("shows singular 'active' when only one", () => {
      const data = createMockData({ totalProjects: 3, activeCount: 1 });

      const { lastFrame } = render(<OtherSessionsPanel data={data} />);

      expect(lastFrame()).toContain("1 active");
    });
  });

  describe("recent session display", () => {
    it("shows project name and relative time", () => {
      const data = createMockData();

      const { lastFrame } = render(<OtherSessionsPanel data={data} />);

      expect(lastFrame()).toContain("myproject");
      expect(lastFrame()).toContain("30s ago");
    });

    it("shows active icon for active session", () => {
      const data = createMockData({
        recentSession: {
          projectPath: "/test/project",
          projectName: "project",
          lastModified: new Date(),
          lastMessage: "Hello",
          isActive: true,
          relativeTime: "1m ago",
        },
      });

      const { lastFrame } = render(<OtherSessionsPanel data={data} />);

      expect(lastFrame()).toContain("🔵");
    });

    it("shows inactive icon for inactive session", () => {
      const data = createMockData({
        recentSession: {
          projectPath: "/test/project",
          projectName: "project",
          lastModified: new Date(),
          lastMessage: "Hello",
          isActive: false,
          relativeTime: "10m ago",
        },
      });

      const { lastFrame } = render(<OtherSessionsPanel data={data} />);

      expect(lastFrame()).toContain("⚪");
    });

    it("shows last assistant message", () => {
      const data = createMockData({
        recentSession: {
          projectPath: "/test/project",
          projectName: "project",
          lastModified: new Date(),
          lastMessage: "This is the last message from the assistant",
          isActive: true,
          relativeTime: "1m ago",
        },
      });

      const { lastFrame } = render(<OtherSessionsPanel data={data} />);

      expect(lastFrame()).toContain("This is the last message");
    });

    it("truncates long messages", () => {
      const longMessage =
        "This is a very long message that should be truncated to fit within the panel width boundaries and not overflow";
      const data = createMockData({
        recentSession: {
          projectPath: "/test/project",
          projectName: "project",
          lastModified: new Date(),
          lastMessage: longMessage,
          isActive: true,
          relativeTime: "1m ago",
        },
      });

      const { lastFrame } = render(<OtherSessionsPanel data={data} width={50} />);
      const output = lastFrame() || "";

      // Should contain truncation indicator
      expect(output).toContain("...");
      // Should not contain the full message
      expect(output).not.toContain(longMessage);
    });
  });

  describe("no sessions state", () => {
    it("shows 'No other active sessions' when recentSession is null", () => {
      const data = createMockData({
        totalProjects: 1,
        activeCount: 0,
        recentSession: null,
      });

      const { lastFrame } = render(<OtherSessionsPanel data={data} />);

      expect(lastFrame()).toContain("No other active sessions");
    });

    it("shows empty state when no projects exist", () => {
      const data = createMockData({
        totalProjects: 0,
        activeCount: 0,
        recentSession: null,
      });

      const { lastFrame } = render(<OtherSessionsPanel data={data} />);

      expect(lastFrame()).toContain("0 projects");
    });
  });

  describe("panel title", () => {
    it("shows 'Other Sessions' in the title", () => {
      const data = createMockData();

      const { lastFrame } = render(<OtherSessionsPanel data={data} />);

      expect(lastFrame()).toContain("Other Sessions");
    });
  });

  describe("visual feedback", () => {
    it("shows countdown when provided", () => {
      const data = createMockData();

      const { lastFrame } = render(<OtherSessionsPanel data={data} countdown={10} />);

      expect(lastFrame()).toContain("10s");
    });

    it("shows 'running...' when isRunning is true", () => {
      const data = createMockData();

      const { lastFrame } = render(<OtherSessionsPanel data={data} isRunning={true} />);

      expect(lastFrame()).toContain("running...");
    });
  });

  describe("responsive width", () => {
    it("panel border width matches content line width", () => {
      const data = createMockData();

      const { lastFrame } = render(<OtherSessionsPanel data={data} width={80} />);
      const output = lastFrame() || "";
      const lines = output.split("\n");

      // Strip ANSI codes
      const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

      const titleLine = stripAnsi(lines[0]);
      const bottomLine = stripAnsi(lines[lines.length - 1]);

      // All lines should have the same width
      expect(titleLine.length).toBe(80);
      expect(bottomLine.length).toBe(80);
    });
  });

  describe("null message handling", () => {
    it("handles null lastMessage gracefully", () => {
      const data = createMockData({
        recentSession: {
          projectPath: "/test/project",
          projectName: "project",
          lastModified: new Date(),
          lastMessage: null,
          isActive: true,
          relativeTime: "1m ago",
        },
      });

      const { lastFrame } = render(<OtherSessionsPanel data={data} />);

      // Should render without crashing
      expect(lastFrame()).toContain("project");
      // Should not show message line or show placeholder
      expect(lastFrame()).not.toContain("undefined");
    });
  });
});
