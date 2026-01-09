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
    // Uses git log --since=midnight --numstat --format=""
    // Output format: <added>\t<deleted>\t<filename>

    it("sums lines added and deleted from numstat output", () => {
      const gitOutput = [
        "10\t2\tsrc/index.ts",
        "50\t10\tsrc/app.ts",
        "82\t11\ttests/app.test.ts",
      ].join("\n");

      mockExec.mockReturnValue(gitOutput + "\n");

      const result = getTodayStats();

      expect(result).toEqual({
        added: 142,   // 10 + 50 + 82
        deleted: 23,  // 2 + 10 + 11
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
      const gitOutput = [
        "30\t0\tsrc/new-file.ts",
        "20\t0\tsrc/another.ts",
      ].join("\n");

      mockExec.mockReturnValue(gitOutput + "\n");

      const result = getTodayStats();

      expect(result).toEqual({
        added: 50,
        deleted: 0,
      });
    });

    it("handles only deletions", () => {
      const gitOutput = [
        "0\t5\tsrc/old-file.ts",
        "0\t5\tsrc/removed.ts",
      ].join("\n");

      mockExec.mockReturnValue(gitOutput + "\n");

      const result = getTodayStats();

      expect(result).toEqual({
        added: 0,
        deleted: 10,
      });
    });

    it("handles binary files (shown as - in numstat)", () => {
      const gitOutput = [
        "10\t5\tsrc/code.ts",
        "-\t-\tassets/image.png",
        "20\t3\tsrc/other.ts",
      ].join("\n");

      mockExec.mockReturnValue(gitOutput + "\n");

      const result = getTodayStats();

      // Binary files should be skipped
      expect(result).toEqual({
        added: 30,
        deleted: 8,
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
