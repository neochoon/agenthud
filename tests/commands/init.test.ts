import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock fs module
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    appendFileSync: vi.fn(),
  };
});

// Mock detectTestFramework
vi.mock("../../src/data/detectTestFramework.js", () => ({
  detectTestFramework: vi.fn(),
}));

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { runInit } from "../../src/commands/init.js";
import { detectTestFramework } from "../../src/data/detectTestFramework.js";

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockAppendFileSync = vi.mocked(appendFileSync);
const mockDetectTestFramework = vi.mocked(detectTestFramework);

describe("init command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for getDefaultConfig - return a template-like content
    mockReadFileSync.mockImplementation((path: any) => {
      if (
        String(path).includes("config.yaml") ||
        String(path).includes("templates")
      ) {
        return `
panels:
  tests:
    enabled: true
    command: npx vitest run --reporter=json
    interval: manual
`;
      }
      return "";
    });
    mockDetectTestFramework.mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("creates .agenthud/ directory structure", () => {
    it("creates .agenthud directory when it doesn't exist", () => {
      mockExistsSync.mockReturnValue(false);

      runInit();

      expect(mockMkdirSync).toHaveBeenCalledWith(".agenthud", {
        recursive: true,
      });
    });

    it("creates .agenthud/tests directory", () => {
      mockExistsSync.mockReturnValue(false);

      runInit();

      expect(mockMkdirSync).toHaveBeenCalledWith(".agenthud/tests", {
        recursive: true,
      });
    });

    it("skips directory creation when .agenthud exists", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === ".agenthud",
      );

      runInit();

      expect(mockMkdirSync).not.toHaveBeenCalledWith(".agenthud", {
        recursive: true,
      });
    });
  });

  describe("updates .gitignore", () => {
    it("creates .gitignore with .agenthud/ when .git exists but .gitignore doesn't", () => {
      mockExistsSync.mockImplementation((path: any) => {
        const pathStr = String(path);
        if (pathStr === ".git") return true;
        return false;
      });

      runInit();

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        ".gitignore",
        ".agenthud/\n",
      );
    });

    it("does NOT create .gitignore when .git doesn't exist", () => {
      mockExistsSync.mockReturnValue(false);

      runInit();

      expect(mockWriteFileSync).not.toHaveBeenCalledWith(
        ".gitignore",
        ".agenthud/\n",
      );
    });

    it("appends .agenthud/ to existing .gitignore when .git exists", () => {
      mockExistsSync.mockImplementation((path: any) => {
        const pathStr = String(path);
        if (pathStr === ".git") return true;
        if (pathStr === ".gitignore") return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path) === ".gitignore") return "node_modules/\n";
        if (
          String(path).includes("config.yaml") ||
          String(path).includes("templates")
        ) {
          return "panels:\n  tests:\n    command: npx vitest run --reporter=json\n";
        }
        return "";
      });

      runInit();

      expect(mockAppendFileSync).toHaveBeenCalledWith(
        ".gitignore",
        "\n.agenthud/\n",
      );
    });

    it("skips if .gitignore already contains .agenthud/", () => {
      mockExistsSync.mockImplementation((path: any) => {
        const pathStr = String(path);
        if (pathStr === ".git") return true;
        if (pathStr === ".gitignore") return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path) === ".gitignore") return "node_modules/\n.agenthud/\n";
        if (
          String(path).includes("config.yaml") ||
          String(path).includes("templates")
        ) {
          return "panels:\n  tests:\n    command: npx vitest run --reporter=json\n";
        }
        return "";
      });

      runInit();

      expect(mockAppendFileSync).not.toHaveBeenCalledWith(
        ".gitignore",
        expect.any(String),
      );
    });
  });

  describe("creates config.yaml", () => {
    it("creates config.yaml with default content when it doesn't exist", () => {
      mockExistsSync.mockReturnValue(false);

      runInit();

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        ".agenthud/config.yaml",
        expect.any(String),
      );
    });

    it("skips config.yaml when it exists", () => {
      mockExistsSync.mockImplementation(
        (path: any) => String(path) === ".agenthud/config.yaml",
      );

      runInit();

      expect(mockWriteFileSync).not.toHaveBeenCalledWith(
        ".agenthud/config.yaml",
        expect.any(String),
      );
    });
  });

  describe("return value", () => {
    it("returns list of created files (with .git)", () => {
      mockExistsSync.mockImplementation((path: any) => {
        if (String(path) === ".git") return true;
        return false;
      });

      const result = runInit();

      expect(result.created).toContain(".agenthud/");
      expect(result.created).toContain(".agenthud/tests/");
      expect(result.created).toContain(".agenthud/config.yaml");
      expect(result.created).toContain(".gitignore");
    });

    it("returns list of created files (without .git, no .gitignore)", () => {
      mockExistsSync.mockReturnValue(false);

      const result = runInit();

      expect(result.created).toContain(".agenthud/");
      expect(result.created).toContain(".agenthud/tests/");
      expect(result.created).toContain(".agenthud/config.yaml");
      expect(result.created).not.toContain(".gitignore");
    });

    it("returns list of skipped files", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path) === ".gitignore") return ".agenthud/\n";
        if (
          String(path).includes("config.yaml") ||
          String(path).includes("templates")
        ) {
          return "panels:\n  tests:\n    command: npx vitest run --reporter=json\n";
        }
        return "";
      });

      const result = runInit();

      expect(result.skipped).toContain(".agenthud/");
      expect(result.skipped).toContain(".agenthud/tests/");
      expect(result.skipped).toContain(".agenthud/config.yaml");
      expect(result.skipped).toContain(".gitignore");
    });
  });

  describe("warnings", () => {
    it("warns when not a git repository", () => {
      mockExistsSync.mockImplementation((path: any) => {
        // .git doesn't exist, Claude session exists
        if (String(path) === ".git") return false;
        if (
          String(path).includes(".claude") &&
          String(path).includes("projects")
        )
          return true;
        return false;
      });

      const result = runInit("/Users/test/project");

      expect(result.warnings).toContain(
        "Not a git repository - Git panel will show limited info",
      );
    });

    it("warns when no Claude session found", () => {
      mockExistsSync.mockImplementation((path: any) => {
        // .git exists, Claude session doesn't exist
        if (String(path) === ".git") return true;
        if (
          String(path).includes(".claude") &&
          String(path).includes("projects")
        )
          return false;
        return false;
      });

      const result = runInit("/Users/test/project");

      expect(result.warnings).toContain(
        "No Claude session found - start Claude to see activity",
      );
    });

    it("returns both warnings when neither git nor Claude session exists", () => {
      mockExistsSync.mockReturnValue(false);

      const result = runInit("/Users/test/project");

      expect(result.warnings).toHaveLength(2);
      expect(result.warnings).toContain(
        "Not a git repository - Git panel will show limited info",
      );
      expect(result.warnings).toContain(
        "No Claude session found - start Claude to see activity",
      );
    });

    it("returns no warnings when both git and Claude session exist", () => {
      mockExistsSync.mockImplementation((path: any) => {
        if (String(path) === ".git") return true;
        // Handle both / and \ path separators for cross-platform compatibility
        if (
          String(path).includes(".claude") &&
          String(path).includes("projects")
        )
          return true;
        if (String(path) === ".gitignore") return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path) === ".gitignore") return ".agenthud/\n";
        if (
          String(path).includes("config.yaml") ||
          String(path).includes("templates")
        ) {
          return "panels:\n  tests:\n    command: npx vitest run --reporter=json\n";
        }
        return "";
      });

      const result = runInit("/Users/test/project");

      expect(result.warnings).toHaveLength(0);
    });
  });
});
