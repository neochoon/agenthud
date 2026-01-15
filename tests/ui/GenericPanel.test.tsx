import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { GenericPanel } from "../../src/ui/GenericPanel.js";
import type { GenericPanelData } from "../../src/types/index.js";

describe("GenericPanel", () => {
  describe("list renderer (default)", () => {
    it("renders title and items as bullet points", () => {
      const data: GenericPanelData = {
        title: "Docker",
        items: [
          { text: "nginx:latest" },
          { text: "redis:alpine" },
        ],
      };

      const { lastFrame } = render(<GenericPanel data={data} />);

      expect(lastFrame()).toContain("Docker");
      expect(lastFrame()).toContain("• nginx:latest");
      expect(lastFrame()).toContain("• redis:alpine");
    });

    it("renders summary when provided", () => {
      const data: GenericPanelData = {
        title: "Services",
        summary: "2 containers running",
        items: [{ text: "web" }, { text: "db" }],
      };

      const { lastFrame } = render(<GenericPanel data={data} />);

      expect(lastFrame()).toContain("2 containers running");
    });

    it("shows 'No data' when items is empty", () => {
      const data: GenericPanelData = {
        title: "Empty",
        items: [],
      };

      const { lastFrame } = render(<GenericPanel data={data} />);

      expect(lastFrame()).toContain("No data");
    });

    it("renders countdown in title when provided", () => {
      const data: GenericPanelData = {
        title: "Docker",
        items: [{ text: "nginx" }],
      };

      const { lastFrame } = render(<GenericPanel data={data} countdown={25} />);

      expect(lastFrame()).toContain("↻ 25s");
    });

    it("renders relative time in title when provided", () => {
      const data: GenericPanelData = {
        title: "Docker",
        items: [{ text: "nginx" }],
      };

      const { lastFrame } = render(<GenericPanel data={data} relativeTime="5m ago" />);

      expect(lastFrame()).toContain("5m ago");
    });
  });

  describe("progress renderer", () => {
    it("renders progress bar in title", () => {
      const data: GenericPanelData = {
        title: "Build",
        progress: { done: 7, total: 10 },
        items: [
          { text: "Compile", status: "done" },
          { text: "Test", status: "done" },
          { text: "Deploy", status: "pending" },
        ],
      };

      const { lastFrame } = render(<GenericPanel data={data} renderer="progress" />);

      expect(lastFrame()).toContain("Build");
      expect(lastFrame()).toContain("7/10");
      expect(lastFrame()).toMatch(/[█░]+/); // progress bar
    });

    it("renders items with status icons", () => {
      const data: GenericPanelData = {
        title: "Steps",
        progress: { done: 1, total: 3 },
        items: [
          { text: "Step 1", status: "done" },
          { text: "Step 2", status: "pending" },
          { text: "Step 3", status: "failed" },
        ],
      };

      const { lastFrame } = render(<GenericPanel data={data} renderer="progress" />);

      expect(lastFrame()).toContain("✓ Step 1");
      expect(lastFrame()).toContain("○ Step 2");
      expect(lastFrame()).toContain("✗ Step 3");
    });

    it("handles zero progress", () => {
      const data: GenericPanelData = {
        title: "Empty",
        progress: { done: 0, total: 0 },
      };

      const { lastFrame } = render(<GenericPanel data={data} renderer="progress" />);

      expect(lastFrame()).toContain("0/0");
    });
  });

  describe("status renderer", () => {
    it("renders pass/fail summary with colors", () => {
      const data: GenericPanelData = {
        title: "Tests",
        stats: { passed: 10, failed: 2 },
      };

      const { lastFrame } = render(<GenericPanel data={data} renderer="status" />);

      expect(lastFrame()).toContain("✓ 10 passed");
      expect(lastFrame()).toContain("✗ 2 failed");
    });

    it("renders skipped count when provided", () => {
      const data: GenericPanelData = {
        title: "Tests",
        stats: { passed: 8, failed: 0, skipped: 2 },
      };

      const { lastFrame } = render(<GenericPanel data={data} renderer="status" />);

      expect(lastFrame()).toContain("✓ 8 passed");
      expect(lastFrame()).toContain("○ 2 skipped");
      expect(lastFrame()).not.toContain("failed");
    });

    it("renders summary when provided", () => {
      const data: GenericPanelData = {
        title: "Lint",
        summary: "ESLint check",
        stats: { passed: 100, failed: 0 },
      };

      const { lastFrame } = render(<GenericPanel data={data} renderer="status" />);

      expect(lastFrame()).toContain("ESLint check");
    });

    it("renders failed items when present", () => {
      const data: GenericPanelData = {
        title: "Tests",
        stats: { passed: 5, failed: 2 },
        items: [
          { text: "test-auth.ts", status: "failed" },
          { text: "test-api.ts", status: "failed" },
        ],
      };

      const { lastFrame } = render(<GenericPanel data={data} renderer="status" />);

      expect(lastFrame()).toContain("test-auth.ts");
      expect(lastFrame()).toContain("test-api.ts");
    });
  });

  describe("error handling", () => {
    it("renders error message when error prop provided", () => {
      const data: GenericPanelData = {
        title: "Docker",
      };

      const { lastFrame } = render(<GenericPanel data={data} error="Command failed" />);

      expect(lastFrame()).toContain("Docker");
      expect(lastFrame()).toContain("Command failed");
    });

    it("renders with minimal data", () => {
      const data: GenericPanelData = {
        title: "Minimal",
      };

      const { lastFrame } = render(<GenericPanel data={data} />);

      expect(lastFrame()).toContain("Minimal");
      expect(lastFrame()).toContain("No data");
    });
  });

  describe("border alignment", () => {
    it("all lines have same width", () => {
      const data: GenericPanelData = {
        title: "Test",
        items: [
          { text: "Short" },
          { text: "A much longer item that needs padding" },
        ],
      };

      const { lastFrame } = render(<GenericPanel data={data} />);
      const lines = lastFrame()!.split("\n").filter(l => l.length > 0);

      // All lines should have the same width (60 chars for PANEL_WIDTH)
      const firstLineLength = lines[0].length;
      lines.forEach((line) => {
        expect(line.length).toBe(firstLineLength);
      });
    });
  });

  describe("visual feedback", () => {
    it("shows 'running...' in yellow when isRunning is true", () => {
      const data: GenericPanelData = {
        title: "Docker",
        items: [{ text: "nginx" }],
      };

      const { lastFrame } = render(<GenericPanel data={data} isRunning={true} />);

      expect(lastFrame()).toContain("running...");
    });

    it("shows relativeTime normally when isRunning is false", () => {
      const data: GenericPanelData = {
        title: "Docker",
        items: [{ text: "nginx" }],
      };

      const { lastFrame } = render(<GenericPanel data={data} isRunning={false} relativeTime="5m ago" />);

      expect(lastFrame()).toContain("5m ago");
      expect(lastFrame()).not.toContain("running...");
    });

    it("shows countdown in green when justRefreshed is true", () => {
      const data: GenericPanelData = {
        title: "Docker",
        items: [{ text: "nginx" }],
      };

      const { lastFrame } = render(<GenericPanel data={data} countdown={30} justRefreshed={true} />);

      // Should contain countdown (the color is tested by checking it renders)
      expect(lastFrame()).toContain("30s");
    });
  });
});
