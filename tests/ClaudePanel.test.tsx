import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ClaudePanel, getActivityStyle } from "../src/ui/ClaudePanel.js";
import type { ClaudeData, ActivityEntry } from "../src/types/index.js";

describe("ClaudePanel", () => {
  const mockActivity: ActivityEntry = {
    timestamp: new Date("2025-01-12T10:30:00"),
    type: "tool",
    icon: "🔍",
    label: "Grep",
    detail: "searching for pattern",
  };

  const mockActivities: ActivityEntry[] = [
    {
      timestamp: new Date("2025-01-12T10:30:00"),
      type: "user",
      icon: "💬",
      label: "User",
      detail: "Show me the project structure",
    },
    {
      timestamp: new Date("2025-01-12T10:30:05"),
      type: "tool",
      icon: "🔍",
      label: "Glob",
      detail: "src/**/*.ts",
    },
    {
      timestamp: new Date("2025-01-12T10:30:10"),
      type: "tool",
      icon: "📖",
      label: "Read",
      detail: "package.json",
    },
  ];

  const createMockData = (overrides: Partial<ClaudeData> = {}): ClaudeData => ({
    state: {
      status: "running",
      activities: mockActivities,
      tokenCount: 1500,
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

      expect(lastFrame()).toContain("💬");
      expect(lastFrame()).toContain("🔍");
      expect(lastFrame()).toContain("📖");
    });
  });

  describe("token count", () => {
    it("shows token count when available", () => {
      const data = createMockData({
        state: {
          status: "running",
          activities: mockActivities,
          tokenCount: 12500,
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
        },
      });

      const { lastFrame } = render(<ClaudePanel data={data} />);

      expect(lastFrame()).not.toContain("tokens");
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
              icon: "🔍",
              label: "Grep",
              detail: longDetail,
            },
          ],
          tokenCount: 0,
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

      // Each line should end with box character
      for (const line of lines) {
        if (line.includes("│")) {
          const lastBoxChar = line.lastIndexOf("│");
          const afterBox = line.slice(lastBoxChar + 1);
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
        icon: "💬",
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
        icon: "🤖",
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
        icon: "🔧",
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
        icon: "📝",
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
        icon: "📖",
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
        icon: "📝",
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
        icon: "🔍",
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
        icon: "🔍",
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
        icon: "📋",
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
        icon: "❓",
        label: "UnknownTool",
        detail: "something",
      };

      const style = getActivityStyle(activity);

      expect(style.dimColor).toBe(true);
    });
  });

  describe("visual hierarchy - rendering", () => {
    it("renders all activity types without error", () => {
      const mixedActivities: ActivityEntry[] = [
        {
          timestamp: new Date("2025-01-12T10:30:00"),
          type: "user",
          icon: "💬",
          label: "User",
          detail: "help me",
        },
        {
          timestamp: new Date("2025-01-12T10:30:05"),
          type: "response",
          icon: "🤖",
          label: "Response",
          detail: "I will help",
        },
        {
          timestamp: new Date("2025-01-12T10:30:10"),
          type: "tool",
          icon: "🔧",
          label: "Bash",
          detail: "npm test",
        },
        {
          timestamp: new Date("2025-01-12T10:30:15"),
          type: "tool",
          icon: "📝",
          label: "Edit",
          detail: "file.ts",
        },
      ];

      const data = createMockData({
        state: {
          status: "running",
          activities: mixedActivities,
          tokenCount: 0,
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
