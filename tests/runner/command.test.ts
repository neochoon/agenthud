import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process module
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

// Mock fs module
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    unlinkSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import {
  parseJUnitXml,
  parseVitestOutput,
  runTestCommand,
} from "../../src/runner/command.js";

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockUnlinkSync = vi.mocked(unlinkSync);
const mockReadFileSync = vi.mocked(readFileSync);

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
          assertionResults: [{ title: "another failure", status: "failed" }],
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

describe("parseJUnitXml", () => {
  it("parses successful JUnit XML output", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" tests="10" errors="0" failures="0" skipped="2">
    <testcase classname="test_foo" name="test_passes" time="0.001"/>
    <testcase classname="test_foo" name="test_also_passes" time="0.002"/>
  </testsuite>
</testsuites>`;

    const result = parseJUnitXml(xml);

    expect(result).not.toBeNull();
    expect(result?.passed).toBe(8);
    expect(result?.failed).toBe(0);
    expect(result?.skipped).toBe(2);
    expect(result?.failures).toEqual([]);
  });

  it("parses JUnit XML with failures", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" tests="5" errors="1" failures="1" skipped="0">
    <testcase classname="test_foo" name="test_passes" time="0.001"/>
    <testcase classname="test_foo" name="test_fails" time="0.002">
      <failure message="AssertionError">assert 1 == 2</failure>
    </testcase>
    <testcase classname="test_bar" name="test_error" time="0.003">
      <error message="RuntimeError">something went wrong</error>
    </testcase>
  </testsuite>
</testsuites>`;

    const result = parseJUnitXml(xml);

    expect(result).not.toBeNull();
    expect(result?.passed).toBe(3);
    expect(result?.failed).toBe(2);
    expect(result?.failures).toHaveLength(2);
    expect(result?.failures[0]).toEqual({
      file: "test_foo",
      name: "test_fails",
    });
    expect(result?.failures[1]).toEqual({
      file: "test_bar",
      name: "test_error",
    });
  });

  it("handles multiple testsuites", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="suite1" tests="3" errors="0" failures="1" skipped="0">
    <testcase classname="test_a" name="test_one" time="0.001">
      <failure>failed</failure>
    </testcase>
  </testsuite>
  <testsuite name="suite2" tests="2" errors="0" failures="0" skipped="1">
    <testcase classname="test_b" name="test_two" time="0.001"/>
  </testsuite>
</testsuites>`;

    const result = parseJUnitXml(xml);

    expect(result).not.toBeNull();
    expect(result?.passed).toBe(3);
    expect(result?.failed).toBe(1);
    expect(result?.skipped).toBe(1);
  });

  it("returns null for invalid XML", () => {
    const result = parseJUnitXml("not xml at all");

    expect(result).toBeNull();
  });

  it("returns null for XML without testsuites", () => {
    const result = parseJUnitXml("<root><item/></root>");

    expect(result).toBeNull();
  });

  it("handles single testsuite without testsuites wrapper", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuite name="pytest" tests="3" errors="0" failures="0" skipped="0">
  <testcase classname="test_foo" name="test_one" time="0.001"/>
</testsuite>`;

    const result = parseJUnitXml(xml);

    expect(result).not.toBeNull();
    expect(result?.passed).toBe(3);
    expect(result?.failed).toBe(0);
  });
});

describe("runTestCommand", () => {
  const sampleXml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="test" tests="5" errors="0" failures="0" skipped="0">
    <testcase classname="test_foo" name="test_one" time="0.001"/>
  </testsuite>
</testsuites>`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("deletes existing file, runs command, and parses XML output", () => {
    // File exists initially, command runs, file is recreated
    mockExistsSync
      .mockReturnValueOnce(true) // check before delete
      .mockReturnValueOnce(true); // check after command
    mockReadFileSync.mockReturnValue(sampleXml);
    mockExecSync.mockReturnValue("");

    const result = runTestCommand("npm test");

    expect(mockUnlinkSync).toHaveBeenCalled();
    expect(mockExecSync).toHaveBeenCalledWith("npm test", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(result.results?.passed).toBe(5);
    expect(result.error).toBeUndefined();
  });

  it("returns error when command fails and no output file created", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("Command failed");
    });
    mockExistsSync
      .mockReturnValueOnce(false) // no file before
      .mockReturnValueOnce(false); // no file after (command failed)

    const result = runTestCommand("npm test");

    expect(result.results).toBeNull();
    expect(result.error).toBe("Test command failed to produce output file");
  });

  it("parses output even when command exits non-zero (test failures)", () => {
    // Command throws (non-zero exit), but file was still created
    mockExecSync.mockImplementation(() => {
      throw new Error("Tests failed");
    });
    mockExistsSync
      .mockReturnValueOnce(false) // no file before
      .mockReturnValueOnce(true); // file created despite exit code
    mockReadFileSync.mockReturnValue(sampleXml);

    const result = runTestCommand("npm test");

    expect(result.results?.passed).toBe(5);
    expect(result.error).toBeUndefined();
  });

  it("returns error when output file is not valid XML", () => {
    mockExistsSync
      .mockReturnValueOnce(false) // no file before
      .mockReturnValueOnce(true); // file created after command
    mockReadFileSync.mockReturnValue("not valid xml at all");
    mockExecSync.mockReturnValue("");

    const result = runTestCommand("npm test");

    expect(result.results).toBeNull();
    expect(result.error).toBe("Failed to parse test results XML");
  });

  it("includes current git hash in results", () => {
    mockExecSync.mockImplementation((cmd: any) => {
      if (String(cmd).includes("rev-parse")) {
        return "abc1234\n";
      }
      return "";
    });
    mockExistsSync
      .mockReturnValueOnce(false) // no file before
      .mockReturnValueOnce(true); // file created after command
    mockReadFileSync.mockReturnValue(sampleXml);

    const result = runTestCommand("npm test");

    expect(result.results?.hash).toBe("abc1234");
  });

  it("includes timestamp in results", () => {
    mockExistsSync
      .mockReturnValueOnce(false) // no file before
      .mockReturnValueOnce(true); // file created after command
    mockReadFileSync.mockReturnValue(sampleXml);
    mockExecSync.mockReturnValue("");

    const before = new Date().toISOString();
    const result = runTestCommand("npm test");
    const after = new Date().toISOString();

    expect(result.results?.timestamp).toBeDefined();
    expect(result.results?.timestamp >= before).toBe(true);
    expect(result.results?.timestamp <= after).toBe(true);
  });
});
