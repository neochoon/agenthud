import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runTestCommand,
  parseVitestOutput,
  setExecFn,
  resetExecFn,
} from "../src/runner/command.js";
import type { TestResults } from "../src/types/index.js";

describe("parseVitestOutput", () => {
  it("parses successful vitest JSON output", () => {
    const output = JSON.stringify({
      numPassedTests: 10,
      numFailedTests: 0,
      numPendingTests: 2,
      testResults: [],
    });

    const result = parseVitestOutput(output);

    expect(result.passed).toBe(10);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.failures).toEqual([]);
  });

  it("parses vitest output with failures", () => {
    const output = JSON.stringify({
      numPassedTests: 8,
      numFailedTests: 2,
      numPendingTests: 0,
      testResults: [
        {
          name: "tests/foo.test.ts",
          assertionResults: [
            { title: "test passes", status: "passed" },
            { title: "test fails", status: "failed" },
          ],
        },
        {
          name: "tests/bar.test.ts",
          assertionResults: [
            { title: "another failure", status: "failed" },
          ],
        },
      ],
    });

    const result = parseVitestOutput(output);

    expect(result.passed).toBe(8);
    expect(result.failed).toBe(2);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toEqual({
      file: "tests/foo.test.ts",
      name: "test fails",
    });
    expect(result.failures[1]).toEqual({
      file: "tests/bar.test.ts",
      name: "another failure",
    });
  });

  it("returns null for invalid JSON", () => {
    const result = parseVitestOutput("not json");

    expect(result).toBeNull();
  });

  it("returns null for missing fields", () => {
    const result = parseVitestOutput("{}");

    expect(result).toBeNull();
  });
});

describe("runTestCommand", () => {
  let mockExec: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExec = vi.fn();
    setExecFn(mockExec);
  });

  afterEach(() => {
    resetExecFn();
  });

  it("runs command and parses output", () => {
    mockExec.mockReturnValue(
      JSON.stringify({
        numPassedTests: 5,
        numFailedTests: 0,
        numPendingTests: 0,
        testResults: [],
      })
    );

    const result = runTestCommand("npm test -- --reporter=json");

    expect(mockExec).toHaveBeenCalledWith("npm test -- --reporter=json", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(result.results?.passed).toBe(5);
    expect(result.error).toBeUndefined();
  });

  it("returns error when command fails", () => {
    mockExec.mockImplementation(() => {
      throw new Error("Command failed");
    });

    const result = runTestCommand("npm test");

    expect(result.results).toBeNull();
    expect(result.error).toContain("Command failed");
  });

  it("returns error when output is not valid JSON", () => {
    mockExec.mockReturnValue("Some non-JSON output\nwith multiple lines");

    const result = runTestCommand("npm test");

    expect(result.results).toBeNull();
    expect(result.error).toBe("Failed to parse test output");
  });

  it("includes current git hash in results", () => {
    mockExec.mockImplementation((cmd: string) => {
      if (cmd.includes("rev-parse")) {
        return "abc1234\n";
      }
      return JSON.stringify({
        numPassedTests: 5,
        numFailedTests: 0,
        numPendingTests: 0,
        testResults: [],
      });
    });

    const result = runTestCommand("npm test");

    expect(result.results?.hash).toBe("abc1234");
  });

  it("includes timestamp in results", () => {
    mockExec.mockReturnValue(
      JSON.stringify({
        numPassedTests: 5,
        numFailedTests: 0,
        numPendingTests: 0,
        testResults: [],
      })
    );

    const before = new Date().toISOString();
    const result = runTestCommand("npm test");
    const after = new Date().toISOString();

    expect(result.results?.timestamp).toBeDefined();
    expect(result.results!.timestamp >= before).toBe(true);
    expect(result.results!.timestamp <= after).toBe(true);
  });
});
