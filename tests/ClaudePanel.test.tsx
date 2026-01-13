import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ClaudePanel, getActivityStyle } from "../src/ui/ClaudePanel.js";
import { ICONS } from "../src/types/index.js";
import type { ClaudeData, ActivityEntry } from "../src/types/index.js";

describe("ClaudePanel", () => {
  const mockActivity: ActivityEntry = {
    timestamp: new Date("2025-01-12T10:30:00"),
    type: "tool",
    icon: ICONS.Grep,
    label: "Grep",
    detail: "searching for pattern",
  };

  const mockActivities: ActivityEntry[] = [
    {
      timestamp: new Date("2025-01-12T10:30:00"),
      type: "user",
      icon: ICONS.User,
      label: "User",
      detail: "Show me the project structure",
    },
    {
      timestamp: new Date("2025-01-12T10:30:05"),
      type: "tool",
      icon: ICONS.Glob,
      label: "Glob",
      detail: "src/**/*.ts",
    },
    {
      timestamp: new Date("2025-01-12T10:30:10"),
      type: "tool",
      icon: ICONS.Read,
      label: "Read",
      detail: "package.json",
    },
  ];

  const createMockData = (overrides: Partial<ClaudeData> = {}): ClaudeData => ({
    state: {
      status: "running",
      activities: mockActivities,
      tokenCount: 1500,
      sessionStartTime: null,
    },
    hasSession: true,
    timestamp: "2025-01-12T10:30:00Z",
    ...overrides,
  });

  describe("no Claude session", () => {
    it("shows 'No Claude session' when hasSession is false", () => {
      const data = createMockData({
        hasSession: false,
        state: {
          status: "none",
          activities: [],
          tokenCount: 0,
          sessionStartTime: null,
        },
      });

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).toContain("No Claude session");
    });
  });

  describe("no active session", () => {
    it("shows 'No active session' when status is none but hasSession is true", () => {
      const data = createMockData({
        hasSession: true,
        state: {
          status: "none",
          activities: [],
          tokenCount: 0,
          sessionStartTime: null,
        },
      });

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).toContain("No active session");
    });

    it("shows 'No active session' when activities are empty", () => {
      const data = createMockData({
        hasSession: true,
        state: {
          status: "running",
          activities: [],
          tokenCount: 0,
          sessionStartTime: null,
        },
      });

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).toContain("No active session");
    });
  });

  describe("error state", () => {
    it("shows error message when data.error is present", () => {
      const data = createMockData({
        error: "Failed to read session file",
      });

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).toContain("Failed to read session file");
    });
  });

  describe("activity log", () => {
    it("shows activity entries with timestamps", () => {
      const data = createMockData();

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).toContain("[10:30:00]");
      expect(lastFrame()).toContain("[10:30:05]");
      expect(lastFrame()).toContain("[10:30:10]");
    });

    it("shows activity labels", () => {
      const data = createMockData();

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).toContain("User");
      expect(lastFrame()).toContain("Glob");
      expect(lastFrame()).toContain("Read");
    });

    it("shows activity details", () => {
      const data = createMockData();

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).toContain("Show me the project structure");
      expect(lastFrame()).toContain("src/**/*.ts");
      expect(lastFrame()).toContain("package.json");
    });

    it("shows activity icons", () => {
      const data = createMockData();

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).toContain(ICONS.User);
      expect(lastFrame()).toContain(ICONS.Glob);
      expect(lastFrame()).toContain(ICONS.Read);
    });
  });

  describe("token count", () => {
    it("shows token count when available", () => {
      const data = createMockData({
        state: {
          status: "running",
          activities: mockActivities,
          tokenCount: 12500,
          sessionStartTime: null,
        },
      });

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).toContain("12,500 tokens");
    });

    it("does not show token count when zero", () => {
      const data = createMockData({
        state: {
          status: "running",
          activities: mockActivities,
          tokenCount: 0,
          sessionStartTime: null,
        },
      });

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).not.toContain("tokens");
    });
  });

  describe("elapsed time", () => {
    it("shows elapsed time in hours and minutes in title", () => {
      // 2 hours 30 minutes ago
      const sessionStart = new Date(Date.now() - 2 * 60 * 60 * 1000 - 30 * 60 * 1000);
      const data = createMockData({
        state: {
          status: "running",
          activities: mockActivities,
          tokenCount: 0,
          sessionStartTime: sessionStart,
        },
      });

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).toContain("2h 30m");
    });

    it("shows elapsed time in minutes only when less than 1 hour", () => {
      // 45 minutes ago
      const sessionStart = new Date(Date.now() - 45 * 60 * 1000);
      const data = createMockData({
        state: {
          status: "running",
          activities: mockActivities,
          tokenCount: 0,
          sessionStartTime: sessionStart,
        },
      });

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).toContain("45m");
      expect(lastFrame()).not.toContain("h ");
    });

    it("shows '<1m' when less than 1 minute", () => {
      // 30 seconds ago
      const sessionStart = new Date(Date.now() - 30 * 1000);
      const data = createMockData({
        state: {
          status: "running",
          activities: mockActivities,
          tokenCount: 0,
          sessionStartTime: sessionStart,
        },
      });

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).toContain("<1m");
    });

    it("shows elapsed time with countdown separated by dot", () => {
      // 10 minutes ago
      const sessionStart = new Date(Date.now() - 10 * 60 * 1000);
      const data = createMockData({
        state: {
          status: "running",
          activities: mockActivities,
          tokenCount: 0,
          sessionStartTime: sessionStart,
        },
      });

      const { lastFrame } = render(<ClaudePanel data={data} countdown={15} />);

      // Should show both elapsed time and countdown with separator
      expect(lastFrame()).toContain("10m");
      expect(lastFrame()).toContain("·");
      expect(lastFrame()).toContain("15s");
    });

    it("shows only countdown when sessionStartTime is null", () => {
      const data = createMockData({
        state: {
          status: "running",
          activities: mockActivities,
          tokenCount: 0,
          sessionStartTime: null,
        },
      });

      const { lastFrame } = render(<ClaudePanel data={data} countdown={20} />);

      expect(lastFrame()).toContain("20s");
      expect(lastFrame()).not.toContain("·");
    });

    it("shows elapsed time even when no active session", () => {
      // 1 hour ago
      const sessionStart = new Date(Date.now() - 60 * 60 * 1000);
      const data = createMockData({
        hasSession: true,
        state: {
          status: "none",
          activities: [],
          tokenCount: 0,
          sessionStartTime: sessionStart,
        },
      });

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).toContain("No active session");
      expect(lastFrame()).toContain("1h 0m");
    });
  });

  describe("visual feedback", () => {
    it("shows 'running...' when isRunning is true", () => {
      const data = createMockData();

      const { lastFrame } = render(<ClaudePanel data={data} isRunning={true} />);

      expect(lastFrame()).toContain("running...");
    });

    it("shows countdown when isRunning is false", () => {
      const data = createMockData();

      const { lastFrame } = render(
        <ClaudePanel data={data} isRunning={false} countdown={25} />
      );

      expect(lastFrame()).toContain("25s");
      expect(lastFrame()).not.toContain("running...");
    });

    it("does not show countdown when null", () => {
      const data = createMockData();

      const { lastFrame } = render(
        <ClaudePanel data={data} isRunning={false} countdown={null} />
      );

      // Should not contain countdown format (↻ followed by number and s)
      expect(lastFrame()).not.toMatch(/↻\s+\d+s/);
    });
  });

  describe("panel title", () => {
    it("shows 'Claude' in the title", () => {
      const data = createMockData();

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).toContain("Claude");
    });
  });

  describe("long content handling", () => {
    it("truncates long activity details", () => {
      const longDetail =
        "This is a very long detail message that should be truncated to fit within the panel width boundaries";
      const data = createMockData({
        state: {
          status: "running",
          activities: [
            {
              timestamp: new Date("2025-01-12T10:30:00"),
              type: "tool",
              icon: ICONS.Grep,
              label: "Grep",
              detail: longDetail,
            },
          ],
          tokenCount: 0,
          sessionStartTime: null,
        },
      });

      const { lastFrame } = render(<ClaudePanel data={data} width={50} />);

      const output = lastFrame() || "";
      // Should contain truncation indicator
      expect(output).toContain("...");
      // Should not contain the full detail
      expect(output).not.toContain(longDetail);
    });

    it("does not wrap lines", () => {
      const data = createMockData();

      const { lastFrame } = render(<ClaudePanel data={data} width={60} />);

      const output = lastFrame() || "";
      const lines = output.split("\n");

      // Each line should end with box character (stripping ANSI escape sequences)
      const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
      for (const line of lines) {
        if (line.includes("│")) {
          const cleanLine = stripAnsi(line);
          const lastBoxChar = cleanLine.lastIndexOf("│");
          const afterBox = cleanLine.slice(lastBoxChar + 1);
          expect(afterBox.trim()).toBe("");
        }
      }
    });
  });

  describe("visual hierarchy - getActivityStyle", () => {
    it("returns bright white for user type", () => {
      const activity: ActivityEntry = {
        timestamp: new Date(),
        type: "user",
        icon: ICONS.User,
        label: "User",
        detail: "hello",
      };

      const style = getActivityStyle(activity);

      expect(style.color).toBe("white");
      expect(style.dimColor).toBe(false);
    });

    it("returns green for response type", () => {
      const activity: ActivityEntry = {
        timestamp: new Date(),
        type: "response",
        icon: ICONS.Response,
        label: "Response",
        detail: "I will help you",
      };

      const style = getActivityStyle(activity);

      expect(style.color).toBe("green");
      expect(style.dimColor).toBe(false);
    });

    it("returns gray for Bash tool", () => {
      const activity: ActivityEntry = {
        timestamp: new Date(),
        type: "tool",
        icon: ICONS.Bash,
        label: "Bash",
        detail: "npm run test",
      };

      const style = getActivityStyle(activity);

      expect(style.color).toBe("gray");
      expect(style.dimColor).toBe(false);
    });

    it("returns dim for Edit tool", () => {
      const activity: ActivityEntry = {
        timestamp: new Date(),
        type: "tool",
        icon: ICONS.Edit,
        label: "Edit",
        detail: "src/index.ts",
      };

      const style = getActivityStyle(activity);

      expect(style.dimColor).toBe(true);
    });

    it("returns dim for Read tool", () => {
      const activity: ActivityEntry = {
        timestamp: new Date(),
        type: "tool",
        icon: ICONS.Read,
        label: "Read",
        detail: "package.json",
      };

      const style = getActivityStyle(activity);

      expect(style.dimColor).toBe(true);
    });

    it("returns dim for Write tool", () => {
      const activity: ActivityEntry = {
        timestamp: new Date(),
        type: "tool",
        icon: ICONS.Write,
        label: "Write",
        detail: "config.yaml",
      };

      const style = getActivityStyle(activity);

      expect(style.dimColor).toBe(true);
    });

    it("returns dim for Grep tool", () => {
      const activity: ActivityEntry = {
        timestamp: new Date(),
        type: "tool",
        icon: ICONS.Grep,
        label: "Grep",
        detail: "pattern",
      };

      const style = getActivityStyle(activity);

      expect(style.dimColor).toBe(true);
    });

    it("returns dim for Glob tool", () => {
      const activity: ActivityEntry = {
        timestamp: new Date(),
        type: "tool",
        icon: ICONS.Glob,
        label: "Glob",
        detail: "**/*.ts",
      };

      const style = getActivityStyle(activity);

      expect(style.dimColor).toBe(true);
    });

    it("returns dim for TodoWrite tool", () => {
      const activity: ActivityEntry = {
        timestamp: new Date(),
        type: "tool",
        icon: ICONS.TodoWrite,
        label: "TodoWrite",
        detail: "updating tasks",
      };

      const style = getActivityStyle(activity);

      expect(style.dimColor).toBe(true);
    });

    it("returns dim for unknown tool types", () => {
      const activity: ActivityEntry = {
        timestamp: new Date(),
        type: "tool",
        icon: ICONS.AskUserQuestion,
        label: "UnknownTool",
        detail: "something",
      };

      const style = getActivityStyle(activity);

      expect(style.dimColor).toBe(true);
    });
  });

  describe("responsive width", () => {
    it("panel border width matches content line width", () => {
      const data = createMockData({
        state: {
          status: "running",
          activities: [
            {
              timestamp: new Date("2025-01-12T10:30:00"),
              type: "tool",
              icon: ICONS.Bash,
              label: "Bash",
              detail: "test command",
            },
          ],
          tokenCount: 0,
          sessionStartTime: null,
        },
      });

      const { lastFrame } = render(<ClaudePanel data={data} width={120} />);
      const output = lastFrame() || "";
      const lines = output.split("\n");

      // Get actual line lengths (excluding ANSI codes)
      const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

      const titleLine = stripAnsi(lines[0]); // ┌─ Claude ─...─┐
      const contentLine = stripAnsi(lines[1]); // │ [HH:MM:SS] ...│
      const bottomLine = stripAnsi(lines[2]); // └─...─┘

      // All lines must have the same visual length
      expect(titleLine.length).toBe(120);
      expect(contentLine.length).toBe(120);
      expect(bottomLine.length).toBe(120);
    });

    it("handles different emoji icons correctly", () => {
      // Test with different emoji icons to ensure width calculation is correct
      const activities: ActivityEntry[] = [
        { timestamp: new Date("2025-01-12T10:30:00"), type: "user", icon: ICONS.User, label: "User", detail: "hello world" },
        { timestamp: new Date("2025-01-12T10:30:01"), type: "response", icon: ICONS.Response, label: "Response", detail: "hi there" },
        { timestamp: new Date("2025-01-12T10:30:02"), type: "tool", icon: ICONS.Bash, label: "Bash", detail: "npm test" },
        { timestamp: new Date("2025-01-12T10:30:03"), type: "tool", icon: ICONS.Edit, label: "Edit", detail: "file.ts" },
        { timestamp: new Date("2025-01-12T10:30:04"), type: "tool", icon: ICONS.Grep, label: "Grep", detail: "pattern" },
      ];

      const data = createMockData({
        state: { status: "running", activities, tokenCount: 0, sessionStartTime: null },
      });

      const { lastFrame } = render(<ClaudePanel data={data} width={100} />);
      const output = lastFrame() || "";
      const lines = output.split("\n");

      const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

      // All content lines should have the same width
      const contentLines = lines.slice(1, -1); // Exclude title and bottom
      const widths = contentLines.map((line) => stripAnsi(line).length);

      // All should be 100
      widths.forEach((w) => expect(w).toBe(100));
    });

    it("uses full width for long details when width is large", () => {
      // At width 120: contentWidth=117, prefix=21, available=96 chars for detail
      // This detail is 90 chars - should fit without truncation at width 120
      const detail90chars = "npm run build && npm run test && npm run lint && npm run format && npm run typecheck";
      const data = createMockData({
        state: {
          status: "running",
          activities: [
            {
              timestamp: new Date("2025-01-12T10:30:00"),
              type: "tool",
              icon: ICONS.Bash,
              label: "Bash",
              detail: detail90chars,
            },
          ],
          tokenCount: 0,
          sessionStartTime: null,
        },
      });

      // Wide panel (120 chars) - content should NOT be truncated
      const { lastFrame } = render(<ClaudePanel data={data} width={120} />);
      const output = lastFrame() || "";

      // Should contain the full detail without truncation
      expect(output).toContain(detail90chars);
      expect(output).not.toContain("...");
    });

    it("truncates at narrow width but not at wide width", () => {
      // This detail is 60 chars - should truncate at width 60, but fit at width 120
      const detail60chars = "npm run build && npm run test && npm run lint && npm run";
      const data = createMockData({
        state: {
          status: "running",
          activities: [
            {
              timestamp: new Date("2025-01-12T10:30:00"),
              type: "tool",
              icon: ICONS.Bash,
              label: "Bash",
              detail: detail60chars,
            },
          ],
          tokenCount: 0,
          sessionStartTime: null,
        },
      });

      // Narrow panel (60 chars) - at width 60: contentWidth=57, prefix=21, available=36
      // 60 char detail > 36 available, so should truncate
      const narrowResult = render(<ClaudePanel data={data} width={60} />);
      expect(narrowResult.lastFrame()).toContain("...");
      expect(narrowResult.lastFrame()).not.toContain(detail60chars);

      // Wide panel (120 chars) - should NOT truncate
      const wideResult = render(<ClaudePanel data={data} width={120} />);
      expect(wideResult.lastFrame()).toContain(detail60chars);
      expect(wideResult.lastFrame()).not.toContain("...");
    });
  });

  describe("visual hierarchy - rendering", () => {
    it("renders all activity types without error", () => {
      const mixedActivities: ActivityEntry[] = [
        {
          timestamp: new Date("2025-01-12T10:30:00"),
          type: "user",
          icon: ICONS.User,
          label: "User",
          detail: "help me",
        },
        {
          timestamp: new Date("2025-01-12T10:30:05"),
          type: "response",
          icon: ICONS.Response,
          label: "Response",
          detail: "I will help",
        },
        {
          timestamp: new Date("2025-01-12T10:30:10"),
          type: "tool",
          icon: ICONS.Bash,
          label: "Bash",
          detail: "npm test",
        },
        {
          timestamp: new Date("2025-01-12T10:30:15"),
          type: "tool",
          icon: ICONS.Edit,
          label: "Edit",
          detail: "file.ts",
        },
      ];

      const data = createMockData({
        state: {
          status: "running",
          activities: mixedActivities,
          tokenCount: 0,
          sessionStartTime: null,
        },
      });

      const { lastFrame } = render(<ClaudePanel data={data} />);
      const output = lastFrame() || "";

      // All content should render
      expect(output).toContain("help me");
      expect(output).toContain("I will help");
      expect(output).toContain("npm test");
      expect(output).toContain("file.ts");
    });
  });
});
