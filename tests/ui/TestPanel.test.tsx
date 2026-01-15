import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { TestPanel } from "../../src/ui/TestPanel.js";
import type { TestResults } from "../../src/types/index.js";

describe("TestPanel", () => {
  const mockResults: TestResults = {
    hash: "abc1234",
    timestamp: "2026-01-09T16:00:00Z",
    passed: 30,
    failed: 2,
    skipped: 1,
    failures: [
      { file: "tests/git.test.ts", name: "returns null" },
      { file: "tests/App.test.tsx", name: "renders correctly" },
    ],
  };

  describe("summary display", () => {
    it("shows passed count with checkmark", () => {
      const { lastFrame } = render(
        <TestPanel results={mockResults} isOutdated={false} commitsBehind={0} />
      );

      expect(lastFrame()).toContain("✓");
      expect(lastFrame()).toContain("30");
      expect(lastFrame()).toMatch(/passed/i);
    });

    it("shows failed count with x", () => {
      const { lastFrame } = render(
        <TestPanel results={mockResults} isOutdated={false} commitsBehind={0} />
      );

      expect(lastFrame()).toContain("✗");
      expect(lastFrame()).toContain("2");
      expect(lastFrame()).toMatch(/failed/i);
    });

    it("shows git hash", () => {
      const { lastFrame } = render(
        <TestPanel results={mockResults} isOutdated={false} commitsBehind={0} />
      );

      expect(lastFrame()).toContain("abc1234");
    });

    it("shows relative time", () => {
      const { lastFrame } = render(
        <TestPanel results={mockResults} isOutdated={false} commitsBehind={0} />
      );

      // Should show some time indicator (ago)
      expect(lastFrame()).toMatch(/ago|just now/i);
    });
  });

  describe("outdated state", () => {
    it("shows warning when outdated", () => {
      const { lastFrame } = render(
        <TestPanel results={mockResults} isOutdated={true} commitsBehind={3} />
      );

      expect(lastFrame()).toContain("⚠");
      expect(lastFrame()).toMatch(/outdated/i);
    });

    it("shows commits behind count", () => {
      const { lastFrame } = render(
        <TestPanel results={mockResults} isOutdated={true} commitsBehind={3} />
      );

      expect(lastFrame()).toContain("3");
      expect(lastFrame()).toMatch(/behind/i);
    });
  });

  describe("failures display", () => {
    it("shows failed test files", () => {
      const { lastFrame } = render(
        <TestPanel results={mockResults} isOutdated={false} commitsBehind={0} />
      );

      expect(lastFrame()).toContain("tests/git.test.ts");
      expect(lastFrame()).toContain("tests/App.test.tsx");
    });

    it("shows failed test names", () => {
      const { lastFrame } = render(
        <TestPanel results={mockResults} isOutdated={false} commitsBehind={0} />
      );

      expect(lastFrame()).toContain("returns null");
      expect(lastFrame()).toContain("renders correctly");
    });

    it("hides failures section when all tests pass", () => {
      const passingResults: TestResults = {
        ...mockResults,
        failed: 0,
        failures: [],
      };

      const { lastFrame } = render(
        <TestPanel results={passingResults} isOutdated={false} commitsBehind={0} />
      );

      expect(lastFrame()).not.toContain("tests/git.test.ts");
    });
  });

  describe("error states", () => {
    it("shows 'No test results' when results is null", () => {
      const { lastFrame } = render(
        <TestPanel results={null} isOutdated={false} commitsBehind={0} error="No test results" />
      );

      expect(lastFrame()).toContain("No test results");
    });

    it("shows error message for invalid file", () => {
      const { lastFrame } = render(
        <TestPanel results={null} isOutdated={false} commitsBehind={0} error="Invalid test-results.json" />
      );

      expect(lastFrame()).toContain("Invalid test-results.json");
    });
  });

  describe("edge cases", () => {
    it("handles zero passed", () => {
      const zeroResults: TestResults = {
        ...mockResults,
        passed: 0,
        failed: 5,
      };

      const { lastFrame } = render(
        <TestPanel results={zeroResults} isOutdated={false} commitsBehind={0} />
      );

      expect(lastFrame()).toContain("0");
    });

    it("handles skipped tests", () => {
      const { lastFrame } = render(
        <TestPanel results={mockResults} isOutdated={false} commitsBehind={0} />
      );

      // Should show skipped if > 0
      expect(lastFrame()).toContain("1");
      expect(lastFrame()).toMatch(/skipped/i);
    });
  });

  describe("visual feedback", () => {
    it("shows 'running...' when isRunning is true", () => {
      const { lastFrame } = render(
        <TestPanel results={null} isOutdated={false} commitsBehind={0} isRunning={true} />
      );

      expect(lastFrame()).toContain("running...");
    });

    it("shows relative time when isRunning is false", () => {
      const { lastFrame } = render(
        <TestPanel results={mockResults} isOutdated={false} commitsBehind={0} isRunning={false} />
      );

      expect(lastFrame()).not.toContain("running...");
    });

    it("shows 'just now' when justCompleted is true", () => {
      const { lastFrame } = render(
        <TestPanel results={mockResults} isOutdated={false} commitsBehind={0} justCompleted={true} />
      );

      expect(lastFrame()).toContain("just now");
    });
  });
});
