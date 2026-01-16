import { existsSync, readFileSync } from "node:fs";

export interface TestFrameworkResult {
  framework: string;
  command: string;
}

// Default test results file path (JUnit XML format)
export const TEST_RESULTS_FILE = ".agenthud/test-results.xml";

// Framework commands mapping (all output JUnit XML to TEST_RESULTS_FILE)
const FRAMEWORK_COMMANDS: Record<string, string> = {
  vitest: `npx vitest run --reporter=junit --outputFile=${TEST_RESULTS_FILE}`,
  jest: `JEST_JUNIT_OUTPUT_FILE=${TEST_RESULTS_FILE} npx jest --reporters=jest-junit`,
  mocha: `npx mocha --reporter mocha-junit-reporter --reporter-options mochaFile=${TEST_RESULTS_FILE}`,
  pytest: `uv run pytest --junitxml=${TEST_RESULTS_FILE}`,
};

// Priority order for JS frameworks
const JS_FRAMEWORKS = ["vitest", "jest", "mocha"];

/**
 * Detect test framework from project files
 * Priority: JS frameworks (vitest > jest > mocha) > Python (pytest)
 */
export function detectTestFramework(): TestFrameworkResult | null {
  // Try JS/TS detection first
  const jsFramework = detectJsFramework();
  if (jsFramework) {
    return jsFramework;
  }

  // Try Python detection
  const pythonFramework = detectPythonFramework();
  if (pythonFramework) {
    return pythonFramework;
  }

  return null;
}

function detectJsFramework(): TestFrameworkResult | null {
  if (!existsSync("package.json")) {
    return null;
  }

  let packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    const content = readFileSync("package.json", "utf-8");
    packageJson = JSON.parse(content);
  } catch {
    return null;
  }

  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  // Check frameworks in priority order
  for (const framework of JS_FRAMEWORKS) {
    if (allDeps[framework]) {
      return {
        framework,
        command: FRAMEWORK_COMMANDS[framework],
      };
    }
  }

  return null;
}

function detectPythonFramework(): TestFrameworkResult | null {
  // Check for pytest indicator files
  const pytestIndicators = ["pytest.ini", "conftest.py"];
  for (const file of pytestIndicators) {
    if (existsSync(file)) {
      return {
        framework: "pytest",
        command: FRAMEWORK_COMMANDS.pytest,
      };
    }
  }

  // Check pyproject.toml for pytest section
  if (existsSync("pyproject.toml")) {
    try {
      const content = readFileSync("pyproject.toml", "utf-8");
      if (
        content.includes("[tool.pytest") ||
        content.includes("[tool.pytest.ini_options]")
      ) {
        return {
          framework: "pytest",
          command: FRAMEWORK_COMMANDS.pytest,
        };
      }
    } catch {
      // Ignore read errors
    }
  }

  // Check requirements files for pytest
  const requirementsFiles = ["requirements.txt", "requirements-dev.txt"];
  for (const file of requirementsFiles) {
    if (existsSync(file)) {
      try {
        const content = readFileSync(file, "utf-8");
        if (content.includes("pytest")) {
          return {
            framework: "pytest",
            command: FRAMEWORK_COMMANDS.pytest,
          };
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  return null;
}
