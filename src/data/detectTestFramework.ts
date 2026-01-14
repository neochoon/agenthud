import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
} from "fs";

export interface FsMock {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string) => string;
}

let fs: FsMock = {
  existsSync: nodeExistsSync,
  readFileSync: (path: string) => nodeReadFileSync(path, "utf-8"),
};

export function setFsMock(mock: FsMock): void {
  fs = mock;
}

export function resetFsMock(): void {
  fs = {
    existsSync: nodeExistsSync,
    readFileSync: (path: string) => nodeReadFileSync(path, "utf-8"),
  };
}

export interface TestFrameworkResult {
  framework: string;
  command: string;
}

// Framework commands mapping
const FRAMEWORK_COMMANDS: Record<string, string> = {
  vitest: "npx vitest run --reporter=json",
  jest: "npx jest --json",
  mocha: "npx mocha --reporter=json",
  pytest: "pytest --json-report --json-report-file=.agenthud/test-results.json",
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
  if (!fs.existsSync("package.json")) {
    return null;
  }

  let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    const content = fs.readFileSync("package.json");
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
    if (fs.existsSync(file)) {
      return {
        framework: "pytest",
        command: FRAMEWORK_COMMANDS.pytest,
      };
    }
  }

  // Check pyproject.toml for pytest section
  if (fs.existsSync("pyproject.toml")) {
    try {
      const content = fs.readFileSync("pyproject.toml");
      if (content.includes("[tool.pytest") || content.includes("[tool.pytest.ini_options]")) {
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
    if (fs.existsSync(file)) {
      try {
        const content = fs.readFileSync(file);
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
