import { execSync as nodeExecSync } from "child_process";
import type { TestResults, TestFailure, TestData } from "../types/index.js";

type ExecFn = (
  command: string,
  options: { encoding: string; stdio: string[] }
) => string;

let execFn: ExecFn = (command, options) =>
  nodeExecSync(command, options as Parameters<typeof nodeExecSync>[1]) as string;

export function setExecFn(fn: ExecFn): void {
  execFn = fn;
}

export function resetExecFn(): void {
  execFn = (command, options) =>
    nodeExecSync(command, options as Parameters<typeof nodeExecSync>[1]) as string;
}

interface VitestOutput {
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests?: number;
  testResults: Array<{
    name: string;
    assertionResults: Array<{
      title: string;
      status: "passed" | "failed" | "pending";
    }>;
  }>;
}

interface ParsedResults {
  passed: number;
  failed: number;
  skipped: number;
  failures: TestFailure[];
}

export function parseVitestOutput(output: string): ParsedResults | null {
  try {
    const data = JSON.parse(output) as VitestOutput;

    if (
      typeof data.numPassedTests !== "number" ||
      typeof data.numFailedTests !== "number"
    ) {
      return null;
    }

    const failures: TestFailure[] = [];

    for (const testResult of data.testResults || []) {
      for (const assertion of testResult.assertionResults || []) {
        if (assertion.status === "failed") {
          failures.push({
            file: testResult.name,
            name: assertion.title,
          });
        }
      }
    }

    return {
      passed: data.numPassedTests,
      failed: data.numFailedTests,
      skipped: data.numPendingTests || 0,
      failures,
    };
  } catch {
    return null;
  }
}

function getHeadHash(): string {
  try {
    return execFn("git rev-parse --short HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "unknown";
  }
}

export function runTestCommand(command: string): TestData {
  let output: string;

  try {
    output = execFn(command, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      results: null,
      isOutdated: false,
      commitsBehind: 0,
      error: message,
    };
  }

  const parsed = parseVitestOutput(output);

  if (!parsed) {
    return {
      results: null,
      isOutdated: false,
      commitsBehind: 0,
      error: "Failed to parse test output",
    };
  }

  const hash = getHeadHash();
  const timestamp = new Date().toISOString();

  const results: TestResults = {
    hash,
    timestamp,
    passed: parsed.passed,
    failed: parsed.failed,
    skipped: parsed.skipped,
    failures: parsed.failures,
  };

  return {
    results,
    isOutdated: false,
    commitsBehind: 0,
  };
}
