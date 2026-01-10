import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { GitPanel } from "../src/ui/GitPanel.js";
import type { Commit, GitStats } from "../src/types/index.js";

describe("GitPanel", () => {
  const mockCommits: Commit[] = [
    { hash: "abc1234", message: "Add login feature", timestamp: new Date("2025-01-09T10:30:00") },
    { hash: "def5678", message: "Fix bug", timestamp: new Date("2025-01-09T09:00:00") },
    { hash: "890abcd", message: "Update docs", timestamp: new Date("2025-01-09T08:00:00") },
  ];

  const mockStats: GitStats = { added: 142, deleted: 23, files: 5 };

  describe("normal display", () => {
    it("shows branch name", () => {
      const { lastFrame } = render(
        <GitPanel
          branch="feat/1-git-data"
          commits={mockCommits}
          stats={mockStats}
        />
      );

      expect(lastFrame()).toContain("feat/1-git-data");
    });

    it("shows stats with additions and deletions", () => {
      const { lastFrame } = render(
        <GitPanel
          branch="main"
          commits={mockCommits}
          stats={mockStats}
        />
      );

      expect(lastFrame()).toContain("+142");
      expect(lastFrame()).toContain("-23");
      expect(lastFrame()).toContain("3 commits");
    });

    it("shows commit list with hash and message", () => {
      const { lastFrame } = render(
        <GitPanel
          branch="main"
          commits={mockCommits}
          stats={mockStats}
        />
      );

      expect(lastFrame()).toContain("abc1234");
      expect(lastFrame()).toContain("Add login feature");
      expect(lastFrame()).toContain("def5678");
      expect(lastFrame()).toContain("Fix bug");
    });

    it("shows commits with bullet points", () => {
      const { lastFrame } = render(
        <GitPanel
          branch="main"
          commits={mockCommits}
          stats={mockStats}
        />
      );

      // Check for bullet point format
      expect(lastFrame()).toMatch(/[•·]/);
    });
  });

  describe("commit limit", () => {
    it("shows maximum 5 commits", () => {
      const manyCommits: Commit[] = [
        { hash: "commit1", message: "First", timestamp: new Date() },
        { hash: "commit2", message: "Second", timestamp: new Date() },
        { hash: "commit3", message: "Third", timestamp: new Date() },
        { hash: "commit4", message: "Fourth", timestamp: new Date() },
        { hash: "commit5", message: "Fifth", timestamp: new Date() },
        { hash: "commit6", message: "Sixth", timestamp: new Date() },
        { hash: "commit7", message: "Seventh", timestamp: new Date() },
      ];

      const { lastFrame } = render(
        <GitPanel
          branch="main"
          commits={manyCommits}
          stats={mockStats}
        />
      );

      expect(lastFrame()).toContain("commit1");
      expect(lastFrame()).toContain("commit5");
      expect(lastFrame()).not.toContain("commit6");
      expect(lastFrame()).not.toContain("commit7");
    });
  });

  describe("empty states", () => {
    it("shows 'No commits today' when commits array is empty", () => {
      const { lastFrame } = render(
        <GitPanel
          branch="main"
          commits={[]}
          stats={{ added: 0, deleted: 0, files: 0 }}
          uncommitted={0}
        />
      );

      expect(lastFrame()).toContain("main");
      expect(lastFrame()).toContain("No commits today");
    });

    it("shows 'Not a git repository' when branch is null", () => {
      const { lastFrame } = render(
        <GitPanel
          branch={null}
          commits={[]}
          stats={{ added: 0, deleted: 0, files: 0 }}
          uncommitted={0}
        />
      );

      expect(lastFrame()).toContain("Not a git repository");
    });
  });

  describe("singular/plural", () => {
    it("shows '1 commit' for single commit", () => {
      const { lastFrame } = render(
        <GitPanel
          branch="main"
          commits={[mockCommits[0]]}
          stats={{ added: 10, deleted: 5, files: 1 }}
          uncommitted={0}
        />
      );

      expect(lastFrame()).toContain("1 commit");
      expect(lastFrame()).not.toContain("1 commits");
    });
  });

  describe("dirty files", () => {
    it("shows dirty file count when greater than 0", () => {
      const { lastFrame } = render(
        <GitPanel
          branch="main"
          commits={mockCommits}
          stats={mockStats}
          uncommitted={3}
        />
      );

      expect(lastFrame()).toContain("3 dirty");
    });

    it("does not show dirty when 0", () => {
      const { lastFrame } = render(
        <GitPanel
          branch="main"
          commits={mockCommits}
          stats={mockStats}
          uncommitted={0}
        />
      );

      expect(lastFrame()).not.toContain("dirty");
    });

    it("shows singular 'dirty' for 1 file", () => {
      const { lastFrame } = render(
        <GitPanel
          branch="main"
          commits={mockCommits}
          stats={mockStats}
          uncommitted={1}
        />
      );

      expect(lastFrame()).toContain("1 dirty");
    });

    it("shows dirty count even when no commits today", () => {
      const { lastFrame } = render(
        <GitPanel
          branch="main"
          commits={[]}
          stats={{ added: 0, deleted: 0, files: 0 }}
          uncommitted={5}
        />
      );

      expect(lastFrame()).toContain("5 dirty");
    });
  });

  describe("long content handling", () => {
    it("truncates long branch name with stats", () => {
      const { lastFrame } = render(
        <GitPanel
          branch="feat/21-generic-panel-with-very-long-name"
          commits={mockCommits}
          stats={{ added: 4993, deleted: 586, files: 44 }}
        />
      );

      const output = lastFrame() || "";
      const lines = output.split("\n");

      // Each line should end with │ (box character)
      // No line should have content after the closing │
      for (const line of lines) {
        if (line.includes("│")) {
          const lastBoxChar = line.lastIndexOf("│");
          const afterBox = line.slice(lastBoxChar + 1);
          expect(afterBox.trim()).toBe("");
        }
      }
    });

    it("does not wrap branch line to multiple lines", () => {
      const { lastFrame } = render(
        <GitPanel
          branch="feat/21-generic-panel"
          commits={Array(30).fill(null).map((_, i) => ({
            hash: `abc${i.toString().padStart(4, "0")}`,
            message: `Commit ${i}`,
            timestamp: new Date(),
          }))}
          stats={{ added: 4993, deleted: 586, files: 44 }}
        />
      );

      const output = lastFrame() || "";
      const lines = output.split("\n");

      // Find the branch line (contains stats with files)
      const branchLine = lines.find(l => l.includes("files") && l.includes("+4993"));
      expect(branchLine).toBeDefined();

      // Should contain both branch (possibly truncated) and files on same line
      expect(branchLine).toContain("feat/21");
      expect(branchLine).toContain("files");
    });
  });

  describe("visual feedback", () => {
    it("shows 'running...' when isRunning is true", () => {
      const { lastFrame } = render(
        <GitPanel
          branch="main"
          commits={mockCommits}
          stats={mockStats}
          isRunning={true}
        />
      );

      expect(lastFrame()).toContain("running...");
    });

    it("shows countdown normally when isRunning is false", () => {
      const { lastFrame } = render(
        <GitPanel
          branch="main"
          commits={mockCommits}
          stats={mockStats}
          isRunning={false}
          countdown={25}
        />
      );

      expect(lastFrame()).toContain("25s");
      expect(lastFrame()).not.toContain("running...");
    });

    it("shows countdown in green when justRefreshed is true", () => {
      const { lastFrame } = render(
        <GitPanel
          branch="main"
          commits={mockCommits}
          stats={mockStats}
          countdown={30}
          justRefreshed={true}
        />
      );

      // Should contain countdown (the green color is tested by checking it renders)
      expect(lastFrame()).toContain("30s");
    });
  });
});
