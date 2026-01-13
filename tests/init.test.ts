import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runInit, setFsMock, resetFsMock, getDefaultConfig, type FsMock } from "../src/commands/init.js";

describe("init command", () => {
  let fsMock: FsMock;

  beforeEach(() => {
    fsMock = {
      existsSync: vi.fn(),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(),
      appendFileSync: vi.fn(),
    };
    setFsMock(fsMock);
  });

  afterEach(() => {
    resetFsMock();
  });

  describe("creates .agenthud/ directory structure", () => {
    it("creates .agenthud directory when it doesn't exist", () => {
      fsMock.existsSync.mockReturnValue(false);

      runInit();

      expect(fsMock.mkdirSync).toHaveBeenCalledWith(".agenthud", { recursive: true });
    });

    it("creates .agenthud/tests directory", () => {
      fsMock.existsSync.mockReturnValue(false);

      runInit();

      expect(fsMock.mkdirSync).toHaveBeenCalledWith(".agenthud/tests", { recursive: true });
    });

    it("skips directory creation when .agenthud exists", () => {
      fsMock.existsSync.mockImplementation((path: string) => path === ".agenthud");

      runInit();

      expect(fsMock.mkdirSync).not.toHaveBeenCalledWith(".agenthud", { recursive: true });
    });
  });

  describe("updates .gitignore", () => {
    it("creates .gitignore with .agenthud/ when it doesn't exist", () => {
      fsMock.existsSync.mockReturnValue(false);

      runInit();

      expect(fsMock.writeFileSync).toHaveBeenCalledWith(
        ".gitignore",
        ".agenthud/\n"
      );
    });

    it("appends .agenthud/ to existing .gitignore", () => {
      fsMock.existsSync.mockImplementation((path: string) =>
        path === ".gitignore"
      );
      fsMock.readFileSync.mockReturnValue("node_modules/\n");

      runInit();

      expect(fsMock.appendFileSync).toHaveBeenCalledWith(
        ".gitignore",
        "\n.agenthud/\n"
      );
    });

    it("skips if .gitignore already contains .agenthud/", () => {
      fsMock.existsSync.mockImplementation((path: string) =>
        path === ".gitignore"
      );
      fsMock.readFileSync.mockReturnValue("node_modules/\n.agenthud/\n");

      runInit();

      expect(fsMock.appendFileSync).not.toHaveBeenCalledWith(
        ".gitignore",
        expect.any(String)
      );
    });
  });

  describe("creates config.yaml", () => {
    it("creates config.yaml with default content when it doesn't exist", () => {
      fsMock.existsSync.mockReturnValue(false);

      runInit();

      expect(fsMock.writeFileSync).toHaveBeenCalledWith(
        ".agenthud/config.yaml",
        getDefaultConfig()
      );
    });

    it("skips config.yaml when it exists", () => {
      fsMock.existsSync.mockImplementation((path: string) =>
        path === ".agenthud/config.yaml"
      );

      runInit();

      expect(fsMock.writeFileSync).not.toHaveBeenCalledWith(
        ".agenthud/config.yaml",
        expect.any(String)
      );
    });
  });

  describe("return value", () => {
    it("returns list of created files", () => {
      fsMock.existsSync.mockReturnValue(false);

      const result = runInit();

      expect(result.created).toContain(".agenthud/");
      expect(result.created).toContain(".agenthud/tests/");
      expect(result.created).toContain(".agenthud/config.yaml");
      expect(result.created).toContain(".gitignore");
    });

    it("returns list of skipped files", () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockImplementation((path: string) => {
        if (path === ".gitignore") return ".agenthud/\n";
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
      fsMock.existsSync.mockImplementation((path: string) => {
        // .git doesn't exist, Claude session exists
        if (path === ".git") return false;
        if (path.includes(".claude/projects")) return true;
        return false;
      });

      const result = runInit("/Users/test/project");

      expect(result.warnings).toContain("Not a git repository - Git panel will show limited info");
    });

    it("warns when no Claude session found", () => {
      fsMock.existsSync.mockImplementation((path: string) => {
        // .git exists, Claude session doesn't exist
        if (path === ".git") return true;
        if (path.includes(".claude/projects")) return false;
        return false;
      });

      const result = runInit("/Users/test/project");

      expect(result.warnings).toContain("No Claude session found - start Claude to see activity");
    });

    it("returns both warnings when neither git nor Claude session exists", () => {
      fsMock.existsSync.mockReturnValue(false);

      const result = runInit("/Users/test/project");

      expect(result.warnings).toHaveLength(2);
      expect(result.warnings).toContain("Not a git repository - Git panel will show limited info");
      expect(result.warnings).toContain("No Claude session found - start Claude to see activity");
    });

    it("returns no warnings when both git and Claude session exist", () => {
      fsMock.existsSync.mockImplementation((path: string) => {
        if (path === ".git") return true;
        // Handle both / and \ path separators for cross-platform compatibility
        if (path.includes(".claude") && path.includes("projects")) return true;
        if (path === ".gitignore") return true;
        return false;
      });
      fsMock.readFileSync.mockReturnValue(".agenthud/\n");

      const result = runInit("/Users/test/project");

      expect(result.warnings).toHaveLength(0);
    });
  });
});
