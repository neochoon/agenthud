import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TestsPanelConfig } from "../../src/config/parser.js";

// Mock fs and child_process with partial mocking
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

import { readFileSync } from "fs";
import { execSync } from "child_process";
import { getTestData, getTestDataWithConfig } from "../../src/data/tests.js";

const mockReadFileSync = vi.mocked(readFileSync);
const mockExecSync = vi.mocked(execSync);

describe("test data module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

      mockReadFileSync.mockReturnValue(JSON.stringify(testResults));
      mockExecSync.mockReturnValue("abc1234\n");

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

      mockReadFileSync.mockReturnValue(JSON.stringify(testResults));
      mockExecSync
        .mockReturnValueOnce("def5678\n")  // getHeadHash
        .mockReturnValueOnce("3\n");        // getCommitCount

      const result = getTestData();

      expect(result.results).toEqual(testResults);
      expect(result.isOutdated).toBe(true);
      expect(result.commitsBehind).toBe(3);
    });

    it("returns null results with error when file is missing", () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      const result = getTestData();

      expect(result.results).toBeNull();
      expect(result.error).toBe("No test results");
    });

    it("returns null results with error when JSON is invalid", () => {
      mockReadFileSync.mockReturnValue("{ invalid json }");

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

      mockReadFileSync.mockReturnValue(JSON.stringify(testResults));
      mockExecSync.mockImplementation(() => {
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

      mockReadFileSync.mockReturnValue(JSON.stringify(testResults));
      mockExecSync.mockReturnValue("abc1234\n");

      const result = getTestDataWithConfig(config);

      expect(result.results).toEqual(testResults);
      expect(mockReadFileSync).toHaveBeenCalledWith(".agenthud/tests/results.json", "utf-8");
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

      mockReadFileSync.mockReturnValue(JSON.stringify(testResults));
      mockExecSync.mockReturnValue("def5678\n");

      const result = getTestDataWithConfig(config);

      expect(result.results).toEqual(testResults);
      expect(mockReadFileSync).toHaveBeenCalledWith(expect.stringContaining("test-results.json"), "utf-8");
    });

    it("returns error when source file does not exist", () => {
      const config: TestsPanelConfig = {
        enabled: true,
        interval: null,
        source: ".agenthud/tests/results.json",
      };

      mockReadFileSync.mockImplementation(() => {
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

      mockReadFileSync.mockReturnValue(JSON.stringify(testResults));
      mockExecSync
        .mockReturnValueOnce("new5678\n")  // getHeadHash
        .mockReturnValueOnce("5\n");        // getCommitCount

      const result = getTestDataWithConfig(config);

      expect(result.isOutdated).toBe(true);
      expect(result.commitsBehind).toBe(5);
    });

    it("parses JUnit XML format when source ends with .xml", () => {
      const config: TestsPanelConfig = {
        enabled: true,
        interval: null,
        source: ".agenthud/test-results.xml",
      };

      const junitXml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" tests="10" errors="0" failures="2" skipped="1">
    <testcase classname="test_foo" name="test_passes" time="0.001"/>
    <testcase classname="test_foo" name="test_fails" time="0.002">
      <failure message="AssertionError">assert 1 == 2</failure>
    </testcase>
    <testcase classname="test_bar" name="test_error" time="0.003">
      <failure message="Error">error</failure>
    </testcase>
  </testsuite>
</testsuites>`;

      mockReadFileSync.mockReturnValue(junitXml);
      mockExecSync.mockReturnValue("abc1234\n");

      const result = getTestDataWithConfig(config);

      expect(result.results).not.toBeNull();
      expect(result.results!.passed).toBe(7);
      expect(result.results!.failed).toBe(2);
      expect(result.results!.skipped).toBe(1);
      expect(result.results!.failures).toHaveLength(2);
    });

    it("returns error when JUnit XML is invalid", () => {
      const config: TestsPanelConfig = {
        enabled: true,
        interval: null,
        source: ".agenthud/test-results.xml",
      };

      mockReadFileSync.mockReturnValue("not valid xml");

      const result = getTestDataWithConfig(config);

      expect(result.results).toBeNull();
      expect(result.error).toBe("Invalid test-results.xml");
    });
  });
});
