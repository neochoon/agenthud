import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCurrentBranch,
  getTodayCommits,
  getTodayStats,
  setExecFn,
  resetExecFn,
} from "../src/data/git.js";

describe("git data module", () => {
  let mockExec: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExec = vi.fn();
    setExecFn(mockExec);
  });

  afterEach(() => {
    resetExecFn();
  });

  describe("getCurrentBranch", () => {
    it("returns the current branch name", () => {
      mockExec.mockReturnValue("main\n");

      const result = getCurrentBranch();

      expect(result).toBe("main");
      expect(mockExec).toHaveBeenCalledWith("git branch --show-current", {
        encoding: "utf-8",
      });
    });

    it("trims whitespace from branch name", () => {
      mockExec.mockReturnValue("  feat/test-branch  \n");

      const result = getCurrentBranch();

      expect(result).toBe("feat/test-branch");
    });

    it("returns null when not in a git repository", () => {
      mockExec.mockImplementation(() => {
        throw new Error("fatal: not a git repository");
      });

      const result = getCurrentBranch();

      expect(result).toBeNull();
    });
  });

  describe("getTodayCommits", () => {
    it("returns list of commits since midnight", () => {
      const gitOutput = [
        "abc1234|2025-01-09T10:30:00+09:00|Add login feature",
        "def5678|2025-01-09T09:00:00+09:00|Initial commit",
      ].join("\n");

      mockExec.mockReturnValue(gitOutput + "\n");

      const result = getTodayCommits();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        hash: "abc1234",
        message: "Add login feature",
        timestamp: new Date("2025-01-09T10:30:00+09:00"),
      });
      expect(result[1]).toEqual({
        hash: "def5678",
        message: "Initial commit",
        timestamp: new Date("2025-01-09T09:00:00+09:00"),
      });
      // Verify timestamp is parsed as Date object
      expect(result[0].timestamp).toBeInstanceOf(Date);
      expect(result[1].timestamp).toBeInstanceOf(Date);
    });

    it("returns empty array when no commits today", () => {
      mockExec.mockReturnValue("\n");

      const result = getTodayCommits();

      expect(result).toEqual([]);
    });

    it("returns empty array when not in a git repository", () => {
      mockExec.mockImplementation(() => {
        throw new Error("fatal: not a git repository");
      });

      const result = getTodayCommits();

      expect(result).toEqual([]);
    });

    it("handles commit messages with pipe characters", () => {
      const gitOutput = "abc1234|2025-01-09T10:00:00+09:00|fix: handle A | B case";

      mockExec.mockReturnValue(gitOutput + "\n");

      const result = getTodayCommits();

      expect(result[0].message).toBe("fix: handle A | B case");
    });
  });

  describe("getTodayStats", () => {
    it("returns lines added and deleted", () => {
      const gitOutput = " 3 files changed, 142 insertions(+), 23 deletions(-)";

      mockExec.mockReturnValue(gitOutput + "\n");

      const result = getTodayStats();

      expect(result).toEqual({
        added: 142,
        deleted: 23,
      });
    });

    it("returns zeros when no changes", () => {
      mockExec.mockReturnValue("\n");

      const result = getTodayStats();

      expect(result).toEqual({
        added: 0,
        deleted: 0,
      });
    });

    it("handles only insertions", () => {
      const gitOutput = " 1 file changed, 50 insertions(+)";

      mockExec.mockReturnValue(gitOutput + "\n");

      const result = getTodayStats();

      expect(result).toEqual({
        added: 50,
        deleted: 0,
      });
    });

    it("handles only deletions", () => {
      const gitOutput = " 1 file changed, 10 deletions(-)";

      mockExec.mockReturnValue(gitOutput + "\n");

      const result = getTodayStats();

      expect(result).toEqual({
        added: 0,
        deleted: 10,
      });
    });

    it("returns zeros when not in a git repository", () => {
      mockExec.mockImplementation(() => {
        throw new Error("fatal: not a git repository");
      });

      const result = getTodayStats();

      expect(result).toEqual({
        added: 0,
        deleted: 0,
      });
    });
  });
});
