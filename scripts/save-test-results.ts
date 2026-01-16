#!/usr/bin/env npx tsx
/**
 * Wrapper script to run vitest and save results with git context.
 *
 * Usage:
 *   npx tsx scripts/save-test-results.ts
 *   npm run test:save
 *
 * Output:
 *   .agenthud/test-results.json
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface VitestResult {
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: Array<{
    name: string;
    assertionResults: Array<{
      title: string;
      status: "passed" | "failed" | "pending";
    }>;
  }>;
}

interface TestFailure {
  file: string;
  name: string;
}

interface TestResults {
  hash: string;
  timestamp: string;
  passed: number;
  failed: number;
  skipped: number;
  failures: TestFailure[];
}

function getGitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function runVitest(): VitestResult | null {
  try {
    const output = execSync("npx vitest run --reporter=json", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(output) as VitestResult;
  } catch (e: unknown) {
    // Vitest exits with code 1 if tests fail, but still outputs JSON
    const error = e as { stdout?: string };
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout) as VitestResult;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function extractFailures(vitestResult: VitestResult): TestFailure[] {
  const failures: TestFailure[] = [];

  for (const testFile of vitestResult.testResults) {
    for (const assertion of testFile.assertionResults) {
      if (assertion.status === "failed") {
        failures.push({
          file: testFile.name.replace(`${process.cwd()}/`, ""),
          name: assertion.title,
        });
      }
    }
  }

  return failures;
}

function main(): void {
  console.log("Running tests...\n");

  const vitestResult = runVitest();

  if (!vitestResult) {
    console.error("Failed to run vitest or parse results");
    process.exit(1);
  }

  const results: TestResults = {
    hash: getGitHash(),
    timestamp: new Date().toISOString(),
    passed: vitestResult.numPassedTests,
    failed: vitestResult.numFailedTests,
    skipped: vitestResult.numPendingTests,
    failures: extractFailures(vitestResult),
  };

  // Ensure .agenthud directory exists
  const agentDir = join(process.cwd(), ".agenthud");
  if (!existsSync(agentDir)) {
    mkdirSync(agentDir, { recursive: true });
  }

  // Write results
  const outputPath = join(agentDir, "test-results.json");
  writeFileSync(outputPath, JSON.stringify(results, null, 2));

  // Print summary
  console.log(`\n✓ ${results.passed} passed`);
  if (results.failed > 0) {
    console.log(`✗ ${results.failed} failed`);
  }
  if (results.skipped > 0) {
    console.log(`○ ${results.skipped} skipped`);
  }
  console.log(`\nSaved to ${outputPath}`);
  console.log(`Git hash: ${results.hash}`);
}

main();
