import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ClaudePanel } from "../src/ui/ClaudePanel.js";
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
    timestamp: "2025-01-12T10:30:00Z",
    ...overrides,
  });

  describe("no active session", () => {
    it("shows 'No active session' when status is none", () => {
      const data = createMockData({
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
});
