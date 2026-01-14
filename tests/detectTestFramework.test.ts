import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  detectTestFramework,
  setFsMock,
  resetFsMock,
  type FsMock,
  type TestFrameworkResult,
} from "../src/data/detectTestFramework.js";

describe("detectTestFramework", () => {
  let fsMock: FsMock;

  beforeEach(() => {
    fsMock = {
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
    };
    setFsMock(fsMock);
  });

  afterEach(() => {
    resetFsMock();
  });

  describe("JavaScript/TypeScript detection", () => {
    it("detects vitest from package.json devDependencies", () => {
      fsMock.existsSync.mockImplementation((path: string) => {
        return path === "package.json";
      });
      fsMock.readFileSync.mockReturnValue(
        JSON.stringify({
          devDependencies: {
            vitest: "^1.0.0",
          },
        })
      );

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "vitest",
        command: "npx vitest run --reporter=json",
      });
    });

    it("detects jest from package.json devDependencies", () => {
      fsMock.existsSync.mockImplementation((path: string) => {
        return path === "package.json";
      });
      fsMock.readFileSync.mockReturnValue(
        JSON.stringify({
          devDependencies: {
            jest: "^29.0.0",
          },
        })
      );

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "jest",
        command: "npx jest --json",
      });
    });

    it("detects mocha from package.json devDependencies", () => {
      fsMock.existsSync.mockImplementation((path: string) => {
        return path === "package.json";
      });
      fsMock.readFileSync.mockReturnValue(
        JSON.stringify({
          devDependencies: {
            mocha: "^10.0.0",
          },
        })
      );

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "mocha",
        command: "npx mocha --reporter=json",
      });
    });

    it("detects from dependencies if not in devDependencies", () => {
      fsMock.existsSync.mockImplementation((path: string) => {
        return path === "package.json";
      });
      fsMock.readFileSync.mockReturnValue(
        JSON.stringify({
          dependencies: {
            vitest: "^1.0.0",
          },
        })
      );

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "vitest",
        command: "npx vitest run --reporter=json",
      });
    });

    it("prioritizes vitest over jest", () => {
      fsMock.existsSync.mockImplementation((path: string) => {
        return path === "package.json";
      });
      fsMock.readFileSync.mockReturnValue(
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
      fsMock.existsSync.mockImplementation((path: string) => {
        return path === "package.json";
      });
      fsMock.readFileSync.mockReturnValue(
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
      fsMock.existsSync.mockImplementation((path: string) => {
        return path === "pytest.ini";
      });

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "pytest",
        command: "pytest --json-report --json-report-file=.agenthud/test-results.json",
      });
    });

    it("detects pytest from conftest.py", () => {
      fsMock.existsSync.mockImplementation((path: string) => {
        return path === "conftest.py";
      });

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "pytest",
        command: "pytest --json-report --json-report-file=.agenthud/test-results.json",
      });
    });

    it("detects pytest from pyproject.toml with pytest section", () => {
      fsMock.existsSync.mockImplementation((path: string) => {
        return path === "pyproject.toml";
      });
      fsMock.readFileSync.mockReturnValue(`
[tool.pytest.ini_options]
testpaths = ["tests"]
`);

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "pytest",
        command: "pytest --json-report --json-report-file=.agenthud/test-results.json",
      });
    });

    it("detects pytest from requirements.txt", () => {
      fsMock.existsSync.mockImplementation((path: string) => {
        return path === "requirements.txt";
      });
      fsMock.readFileSync.mockReturnValue(`
flask==2.0.0
pytest==7.0.0
requests==2.28.0
`);

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "pytest",
        command: "pytest --json-report --json-report-file=.agenthud/test-results.json",
      });
    });

    it("detects pytest from requirements-dev.txt", () => {
      fsMock.existsSync.mockImplementation((path: string) => {
        return path === "requirements-dev.txt";
      });
      fsMock.readFileSync.mockReturnValue(`
pytest==7.0.0
pytest-cov==4.0.0
`);

      const result = detectTestFramework();

      expect(result).toEqual({
        framework: "pytest",
        command: "pytest --json-report --json-report-file=.agenthud/test-results.json",
      });
    });
  });

  describe("priority", () => {
    it("prioritizes JS frameworks over Python", () => {
      fsMock.existsSync.mockImplementation((path: string) => {
        return path === "package.json" || path === "pytest.ini";
      });
      fsMock.readFileSync.mockImplementation((path: string) => {
        if (path === "package.json") {
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
      fsMock.existsSync.mockReturnValue(false);

      const result = detectTestFramework();

      expect(result).toBeNull();
    });

    it("returns null when package.json has no test dependencies", () => {
      fsMock.existsSync.mockImplementation((path: string) => {
        return path === "package.json";
      });
      fsMock.readFileSync.mockReturnValue(
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
      fsMock.existsSync.mockImplementation((path: string) => {
        return path === "pyproject.toml";
      });
      fsMock.readFileSync.mockReturnValue(`
[project]
name = "myproject"
`);

      const result = detectTestFramework();

      expect(result).toBeNull();
    });
  });
});
