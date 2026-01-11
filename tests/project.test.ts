import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  detectLanguage,
  getProjectInfo,
  detectStack,
  countFiles,
  countLines,
  getProjectData,
  setFileExistsFn,
  resetFileExistsFn,
  setReadFileFn,
  resetReadFileFn,
  setExecFn,
  resetExecFn,
  setReaddirFn,
  resetReaddirFn,
} from "../src/data/project.js";

describe("project data module", () => {
  let mockFileExists: ReturnType<typeof vi.fn>;
  let mockReadFile: ReturnType<typeof vi.fn>;
  let mockExec: ReturnType<typeof vi.fn>;
  let mockReaddir: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFileExists = vi.fn();
    mockReadFile = vi.fn();
    mockExec = vi.fn();
    mockReaddir = vi.fn();
    setFileExistsFn(mockFileExists);
    setReadFileFn(mockReadFile);
    setExecFn(mockExec);
    setReaddirFn(mockReaddir);
  });

  afterEach(() => {
    resetFileExistsFn();
    resetReadFileFn();
    resetExecFn();
    resetReaddirFn();
  });

  describe("detectLanguage", () => {
    it("detects TypeScript when tsconfig.json exists", () => {
      mockFileExists.mockImplementation((path: string) => path === "tsconfig.json");

      const result = detectLanguage();

      expect(result).toBe("TypeScript");
    });

    it("detects JavaScript when package.json exists but no tsconfig", () => {
      mockFileExists.mockImplementation((path: string) => path === "package.json");

      const result = detectLanguage();

      expect(result).toBe("JavaScript");
    });

    it("detects Python when pyproject.toml exists", () => {
      mockFileExists.mockImplementation((path: string) => path === "pyproject.toml");

      const result = detectLanguage();

      expect(result).toBe("Python");
    });

    it("detects Python when requirements.txt exists", () => {
      mockFileExists.mockImplementation((path: string) => path === "requirements.txt");

      const result = detectLanguage();

      expect(result).toBe("Python");
    });

    it("detects Python when setup.py exists", () => {
      mockFileExists.mockImplementation((path: string) => path === "setup.py");

      const result = detectLanguage();

      expect(result).toBe("Python");
    });

    it("detects Go when go.mod exists", () => {
      mockFileExists.mockImplementation((path: string) => path === "go.mod");

      const result = detectLanguage();

      expect(result).toBe("Go");
    });

    it("detects Rust when Cargo.toml exists", () => {
      mockFileExists.mockImplementation((path: string) => path === "Cargo.toml");

      const result = detectLanguage();

      expect(result).toBe("Rust");
    });

    it("detects Ruby when Gemfile exists", () => {
      mockFileExists.mockImplementation((path: string) => path === "Gemfile");

      const result = detectLanguage();

      expect(result).toBe("Ruby");
    });

    it("detects Java when pom.xml exists", () => {
      mockFileExists.mockImplementation((path: string) => path === "pom.xml");

      const result = detectLanguage();

      expect(result).toBe("Java");
    });

    it("detects Java when build.gradle exists", () => {
      mockFileExists.mockImplementation((path: string) => path === "build.gradle");

      const result = detectLanguage();

      expect(result).toBe("Java");
    });

    it("returns null when no language indicators found", () => {
      mockFileExists.mockReturnValue(false);

      const result = detectLanguage();

      expect(result).toBeNull();
    });

    it("TypeScript takes precedence over JavaScript", () => {
      mockFileExists.mockImplementation(
        (path: string) => path === "tsconfig.json" || path === "package.json"
      );

      const result = detectLanguage();

      expect(result).toBe("TypeScript");
    });
  });

  describe("getProjectInfo", () => {
    it("reads name and license from package.json", () => {
      mockFileExists.mockImplementation((path: string) => path === "package.json");
      mockReadFile.mockReturnValue(
        JSON.stringify({
          name: "my-project",
          license: "MIT",
          dependencies: { react: "^18.0.0" },
          devDependencies: { vitest: "^1.0.0" },
        })
      );

      const result = getProjectInfo();

      expect(result.name).toBe("my-project");
      expect(result.license).toBe("MIT");
      expect(result.prodDeps).toBe(1);
      expect(result.devDeps).toBe(1);
    });

    it("reads from pyproject.toml", () => {
      mockFileExists.mockImplementation((path: string) => path === "pyproject.toml");
      mockReadFile.mockReturnValue(`
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
      mockFileExists.mockImplementation((path: string) => path === "setup.py");
      mockReadFile.mockReturnValue(`
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
      mockFileExists.mockReturnValue(false);
      mockExec.mockReturnValue("my-folder\n");

      const result = getProjectInfo();

      expect(result.name).toBe("my-folder");
      expect(result.license).toBeNull();
    });

    it("handles missing license field", () => {
      mockFileExists.mockImplementation((path: string) => path === "package.json");
      mockReadFile.mockReturnValue(
        JSON.stringify({
          name: "no-license-project",
        })
      );

      const result = getProjectInfo();

      expect(result.name).toBe("no-license-project");
      expect(result.license).toBeNull();
    });

    it("counts dependencies correctly", () => {
      mockFileExists.mockImplementation((path: string) => path === "package.json");
      mockReadFile.mockReturnValue(
        JSON.stringify({
          name: "test",
          dependencies: { a: "1", b: "2", c: "3" },
          devDependencies: { d: "1", e: "2" },
        })
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
      const deps = ["react", "vue", "express", "fastify", "ink", "vitest", "jest", "webpack"];

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
      mockFileExists.mockImplementation((path: string) => path === "src");
      mockExec.mockReturnValue("42\n");

      const result = countFiles("TypeScript");

      expect(result.count).toBe(42);
      expect(result.extension).toBe("ts");
    });

    it("counts tsx files for TypeScript", () => {
      mockFileExists.mockImplementation((path: string) => path === "src");
      mockExec.mockReturnValue("10\n");

      const result = countFiles("TypeScript");

      // Command should include both .ts and .tsx
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("*.ts"),
        expect.any(Object)
      );
    });

    it("counts py files for Python", () => {
      mockFileExists.mockImplementation((path: string) => path === "src");
      mockExec.mockReturnValue("25\n");

      const result = countFiles("Python");

      expect(result.count).toBe(25);
      expect(result.extension).toBe("py");
    });

    it("tries lib directory if src not found", () => {
      mockFileExists.mockImplementation((path: string) => path === "lib");
      mockExec.mockReturnValue("5\n");

      const result = countFiles("JavaScript");

      expect(result.count).toBe(5);
    });

    it("tries app directory if src and lib not found", () => {
      mockFileExists.mockImplementation((path: string) => path === "app");
      mockExec.mockReturnValue("8\n");

      const result = countFiles("Python");

      expect(result.count).toBe(8);
    });

    it("returns 0 when no source directory found", () => {
      mockFileExists.mockReturnValue(false);

      const result = countFiles("TypeScript");

      expect(result.count).toBe(0);
    });
  });

  describe("countLines", () => {
    it("counts lines in source files", () => {
      mockFileExists.mockImplementation((path: string) => path === "src");
      mockExec.mockReturnValue("3500\n");

      const result = countLines("TypeScript");

      expect(result).toBe(3500);
    });

    it("formats large numbers with k suffix", () => {
      mockFileExists.mockImplementation((path: string) => path === "src");
      mockExec.mockReturnValue("15234\n");

      const result = countLines("TypeScript");

      expect(result).toBe(15234);
    });

    it("excludes common directories", () => {
      mockFileExists.mockImplementation((path: string) => path === "src");
      mockExec.mockReturnValue("100\n");

      countLines("TypeScript");

      // Should exclude node_modules, dist, build, .git, __pycache__
      const cmd = mockExec.mock.calls[0][0];
      expect(cmd).toContain("node_modules");
      expect(cmd).toContain("dist");
    });

    it("returns 0 when no source directory found", () => {
      mockFileExists.mockReturnValue(false);

      const result = countLines("TypeScript");

      expect(result).toBe(0);
    });
  });

  describe("getProjectData", () => {
    it("returns complete project data", () => {
      // Setup for TypeScript project
      mockFileExists.mockImplementation((path: string) =>
        ["tsconfig.json", "package.json", "src"].includes(path)
      );
      mockReadFile.mockReturnValue(
        JSON.stringify({
          name: "agenthud",
          license: "MIT",
          dependencies: { ink: "1", react: "2" },
          devDependencies: { vitest: "1", typescript: "2" },
        })
      );
      // File count uses: find ... | wc -l (no xargs)
      // Line count uses: find ... | xargs ... wc -l
      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes("xargs")) return "3500\n"; // line count
        if (cmd.includes("find")) return "44\n"; // file count
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
      mockFileExists.mockImplementation((path: string) =>
        ["pyproject.toml", "src"].includes(path)
      );
      mockReadFile.mockReturnValue(`
[project]
name = "my-api"
license = {text = "MIT"}
dependencies = ["fastapi", "uvicorn", "sqlalchemy"]
      `);
      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes("wc -l")) return "2100\n";
        if (cmd.includes("find")) return "28\n";
        return "\n";
      });

      const result = getProjectData();

      expect(result.name).toBe("my-api");
      expect(result.language).toBe("Python");
      expect(result.stack).toContain("fastapi");
    });

    it("handles missing project info gracefully", () => {
      mockFileExists.mockReturnValue(false);
      mockExec.mockReturnValue("unknown-folder\n");

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
      mockFileExists.mockImplementation((path: string) => path === "package.json");
      mockReadFile.mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });
      mockExec.mockReturnValue("test-folder\n");

      const result = getProjectData();

      // Falls back gracefully - uses folder name when file can't be read
      expect(result.name).toBe("test-folder");
      expect(result.language).toBe("JavaScript"); // package.json exists
      expect(result.license).toBeNull();
    });
  });
});
