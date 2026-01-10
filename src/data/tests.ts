import { readFileSync as nodeReadFileSync } from "fs";
import { execSync as nodeExecSync } from "child_process";
import { join } from "path";
import type { TestResults, TestData } from "../types/index.js";

type ReadFileFn = (path: string) => string;
type GetHeadHashFn = () => string;
type GetCommitCountFn = (fromHash: string) => number;

const AGENT_DIR = ".agenthud";
const TEST_RESULTS_FILE = "test-results.json";

let readFileFn: ReadFileFn = (path) => nodeReadFileSync(path, "utf-8");

let getHeadHashFn: GetHeadHashFn = () => {
  return nodeExecSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
};

let getCommitCountFn: GetCommitCountFn = (fromHash) => {
  const result = nodeExecSync(`git rev-list ${fromHash}..HEAD --count`, {
    encoding: "utf-8",
  }).trim();
  return parseInt(result, 10) || 0;
};

export function setReadFileFn(fn: ReadFileFn): void {
  readFileFn = fn;
}

export function resetReadFileFn(): void {
  readFileFn = (path) => nodeReadFileSync(path, "utf-8");
}

export function setGetHeadHashFn(fn: GetHeadHashFn): void {
  getHeadHashFn = fn;
}

export function resetGetHeadHashFn(): void {
  getHeadHashFn = () => {
    return nodeExecSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  };
}

export function setGetCommitCountFn(fn: GetCommitCountFn): void {
  getCommitCountFn = fn;
}

export function resetGetCommitCountFn(): void {
  getCommitCountFn = (fromHash) => {
    const result = nodeExecSync(`git rev-list ${fromHash}..HEAD --count`, {
      encoding: "utf-8",
    }).trim();
    return parseInt(result, 10) || 0;
  };
}

export function getTestData(dir: string = process.cwd()): TestData {
  const testResultsPath = join(dir, AGENT_DIR, TEST_RESULTS_FILE);

  let results: TestResults | null = null;
  let isOutdated = false;
  let commitsBehind = 0;
  let error: string | undefined;

  // Read test-results.json
  try {
    const content = readFileFn(testResultsPath);
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
    const currentHash = getHeadHashFn();
    if (results.hash !== currentHash) {
      isOutdated = true;
      commitsBehind = getCommitCountFn(results.hash);
    }
  } catch {
    // Git error - assume not outdated
    isOutdated = false;
    commitsBehind = 0;
  }

  return { results, isOutdated, commitsBehind, error };
}
