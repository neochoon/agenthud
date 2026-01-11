import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getTestData,
  getTestDataWithConfig,
  setReadFileFn,
  resetReadFileFn,
  setGetHeadHashFn,
  resetGetHeadHashFn,
  setGetCommitCountFn,
  resetGetCommitCountFn,
} from "../src/data/tests.js";
import type { TestsPanelConfig } from "../src/config/parser.js";

describe("test data module", () => {
  let mockReadFile: ReturnType<typeof vi.fn>;
  let mockGetHeadHash: ReturnType<typeof vi.fn>;
  let mockGetCommitCount: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockReadFile = vi.fn();
    mockGetHeadHash = vi.fn();
    mockGetCommitCount = vi.fn();
    setReadFileFn(mockReadFile);
    setGetHeadHashFn(mockGetHeadHash);
    setGetCommitCountFn(mockGetCommitCount);
  });

  afterEach(() => {
    resetReadFileFn();
    resetGetHeadHashFn();
    resetGetCommitCountFn();
  });

  describe("getTestData", () => {
    it("returns test results when file exists and hash matches HEAD", () => {
      const testResults = {
        hash: "abc1234",
        timestamp: "2026-01-09T16:00:00Z",
        passed: 30,
        failed: 2,
        skipped: 1,
        failures: [{ file: "tests/git.test.ts", name: "returns null" }],
      };

      mockReadFile.mockReturnValue(JSON.stringify(testResults));
      mockGetHeadHash.mockReturnValue("abc1234");
      mockGetCommitCount.mockReturnValue(0);

      const result = getTestData();

      expect(result.results).toEqual(testResults);
      expect(result.isOutdated).toBe(false);
      expect(result.commitsBehind).toBe(0);
      expect(result.error).toBeUndefined();
    });

    it("marks as outdated when hash differs from HEAD", () => {
      const testResults = {
        hash: "abc1234",
        timestamp: "2026-01-09T16:00:00Z",
        passed: 30,
        failed: 0,
        skipped: 0,
        failures: [],
      };

      mockReadFile.mockReturnValue(JSON.stringify(testResults));
      mockGetHeadHash.mockReturnValue("def5678");
      mockGetCommitCount.mockReturnValue(3);

      const result = getTestData();

      expect(result.results).toEqual(testResults);
      expect(result.isOutdated).toBe(true);
      expect(result.commitsBehind).toBe(3);
    });

    it("returns null results with error when file is missing", () => {
      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      const result = getTestData();

      expect(result.results).toBeNull();
      expect(result.error).toBe("No test results");
    });

    it("returns null results with error when JSON is invalid", () => {
      mockReadFile.mockReturnValue("{ invalid json }");

      const result = getTestData();

      expect(result.results).toBeNull();
      expect(result.error).toBe("Invalid test-results.json");
    });

    it("handles git errors gracefully", () => {
      const testResults = {
        hash: "abc1234",
        timestamp: "2026-01-09T16:00:00Z",
        passed: 10,
        failed: 0,
        skipped: 0,
        failures: [],
      };

      mockReadFile.mockReturnValue(JSON.stringify(testResults));
      mockGetHeadHash.mockImplementation(() => {
        throw new Error("not a git repo");
      });

      const result = getTestData();

      expect(result.results).toEqual(testResults);
      expect(result.isOutdated).toBe(false);
      expect(result.commitsBehind).toBe(0);
    });
  });

  describe("getTestDataWithConfig", () => {
    it("reads from source path when provided", () => {
      const config: TestsPanelConfig = {
        enabled: true,
        interval: null,
        source: ".agenthud/tests/results.json",
      };

      const testResults = {
        hash: "abc1234",
        timestamp: "2026-01-09T16:00:00Z",
        passed: 15,
        failed: 0,
        skipped: 2,
        failures: [],
      };

      mockReadFile.mockReturnValue(JSON.stringify(testResults));
      mockGetHeadHash.mockReturnValue("abc1234");

      const result = getTestDataWithConfig(config);

      expect(result.results).toEqual(testResults);
      expect(mockReadFile).toHaveBeenCalledWith(".agenthud/tests/results.json");
    });

    it("falls back to default path when source not provided", () => {
      const config: TestsPanelConfig = {
        enabled: true,
        interval: null,
        command: "npm test",
      };

      const testResults = {
        hash: "def5678",
        timestamp: "2026-01-09T17:00:00Z",
        passed: 20,
        failed: 1,
        skipped: 0,
        failures: [],
      };

      mockReadFile.mockReturnValue(JSON.stringify(testResults));
      mockGetHeadHash.mockReturnValue("def5678");

      const result = getTestDataWithConfig(config);

      expect(result.results).toEqual(testResults);
      expect(mockReadFile).toHaveBeenCalledWith(expect.stringContaining("test-results.json"));
    });

    it("returns error when source file does not exist", () => {
      const config: TestsPanelConfig = {
        enabled: true,
        interval: null,
        source: ".agenthud/tests/results.json",
      };

      mockReadFile.mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      const result = getTestDataWithConfig(config);

      expect(result.results).toBeNull();
      expect(result.error).toBe("No test results");
    });

    it("checks outdated status with config source", () => {
      const config: TestsPanelConfig = {
        enabled: true,
        interval: null,
        source: ".agenthud/tests/results.json",
      };

      const testResults = {
        hash: "old1234",
        timestamp: "2026-01-09T16:00:00Z",
        passed: 10,
        failed: 0,
        skipped: 0,
        failures: [],
      };

      mockReadFile.mockReturnValue(JSON.stringify(testResults));
      mockGetHeadHash.mockReturnValue("new5678");
      mockGetCommitCount.mockReturnValue(5);

      const result = getTestDataWithConfig(config);

      expect(result.isOutdated).toBe(true);
      expect(result.commitsBehind).toBe(5);
    });
  });
});
