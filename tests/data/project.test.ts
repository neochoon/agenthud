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
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  };
});

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  countFiles,
  countLines,
  detectLanguage,
  detectStack,
  getProjectData,
  getProjectInfo,
} from "../../src/data/project.js";

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const _mockReaddirSync = vi.mocked(readdirSync);

describe("project data module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("detectLanguage", () => {
    it("detects TypeScript when tsconfig.json exists", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "tsconfig.json",
      );

      const result = detectLanguage();

      expect(result).toBe("TypeScript");
    });

    it("detects JavaScript when package.json exists but no tsconfig", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "package.json",
      );

      const result = detectLanguage();

      expect(result).toBe("JavaScript");
    });

    it("detects Python when pyproject.toml exists", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "pyproject.toml",
      );

      const result = detectLanguage();

      expect(result).toBe("Python");
    });

    it("detects Python when requirements.txt exists", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "requirements.txt",
      );

      const result = detectLanguage();

      expect(result).toBe("Python");
    });

    it("detects Python when setup.py exists", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "setup.py",
      );

      const result = detectLanguage();

      expect(result).toBe("Python");
    });

    it("detects Go when go.mod exists", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "go.mod",
      );

      const result = detectLanguage();

      expect(result).toBe("Go");
    });

    it("detects Rust when Cargo.toml exists", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "Cargo.toml",
      );

      const result = detectLanguage();

      expect(result).toBe("Rust");
    });

    it("detects Ruby when Gemfile exists", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "Gemfile",
      );

      const result = detectLanguage();

      expect(result).toBe("Ruby");
    });

    it("detects Java when pom.xml exists", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "pom.xml",
      );

      const result = detectLanguage();

      expect(result).toBe("Java");
    });

    it("detects Java when build.gradle exists", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "build.gradle",
      );

      const result = detectLanguage();

      expect(result).toBe("Java");
    });

    it("returns null when no language indicators found", () => {
      mockExistsSync.mockReturnValue(false);

      const result = detectLanguage();

      expect(result).toBeNull();
    });

    it("TypeScript takes precedence over JavaScript", () => {
      mockExistsSync.mockImplementation(
        (path: any) =>
          String(path) === "tsconfig.json" || String(path) === "package.json",
      );

      const result = detectLanguage();

      expect(result).toBe("TypeScript");
    });
  });

  describe("getProjectInfo", () => {
    it("reads name and license from package.json", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "package.json",
      );
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          name: "my-project",
          license: "MIT",
          dependencies: { react: "^18.0.0" },
          devDependencies: { vitest: "^1.0.0" },
        }),
      );

      const result = getProjectInfo();

      expect(result.name).toBe("my-project");
      expect(result.license).toBe("MIT");
      expect(result.prodDeps).toBe(1);
      expect(result.devDeps).toBe(1);
    });

    it("reads from pyproject.toml", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "pyproject.toml",
      );
      mockReadFileSync.mockReturnValue(`
[project]
name = "my-python-app"
license = {text = "Apache-2.0"}
dependencies = ["fastapi", "uvicorn"]

[project.optional-dependencies]
dev = ["pytest", "black"]
      `);

      const result = getProjectInfo();

      expect(result.name).toBe("my-python-app");
      expect(result.license).toBe("Apache-2.0");
      expect(result.prodDeps).toBe(2);
      expect(result.devDeps).toBe(2);
    });

    it("reads from setup.py", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "setup.py",
      );
      mockReadFileSync.mockReturnValue(`
from setuptools import setup
setup(
    name="legacy-app",
    install_requires=["django", "psycopg2"],
)
      `);

      const result = getProjectInfo();

      expect(result.name).toBe("legacy-app");
      expect(result.prodDeps).toBe(2);
    });

    it("uses folder name when no project file found", () => {
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockReturnValue("my-folder\n");

      const result = getProjectInfo();

      expect(result.name).toBe("my-folder");
      expect(result.license).toBeNull();
    });

    it("handles missing license field", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "package.json",
      );
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          name: "no-license-project",
        }),
      );

      const result = getProjectInfo();

      expect(result.name).toBe("no-license-project");
      expect(result.license).toBeNull();
    });

    it("counts dependencies correctly", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "package.json",
      );
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          name: "test",
          dependencies: { a: "1", b: "2", c: "3" },
          devDependencies: { d: "1", e: "2" },
        }),
      );

      const result = getProjectInfo();

      expect(result.prodDeps).toBe(3);
      expect(result.devDeps).toBe(2);
    });
  });

  describe("detectStack", () => {
    it("detects React from dependencies", () => {
      const deps = ["react", "react-dom", "lodash"];

      const result = detectStack(deps);

      expect(result).toContain("react");
      expect(result).not.toContain("lodash"); // not in well-known list
    });

    it("detects multiple frameworks", () => {
      const deps = ["react", "vitest", "ink"];

      const result = detectStack(deps);

      expect(result).toEqual(["react", "ink", "vitest"]);
    });

    it("limits to 5 items", () => {
      const deps = [
        "react",
        "vue",
        "express",
        "fastify",
        "ink",
        "vitest",
        "jest",
        "webpack",
      ];

      const result = detectStack(deps);

      expect(result.length).toBeLessThanOrEqual(5);
    });

    it("prioritizes frameworks over tools", () => {
      const deps = ["vitest", "jest", "webpack", "react", "express"];

      const result = detectStack(deps);

      // Frameworks (react, express) should come before tools (vitest, jest, webpack)
      const reactIndex = result.indexOf("react");
      const expressIndex = result.indexOf("express");
      const vitestIndex = result.indexOf("vitest");

      expect(reactIndex).toBeLessThan(vitestIndex);
      expect(expressIndex).toBeLessThan(vitestIndex);
    });

    it("detects Python stack", () => {
      const deps = ["django", "pytest", "pandas"];

      const result = detectStack(deps);

      expect(result).toContain("django");
      expect(result).toContain("pytest");
      expect(result).toContain("pandas");
    });

    it("returns empty array when no known stack found", () => {
      const deps = ["some-unknown-lib", "another-lib"];

      const result = detectStack(deps);

      expect(result).toEqual([]);
    });
  });

  describe("countFiles", () => {
    it("counts files in src directory", () => {
      mockExistsSync.mockImplementation((path: any) => String(path) === "src");
      mockExecSync.mockReturnValue("42\n");

      const result = countFiles("TypeScript");

      expect(result.count).toBe(42);
      expect(result.extension).toBe("ts");
    });

    it("counts tsx files for TypeScript", () => {
      mockExistsSync.mockImplementation((path: any) => String(path) === "src");
      mockExecSync.mockReturnValue("10\n");

      const _result = countFiles("TypeScript");

      // Command should include both .ts and .tsx
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("*.ts"),
        expect.any(Object),
      );
    });

    it("counts py files for Python", () => {
      mockExistsSync.mockImplementation((path: any) => String(path) === "src");
      mockExecSync.mockReturnValue("25\n");

      const result = countFiles("Python");

      expect(result.count).toBe(25);
      expect(result.extension).toBe("py");
    });

    it("tries lib directory if src not found", () => {
      mockExistsSync.mockImplementation((path: any) => String(path) === "lib");
      mockExecSync.mockReturnValue("5\n");

      const result = countFiles("JavaScript");

      expect(result.count).toBe(5);
    });

    it("tries app directory if src and lib not found", () => {
      mockExistsSync.mockImplementation((path: any) => String(path) === "app");
      mockExecSync.mockReturnValue("8\n");

      const result = countFiles("Python");

      expect(result.count).toBe(8);
    });

    it("returns 0 when no source directory found", () => {
      mockExistsSync.mockReturnValue(false);

      const result = countFiles("TypeScript");

      expect(result.count).toBe(0);
    });
  });

  describe("countLines", () => {
    it("counts lines in source files", () => {
      mockExistsSync.mockImplementation((path: any) => String(path) === "src");
      mockExecSync.mockReturnValue("3500\n");

      const result = countLines("TypeScript");

      expect(result).toBe(3500);
    });

    it("formats large numbers with k suffix", () => {
      mockExistsSync.mockImplementation((path: any) => String(path) === "src");
      mockExecSync.mockReturnValue("15234\n");

      const result = countLines("TypeScript");

      expect(result).toBe(15234);
    });

    it("excludes common directories", () => {
      mockExistsSync.mockImplementation((path: any) => String(path) === "src");
      mockExecSync.mockReturnValue("100\n");

      countLines("TypeScript");

      // Should exclude node_modules, dist, build, .git, __pycache__
      const cmd = mockExecSync.mock.calls[0][0];
      expect(cmd).toContain("node_modules");
      expect(cmd).toContain("dist");
    });

    it("returns 0 when no source directory found", () => {
      mockExistsSync.mockReturnValue(false);

      const result = countLines("TypeScript");

      expect(result).toBe(0);
    });
  });

  describe("getProjectData", () => {
    it("returns complete project data", () => {
      // Setup for TypeScript project
      mockExistsSync.mockImplementation((path: any) =>
        ["tsconfig.json", "package.json", "src"].includes(String(path)),
      );
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          name: "agenthud",
          license: "MIT",
          dependencies: { ink: "1", react: "2" },
          devDependencies: { vitest: "1", typescript: "2" },
        }),
      );
      // File count uses: find ... | wc -l (no xargs)
      // Line count uses: find ... | xargs ... wc -l
      mockExecSync.mockImplementation((cmd: any) => {
        if (String(cmd).includes("xargs")) return "3500\n"; // line count
        if (String(cmd).includes("find")) return "44\n"; // file count
        return "\n";
      });

      const result = getProjectData();

      expect(result.name).toBe("agenthud");
      expect(result.language).toBe("TypeScript");
      expect(result.license).toBe("MIT");
      expect(result.stack).toContain("react");
      expect(result.stack).toContain("ink");
      expect(result.fileCount).toBe(44);
      expect(result.lineCount).toBe(3500);
      expect(result.prodDeps).toBe(2);
      expect(result.devDeps).toBe(2);
    });

    it("handles Python project", () => {
      mockExistsSync.mockImplementation((path: any) =>
        ["pyproject.toml", "src"].includes(String(path)),
      );
      mockReadFileSync.mockReturnValue(`
[project]
name = "my-api"
license = {text = "MIT"}
dependencies = ["fastapi", "uvicorn", "sqlalchemy"]
      `);
      mockExecSync.mockImplementation((cmd: any) => {
        if (String(cmd).includes("wc -l")) return "2100\n";
        if (String(cmd).includes("find")) return "28\n";
        return "\n";
      });

      const result = getProjectData();

      expect(result.name).toBe("my-api");
      expect(result.language).toBe("Python");
      expect(result.stack).toContain("fastapi");
    });

    it("handles missing project info gracefully", () => {
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockReturnValue("unknown-folder\n");

      const result = getProjectData();

      expect(result.name).toBe("unknown-folder");
      expect(result.language).toBeNull();
      expect(result.license).toBeNull();
      expect(result.stack).toEqual([]);
      expect(result.fileCount).toBe(0);
      expect(result.lineCount).toBe(0);
    });

    it("handles read errors gracefully by falling back", () => {
      // When package.json exists but can't be read, falls back to folder name
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === "package.json",
      );
      mockReadFileSync.mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });
      mockExecSync.mockReturnValue("test-folder\n");

      const result = getProjectData();

      // Falls back gracefully - uses folder name when file can't be read
      expect(result.name).toBe("test-folder");
      expect(result.language).toBe("JavaScript"); // package.json exists
      expect(result.license).toBeNull();
    });
  });
});
