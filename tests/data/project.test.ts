import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock fs module
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
  };
});

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import {
  countFiles,
  countLines,
  detectLanguage,
  detectStack,
  getProjectData,
  getProjectInfo,
} from "../../src/data/project.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockStatSync = vi.mocked(statSync);

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

      const result = getProjectInfo();

      // Uses basename(process.cwd()) which returns actual folder name
      expect(result.name).toBeDefined();
      expect(result.name.length).toBeGreaterThan(0);
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
      mockReaddirSync.mockReturnValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
        { name: "app.ts", isDirectory: () => false, isFile: () => true },
        { name: "utils.ts", isDirectory: () => false, isFile: () => true },
      ] as any);

      const result = countFiles("TypeScript");

      expect(result.count).toBe(3);
      expect(result.extension).toBe("ts");
    });

    it("counts tsx files for TypeScript", () => {
      mockExistsSync.mockImplementation((path: any) => String(path) === "src");
      mockReaddirSync.mockReturnValue([
        { name: "App.tsx", isDirectory: () => false, isFile: () => true },
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ] as any);

      const result = countFiles("TypeScript");

      // Should count both .ts and .tsx files
      expect(result.count).toBe(2);
    });

    it("counts py files for Python", () => {
      mockExistsSync.mockImplementation((path: any) => String(path) === "src");
      mockReaddirSync.mockReturnValue([
        { name: "main.py", isDirectory: () => false, isFile: () => true },
        { name: "utils.py", isDirectory: () => false, isFile: () => true },
      ] as any);

      const result = countFiles("Python");

      expect(result.count).toBe(2);
      expect(result.extension).toBe("py");
    });

    it("tries lib directory if src not found", () => {
      mockExistsSync.mockImplementation((path: any) => String(path) === "lib");
      mockReaddirSync.mockReturnValue([
        { name: "index.js", isDirectory: () => false, isFile: () => true },
      ] as any);

      const result = countFiles("JavaScript");

      expect(result.count).toBe(1);
    });

    it("tries app directory if src and lib not found", () => {
      mockExistsSync.mockImplementation((path: any) => String(path) === "app");
      mockReaddirSync.mockReturnValue([
        { name: "main.py", isDirectory: () => false, isFile: () => true },
      ] as any);

      const result = countFiles("Python");

      expect(result.count).toBe(1);
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
      mockReaddirSync.mockReturnValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
      ] as any);
      mockReadFileSync.mockReturnValue("line1\nline2\nline3\n");

      const result = countLines("TypeScript");

      expect(result).toBe(4); // 3 lines + 1 for final newline split
    });

    it("counts lines across multiple files", () => {
      mockExistsSync.mockImplementation((path: any) => String(path) === "src");
      mockReaddirSync.mockReturnValue([
        { name: "a.ts", isDirectory: () => false, isFile: () => true },
        { name: "b.ts", isDirectory: () => false, isFile: () => true },
      ] as any);
      mockReadFileSync.mockReturnValue("line1\nline2\n");

      const result = countLines("TypeScript");

      expect(result).toBe(6); // 3 lines * 2 files
    });

    it("excludes common directories by not traversing them", () => {
      mockExistsSync.mockImplementation((path: any) => String(path) === "src");
      mockReaddirSync.mockImplementation((dir: any) => {
        if (String(dir) === "src") {
          return [
            { name: "index.ts", isDirectory: () => false, isFile: () => true },
            {
              name: "node_modules",
              isDirectory: () => true,
              isFile: () => false,
            },
            { name: "dist", isDirectory: () => true, isFile: () => false },
          ] as any;
        }
        // If node_modules or dist were traversed, return files
        return [
          { name: "bad.ts", isDirectory: () => false, isFile: () => true },
        ] as any;
      });
      mockReadFileSync.mockReturnValue("line\n");

      const result = countLines("TypeScript");

      // Should only count index.ts (2 lines), not files in node_modules or dist
      expect(result).toBe(2);
    });

    it("returns 0 when no source directory found", () => {
      mockExistsSync.mockReturnValue(false);

      const result = countLines("TypeScript");

      expect(result).toBe(0);
    });
  });

  describe("getProjectData", () => {
    it("returns complete project data", () => {
      // Setup for TypeScript project with src directory containing files
      mockExistsSync.mockImplementation((path: any) =>
        ["tsconfig.json", "package.json", "src"].includes(String(path)),
      );
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path) === "package.json") {
          return JSON.stringify({
            name: "agenthud",
            license: "MIT",
            dependencies: { ink: "1", react: "2" },
            devDependencies: { vitest: "1", typescript: "2" },
          });
        }
        // Return some content for line counting
        return "line1\nline2\nline3\n";
      });
      mockReaddirSync.mockReturnValue([
        { name: "index.ts", isDirectory: () => false, isFile: () => true },
        { name: "app.ts", isDirectory: () => false, isFile: () => true },
      ] as any);

      const result = getProjectData();

      expect(result.name).toBe("agenthud");
      expect(result.language).toBe("TypeScript");
      expect(result.license).toBe("MIT");
      expect(result.stack).toContain("react");
      expect(result.stack).toContain("ink");
      expect(result.fileCount).toBe(2);
      expect(result.lineCount).toBe(8); // 4 lines * 2 files
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
      mockReaddirSync.mockReturnValue([
        { name: "main.py", isDirectory: () => false, isFile: () => true },
      ] as any);

      const result = getProjectData();

      expect(result.name).toBe("my-api");
      expect(result.language).toBe("Python");
      expect(result.stack).toContain("fastapi");
    });

    it("handles missing project info gracefully", () => {
      mockExistsSync.mockReturnValue(false);

      const result = getProjectData();

      // Uses basename(process.cwd()) which returns actual folder name
      expect(result.name).toBeDefined();
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

      const result = getProjectData();

      // Falls back gracefully - uses folder name when file can't be read
      expect(result.name).toBeDefined();
      expect(result.language).toBe("JavaScript"); // package.json exists
      expect(result.license).toBeNull();
    });
  });
});
