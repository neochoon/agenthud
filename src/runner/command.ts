import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { TEST_RESULTS_FILE } from "../data/detectTestFramework.js";
import type { TestData, TestFailure, TestResults } from "../types/index.js";

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

export function parseJUnitXml(xml: string): ParsedResults | null {
  try {
    // Check if this looks like XML
    if (!xml.includes("<testsuite") && !xml.includes("<testsuites")) {
      return null;
    }

    let totalTests = 0;
    let totalErrors = 0;
    let totalFailures = 0;
    let totalSkipped = 0;
    const failures: TestFailure[] = [];

    // Find all testsuite elements - handle both self-closing and with content
    // Match either <testsuite ...>...</testsuite> or <testsuite ... />
    // Use word boundary \b to avoid matching <testsuites>
    const testsuiteMatches =
      xml.match(/<testsuite\b[^>]*(?:\/>|>[\s\S]*?<\/testsuite>)/g) || [];

    // If inside <testsuites>, we should have matches
    // If no matches but we have <testsuite, treat the whole XML as the suite
    const testsuites = testsuiteMatches.length > 0 ? testsuiteMatches : [xml];

    for (const suite of testsuites) {
      // Extract attributes from testsuite tag
      const suiteTag = suite.match(/<testsuite[^>]*>/)?.[0] || "";

      const testsMatch = suiteTag.match(/tests="(\d+)"/);
      const errorsMatch = suiteTag.match(/errors="(\d+)"/);
      const failuresMatch = suiteTag.match(/failures="(\d+)"/);
      const skippedMatch = suiteTag.match(/skipped="(\d+)"/);

      totalTests += testsMatch ? parseInt(testsMatch[1], 10) : 0;
      totalErrors += errorsMatch ? parseInt(errorsMatch[1], 10) : 0;
      totalFailures += failuresMatch ? parseInt(failuresMatch[1], 10) : 0;
      totalSkipped += skippedMatch ? parseInt(skippedMatch[1], 10) : 0;

      // Find testcases with failures or errors
      // Handle both <testcase ...>...</testcase> and <testcase ... /> (self-closing)
      // Use [^/>]* before (?:\/>) to avoid consuming the / in self-closing tags
      const testcaseRegex =
        /<testcase[^>]*classname="([^"]*)"[^>]*name="([^"]*)"[^/>]*(?:\/>|>[\s\S]*?<\/testcase>)/g;
      const testcaseMatches = suite.matchAll(testcaseRegex);

      for (const testcaseMatch of testcaseMatches) {
        const testcaseContent = testcaseMatch[0];
        const classname = testcaseMatch[1];
        const name = testcaseMatch[2];

        // Only self-closing testcases don't have failures
        // Non-self-closing testcases need to check for failure/error elements
        if (
          testcaseContent.includes("<failure") ||
          testcaseContent.includes("<error")
        ) {
          failures.push({
            file: classname,
            name: name,
          });
        }
      }
    }

    if (totalTests === 0 && testsuiteMatches.length === 0) {
      return null;
    }

    const failed = totalFailures + totalErrors;
    const passed = totalTests - failed - totalSkipped;

    return {
      passed,
      failed,
      skipped: totalSkipped,
      failures,
    };
  } catch {
    return null;
  }
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
    return (
      execSync("git rev-parse --short HEAD", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }) as string
    ).trim();
  } catch {
    return "unknown";
  }
}

export function runTestCommand(
  command: string,
  source: string = TEST_RESULTS_FILE,
): TestData {
  // 1. Delete existing result file (if exists)
  try {
    if (existsSync(source)) {
      unlinkSync(source);
    }
  } catch {
    // Ignore deletion errors
  }

  // 2. Run command (ignore exit code - test failures return non-zero)
  try {
    execSync(command, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // Ignore exit code - check file existence instead
  }

  // 3. Check if result file was created
  if (!existsSync(source)) {
    return {
      results: null,
      isOutdated: false,
      commitsBehind: 0,
      error: "Test command failed to produce output file",
    };
  }

  // 4. Read and parse the result file
  let content: string;
  try {
    content = readFileSync(source, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      results: null,
      isOutdated: false,
      commitsBehind: 0,
      error: `Failed to read result file: ${message}`,
    };
  }

  // 5. Parse JUnit XML
  const parsed = parseJUnitXml(content);

  if (!parsed) {
    return {
      results: null,
      isOutdated: false,
      commitsBehind: 0,
      error: "Failed to parse test results XML",
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
