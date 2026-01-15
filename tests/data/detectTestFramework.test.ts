import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs module
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { existsSync, readFileSync } from "fs";
import {
  detectTestFramework,
  type TestFrameworkResult,
} from "../../src/data/detectTestFramework.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe("detectTestFramework", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("JavaScript/TypeScript detection", () => {
    it("detects vitest from package.json devDependencies", () => {
      mockExistsSync.mockImplementation((path: any) => {
        return String(path) === "package.json";
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          devDependencies: {
            vitest: "^1.0.0",
          },
        })
      );

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "vitest",
        command: "npx vitest run --reporter=junit --outputFile=.agenthud/test-results.xml",
      });
    });

    it("detects jest from package.json devDependencies", () => {
      mockExistsSync.mockImplementation((path: any) => {
        return String(path) === "package.json";
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          devDependencies: {
            jest: "^29.0.0",
          },
        })
      );

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "jest",
        command: "JEST_JUNIT_OUTPUT_FILE=.agenthud/test-results.xml npx jest --reporters=jest-junit",
      });
    });

    it("detects mocha from package.json devDependencies", () => {
      mockExistsSync.mockImplementation((path: any) => {
        return String(path) === "package.json";
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          devDependencies: {
            mocha: "^10.0.0",
          },
        })
      );

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "mocha",
        command: "npx mocha --reporter mocha-junit-reporter --reporter-options mochaFile=.agenthud/test-results.xml",
      });
    });

    it("detects from dependencies if not in devDependencies", () => {
      mockExistsSync.mockImplementation((path: any) => {
        return String(path) === "package.json";
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          dependencies: {
            vitest: "^1.0.0",
          },
        })
      );

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "vitest",
        command: "npx vitest run --reporter=junit --outputFile=.agenthud/test-results.xml",
      });
    });

    it("prioritizes vitest over jest", () => {
      mockExistsSync.mockImplementation((path: any) => {
        return String(path) === "package.json";
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          devDependencies: {
            vitest: "^1.0.0",
            jest: "^29.0.0",
          },
        })
      );

      const result = detectTestFramework();

      expect(result?.framework).toBe("vitest");
    });

    it("prioritizes jest over mocha", () => {
      mockExistsSync.mockImplementation((path: any) => {
        return String(path) === "package.json";
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          devDependencies: {
            jest: "^29.0.0",
            mocha: "^10.0.0",
          },
        })
      );

      const result = detectTestFramework();

      expect(result?.framework).toBe("jest");
    });
  });

  describe("Python detection", () => {
    it("detects pytest from pytest.ini", () => {
      mockExistsSync.mockImplementation((path: any) => {
        return String(path) === "pytest.ini";
      });

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "pytest",
        command: "uv run pytest --junitxml=.agenthud/test-results.xml",
      });
    });

    it("detects pytest from conftest.py", () => {
      mockExistsSync.mockImplementation((path: any) => {
        return String(path) === "conftest.py";
      });

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "pytest",
        command: "uv run pytest --junitxml=.agenthud/test-results.xml",
      });
    });

    it("detects pytest from pyproject.toml with pytest section", () => {
      mockExistsSync.mockImplementation((path: any) => {
        return String(path) === "pyproject.toml";
      });
      mockReadFileSync.mockReturnValue(`
[tool.pytest.ini_options]
testpaths = ["tests"]
`);

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "pytest",
        command: "uv run pytest --junitxml=.agenthud/test-results.xml",
      });
    });

    it("detects pytest from requirements.txt", () => {
      mockExistsSync.mockImplementation((path: any) => {
        return String(path) === "requirements.txt";
      });
      mockReadFileSync.mockReturnValue(`
flask==2.0.0
pytest==7.0.0
requests==2.28.0
`);

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "pytest",
        command: "uv run pytest --junitxml=.agenthud/test-results.xml",
      });
    });

    it("detects pytest from requirements-dev.txt", () => {
      mockExistsSync.mockImplementation((path: any) => {
        return String(path) === "requirements-dev.txt";
      });
      mockReadFileSync.mockReturnValue(`
pytest==7.0.0
pytest-cov==4.0.0
`);

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "pytest",
        command: "uv run pytest --junitxml=.agenthud/test-results.xml",
      });
    });
  });

  describe("priority", () => {
    it("prioritizes JS frameworks over Python", () => {
      mockExistsSync.mockImplementation((path: any) => {
        return String(path) === "package.json" || String(path) === "pytest.ini";
      });
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path) === "package.json") {
          return JSON.stringify({
            devDependencies: { vitest: "^1.0.0" },
          });
        }
        return "";
      });

      const result = detectTestFramework();

      expect(result?.framework).toBe("vitest");
    });
  });

  describe("no framework found", () => {
    it("returns null when no test framework detected", () => {
      mockExistsSync.mockReturnValue(false);

      const result = detectTestFramework();

      expect(result).toBeNull();
    });

    it("returns null when package.json has no test dependencies", () => {
      mockExistsSync.mockImplementation((path: any) => {
        return String(path) === "package.json";
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          devDependencies: {
            typescript: "^5.0.0",
          },
        })
      );

      const result = detectTestFramework();

      expect(result).toBeNull();
    });

    it("returns null when pyproject.toml has no pytest section", () => {
      mockExistsSync.mockImplementation((path: any) => {
        return String(path) === "pyproject.toml";
      });
      mockReadFileSync.mockReturnValue(`
[project]
name = "myproject"
`);

      const result = detectTestFramework();

      expect(result).toBeNull();
    });
  });
});
