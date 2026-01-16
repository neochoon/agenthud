import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TestsPanelConfig } from "../config/parser.js";
import { parseJUnitXml } from "../runner/command.js";
import type { TestData, TestResults } from "../types/index.js";

const AGENT_DIR = ".agenthud";
const TEST_RESULTS_FILE = "test-results.json";

function getHeadHash(): string {
  return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
}

function getCommitCount(fromHash: string): number {
  const result = execSync(`git rev-list ${fromHash}..HEAD --count`, {
    encoding: "utf-8",
  }).trim();
  return parseInt(result, 10) || 0;
}

export function getTestData(dir: string = process.cwd()): TestData {
  const testResultsPath = join(dir, AGENT_DIR, TEST_RESULTS_FILE);

  let results: TestResults | null = null;
  let isOutdated = false;
  let commitsBehind = 0;
  let error: string | undefined;

  // Read test-results.json
  try {
    const content = readFileSync(testResultsPath, "utf-8");
    results = JSON.parse(content) as TestResults;
  } catch (e) {
    if (e instanceof SyntaxError) {
      error = "Invalid test-results.json";
    } else {
      error = "No test results";
    }
    return { results: null, isOutdated: false, commitsBehind: 0, error };
  }

  // Compare hash with current HEAD
  try {
    const currentHash = getHeadHash();
    if (results.hash !== currentHash) {
      isOutdated = true;
      commitsBehind = getCommitCount(results.hash);
    }
  } catch {
    // Git error - assume not outdated
    isOutdated = false;
    commitsBehind = 0;
  }

  return { results, isOutdated, commitsBehind, error };
}

export function getTestDataWithConfig(config: TestsPanelConfig): TestData {
  // Use source from config if provided, otherwise use default path
  const testResultsPath =
    config.source || join(process.cwd(), AGENT_DIR, TEST_RESULTS_FILE);
  const isXmlFormat = testResultsPath.endsWith(".xml");

  let results: TestResults | null = null;
  let isOutdated = false;
  let commitsBehind = 0;
  let error: string | undefined;

  // Read test results from source path
  try {
    const content = readFileSync(testResultsPath, "utf-8");

    if (isXmlFormat) {
      // Parse JUnit XML format
      const parsed = parseJUnitXml(content);
      if (!parsed) {
        error = "Invalid test-results.xml";
        return { results: null, isOutdated: false, commitsBehind: 0, error };
      }
      // Create TestResults from parsed data
      results = {
        hash: "",
        timestamp: new Date().toISOString(),
        passed: parsed.passed,
        failed: parsed.failed,
        skipped: parsed.skipped,
        failures: parsed.failures,
      };
    } else {
      // Parse JSON format
      results = JSON.parse(content) as TestResults;
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      error = isXmlFormat
        ? "Invalid test-results.xml"
        : "Invalid test-results.json";
    } else {
      error = "No test results";
    }
    return { results: null, isOutdated: false, commitsBehind: 0, error };
  }

  // Compare hash with current HEAD (skip for XML format as it doesn't have hash)
  if (!isXmlFormat) {
    try {
      const currentHash = getHeadHash();
      if (results.hash !== currentHash) {
        isOutdated = true;
        commitsBehind = getCommitCount(results.hash);
      }
    } catch {
      // Git error - assume not outdated
      isOutdated = false;
      commitsBehind = 0;
    }
  }

  return { results, isOutdated, commitsBehind, error };
}
