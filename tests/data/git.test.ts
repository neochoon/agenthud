import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GitPanelConfig } from "../../src/config/parser.js";

// Mock child_process with partial mocking
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

import { execSync } from "child_process";
import {
  getCurrentBranch,
  getTodayCommits,
  getTodayStats,
  getUncommittedCount,
  getGitData,
  getGitDataAsync,
} from "../../src/data/git.js";

const mockExecSync = vi.mocked(execSync);

describe("git data module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getCurrentBranch", () => {
    it("returns the current branch name", () => {
      mockExecSync.mockReturnValue("main\n");

      const result = getCurrentBranch();

      expect(result).toBe("main");
      expect(mockExecSync).toHaveBeenCalledWith("git branch --show-current", {
        encoding: "utf-8",
      });
    });

    it("trims whitespace from branch name", () => {
      mockExecSync.mockReturnValue("  feat/test-branch  \n");

      const result = getCurrentBranch();

      expect(result).toBe("feat/test-branch");
    });

    it("returns null when not in a git repository", () => {
      mockExecSync.mockImplementation(() => {
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

      mockExecSync.mockReturnValue(gitOutput + "\n");

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
      mockExecSync.mockReturnValue("\n");

      const result = getTodayCommits();

      expect(result).toEqual([]);
    });

    it("returns empty array when not in a git repository", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("fatal: not a git repository");
      });

      const result = getTodayCommits();

      expect(result).toEqual([]);
    });

    it("handles commit messages with pipe characters", () => {
      const gitOutput = "abc1234|2025-01-09T10:00:00+09:00|fix: handle A | B case";

      mockExecSync.mockReturnValue(gitOutput + "\n");

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

      mockExecSync.mockReturnValue(gitOutput + "\n");

      const result = getTodayStats();

      expect(result).toEqual({
        added: 142,   // 10 + 50 + 82
        deleted: 23,  // 2 + 10 + 11
        files: 3,
      });
    });

    it("returns zeros when no changes", () => {
      mockExecSync.mockReturnValue("\n");

      const result = getTodayStats();

      expect(result).toEqual({
        added: 0,
        deleted: 0,
        files: 0,
      });
    });

    it("handles only insertions", () => {
      const gitOutput = [
        "30\t0\tsrc/new-file.ts",
        "20\t0\tsrc/another.ts",
      ].join("\n");

      mockExecSync.mockReturnValue(gitOutput + "\n");

      const result = getTodayStats();

      expect(result).toEqual({
        added: 50,
        deleted: 0,
        files: 2,
      });
    });

    it("handles only deletions", () => {
      const gitOutput = [
        "0\t5\tsrc/old-file.ts",
        "0\t5\tsrc/removed.ts",
      ].join("\n");

      mockExecSync.mockReturnValue(gitOutput + "\n");

      const result = getTodayStats();

      expect(result).toEqual({
        added: 0,
        deleted: 10,
        files: 2,
      });
    });

    it("handles binary files (shown as - in numstat)", () => {
      const gitOutput = [
        "10\t5\tsrc/code.ts",
        "-\t-\tassets/image.png",
        "20\t3\tsrc/other.ts",
      ].join("\n");

      mockExecSync.mockReturnValue(gitOutput + "\n");

      const result = getTodayStats();

      // Binary files should be skipped from line counts but counted in files
      expect(result).toEqual({
        added: 30,
        deleted: 8,
        files: 3,
      });
    });

    it("returns zeros when not in a git repository", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("fatal: not a git repository");
      });

      const result = getTodayStats();

      expect(result).toEqual({
        added: 0,
        deleted: 0,
        files: 0,
      });
    });
  });

  describe("getUncommittedCount", () => {
    // Uses git status --porcelain
    // Output format: XY filename (one per line)

    it("counts modified, added, and deleted files", () => {
      const gitOutput = [
        " M src/index.ts",
        "A  src/new-file.ts",
        " D src/deleted.ts",
        "?? src/untracked.ts",
      ].join("\n");

      mockExecSync.mockReturnValue(gitOutput + "\n");

      const result = getUncommittedCount();

      expect(result).toBe(4);
      expect(mockExecSync).toHaveBeenCalledWith("git status --porcelain", {
        encoding: "utf-8",
      });
    });

    it("returns 0 when working directory is clean", () => {
      mockExecSync.mockReturnValue("\n");

      const result = getUncommittedCount();

      expect(result).toBe(0);
    });

    it("returns 0 when not in a git repository", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("fatal: not a git repository");
      });

      const result = getUncommittedCount();

      expect(result).toBe(0);
    });

    it("handles staged and unstaged changes", () => {
      const gitOutput = [
        "MM src/both.ts",      // staged and unstaged
        "M  src/staged.ts",    // only staged
        " M src/unstaged.ts",  // only unstaged
      ].join("\n");

      mockExecSync.mockReturnValue(gitOutput + "\n");

      const result = getUncommittedCount();

      expect(result).toBe(3);
    });
  });

  describe("getGitData with config", () => {
    it("uses custom branch command from config", () => {
      const config: GitPanelConfig = {
        enabled: true,
        interval: 30000,
        command: {
          branch: "git rev-parse --abbrev-ref HEAD",
        },
      };

      mockExecSync.mockReturnValue("feature-branch\n");

      const result = getGitData(config);

      expect(mockExecSync).toHaveBeenCalledWith(
        "git rev-parse --abbrev-ref HEAD",
        expect.any(Object)
      );
      expect(result.branch).toBe("feature-branch");
    });

    it("uses custom commits command from config", () => {
      const config: GitPanelConfig = {
        enabled: true,
        interval: 30000,
        command: {
          commits: 'git log -5 --format="%h|%aI|%s"',
        },
      };

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes("log -5")) {
          return "abc1234|2026-01-10T10:00:00+00:00|Test commit\n";
        }
        if (cmd.includes("branch")) return "main\n";
        return "\n";
      });

      const result = getGitData(config);

      expect(result.commits).toHaveLength(1);
      expect(result.commits[0].hash).toBe("abc1234");
    });

    it("uses custom stats command from config", () => {
      const config: GitPanelConfig = {
        enabled: true,
        interval: 30000,
        command: {
          stats: 'git diff --stat HEAD~1',
        },
      };

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes("diff --stat")) {
          return "10\t5\tsrc/file.ts\n";
        }
        if (cmd.includes("branch")) return "main\n";
        return "\n";
      });

      const result = getGitData(config);

      expect(result.stats.added).toBe(10);
      expect(result.stats.deleted).toBe(5);
    });

    it("uses default commands when config.command is undefined", () => {
      const config: GitPanelConfig = {
        enabled: true,
        interval: 30000,
      };

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes("branch --show-current")) return "main\n";
        if (cmd.includes("--since=midnight")) return "\n";
        if (cmd.includes("--porcelain")) return "\n";
        return "\n";
      });

      const result = getGitData(config);

      expect(result.branch).toBe("main");
      expect(mockExecSync).toHaveBeenCalledWith(
        "git branch --show-current",
        expect.any(Object)
      );
    });

    it("returns all git data in one call", () => {
      const config: GitPanelConfig = {
        enabled: true,
        interval: 30000,
      };

      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes("branch --show-current")) return "main\n";
        if (cmd.includes('--format="%h|%aI|%s"')) {
          return "abc1234|2026-01-10T10:00:00+00:00|Commit 1\n";
        }
        if (cmd.includes("--numstat")) return "10\t5\tsrc/file.ts\n";
        if (cmd.includes("--porcelain")) return " M file.ts\n";
        return "\n";
      });

      const result = getGitData(config);

      expect(result.branch).toBe("main");
      expect(result.commits).toHaveLength(1);
      expect(result.stats).toEqual({ added: 10, deleted: 5, files: 1 });
      expect(result.uncommitted).toBe(1);
    });
  });

  describe("getGitDataAsync", () => {
    it("returns branch from async command", async () => {
      const config: GitPanelConfig = {
        enabled: true,
        interval: 30000,
        command: {
          branch: "echo main",
        },
      };

      // Need to set sync mock for uncommitted count
      mockExecSync.mockReturnValue("\n");

      const result = await getGitDataAsync(config);

      expect(result.branch).toBe("main");
    });

    it("returns commits from async command", async () => {
      const config: GitPanelConfig = {
        enabled: true,
        interval: 30000,
        command: {
          branch: "echo main",
          commits: 'echo "abc1234|2026-01-10T10:00:00+00:00|Test commit"',
        },
      };

      mockExecSync.mockReturnValue("\n");

      const result = await getGitDataAsync(config);

      expect(result.commits).toHaveLength(1);
      expect(result.commits[0].hash).toBe("abc1234");
      expect(result.commits[0].message).toBe("Test commit");
    });

    it("returns stats from async command", async () => {
      const config: GitPanelConfig = {
        enabled: true,
        interval: 30000,
        command: {
          branch: "echo main",
          commits: "echo ''",
          stats: 'printf "15\\t3\\tsrc/file.ts"',
        },
      };

      mockExecSync.mockReturnValue("\n");

      const result = await getGitDataAsync(config);

      expect(result.stats.added).toBe(15);
      expect(result.stats.deleted).toBe(3);
      expect(result.stats.files).toBe(1);
    });

    it("handles binary files in stats", async () => {
      const config: GitPanelConfig = {
        enabled: true,
        interval: 30000,
        command: {
          branch: "echo main",
          commits: "echo ''",
          stats: 'printf "10\\t5\\tcode.ts\\n-\\t-\\timage.png"',
        },
      };

      mockExecSync.mockReturnValue("\n");

      const result = await getGitDataAsync(config);

      expect(result.stats.added).toBe(10);
      expect(result.stats.deleted).toBe(5);
      expect(result.stats.files).toBe(2);
    });

    it("handles branch command failure", async () => {
      const config: GitPanelConfig = {
        enabled: true,
        interval: 30000,
        command: {
          branch: "exit 1",
          commits: "echo ''",
        },
      };

      mockExecSync.mockReturnValue("\n");

      const result = await getGitDataAsync(config);

      expect(result.branch).toBeNull();
    });

    it("handles commits command failure", async () => {
      const config: GitPanelConfig = {
        enabled: true,
        interval: 30000,
        command: {
          branch: "echo main",
          commits: "exit 1",
        },
      };

      mockExecSync.mockReturnValue("\n");

      const result = await getGitDataAsync(config);

      expect(result.commits).toEqual([]);
    });

    it("handles stats command failure", async () => {
      const config: GitPanelConfig = {
        enabled: true,
        interval: 30000,
        command: {
          branch: "echo main",
          commits: "echo ''",
          stats: "exit 1",
        },
      };

      mockExecSync.mockReturnValue("\n");

      const result = await getGitDataAsync(config);

      expect(result.stats).toEqual({ added: 0, deleted: 0, files: 0 });
    });
  });
});
