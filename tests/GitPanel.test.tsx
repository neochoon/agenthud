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

  const mockStats: GitStats = { added: 142, deleted: 23 };

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
          stats={{ added: 0, deleted: 0 }}
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
          stats={{ added: 0, deleted: 0 }}
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
          stats={{ added: 10, deleted: 5 }}
        />
      );

      expect(lastFrame()).toContain("1 commit");
      expect(lastFrame()).not.toContain("1 commits");
    });
  });
});
