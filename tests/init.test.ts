import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runInit, setFsMock, resetFsMock, type FsMock } from "../src/commands/init.js";

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

    it("creates .agenthud/plan directory", () => {
      fsMock.existsSync.mockReturnValue(false);

      runInit();

      expect(fsMock.mkdirSync).toHaveBeenCalledWith(".agenthud/plan", { recursive: true });
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

  describe("creates plan/plan.json", () => {
    it("creates empty plan.json in plan folder when it doesn't exist", () => {
      fsMock.existsSync.mockReturnValue(false);

      runInit();

      expect(fsMock.writeFileSync).toHaveBeenCalledWith(
        ".agenthud/plan/plan.json",
        "{}\n"
      );
    });

    it("skips plan.json when it exists", () => {
      fsMock.existsSync.mockImplementation((path: string) =>
        path === ".agenthud/plan/plan.json"
      );

      runInit();

      expect(fsMock.writeFileSync).not.toHaveBeenCalledWith(
        ".agenthud/plan/plan.json",
        expect.any(String)
      );
    });
  });

  describe("creates plan/decisions.json", () => {
    it("creates empty decisions.json in plan folder when it doesn't exist", () => {
      fsMock.existsSync.mockReturnValue(false);

      runInit();

      expect(fsMock.writeFileSync).toHaveBeenCalledWith(
        ".agenthud/plan/decisions.json",
        "[]\n"
      );
    });

    it("skips decisions.json when it exists", () => {
      fsMock.existsSync.mockImplementation((path: string) =>
        path === ".agenthud/plan/decisions.json"
      );

      runInit();

      expect(fsMock.writeFileSync).not.toHaveBeenCalledWith(
        ".agenthud/plan/decisions.json",
        expect.any(String)
      );
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

  describe("updates CLAUDE.md", () => {
    const agentStateSection = `## Agent State

Maintain \`.agenthud/\` directory:
- Update \`plan.json\` when plan changes
- Append to \`decisions.json\` for key decisions
`;

    it("creates CLAUDE.md with agent state section when it doesn't exist", () => {
      fsMock.existsSync.mockReturnValue(false);

      runInit();

      expect(fsMock.writeFileSync).toHaveBeenCalledWith(
        "CLAUDE.md",
        agentStateSection
      );
    });

    it("appends agent state section to existing CLAUDE.md", () => {
      fsMock.existsSync.mockImplementation((path: string) =>
        path === "CLAUDE.md"
      );
      fsMock.readFileSync.mockReturnValue("# My Project\n\nSome content.\n");

      runInit();

      expect(fsMock.appendFileSync).toHaveBeenCalledWith(
        "CLAUDE.md",
        "\n" + agentStateSection
      );
    });

    it("skips if CLAUDE.md already contains Agent State section", () => {
      fsMock.existsSync.mockImplementation((path: string) =>
        path === "CLAUDE.md"
      );
      fsMock.readFileSync.mockReturnValue("# Project\n\n## Agent State\n\nAlready exists.\n");

      runInit();

      expect(fsMock.appendFileSync).not.toHaveBeenCalledWith(
        "CLAUDE.md",
        expect.any(String)
      );
    });
  });

  describe("creates config.yaml", () => {
    const defaultConfig = `# agenthud configuration
panels:
  project:
    enabled: true
    interval: 5m  # doesn't change often

  git:
    enabled: true
    interval: 30s
    command:
      branch: git branch --show-current
      commits: git log --since=midnight --pretty=format:"%h|%aI|%s"
      stats: git log --since=midnight --numstat --pretty=format:""

  plan:
    enabled: true
    interval: 10s
    source: .agenthud/plan/plan.json

  tests:
    enabled: true
    interval: manual
    command: npx vitest run --reporter=json
`;

    it("creates config.yaml with default content when it doesn't exist", () => {
      fsMock.existsSync.mockReturnValue(false);

      runInit();

      expect(fsMock.writeFileSync).toHaveBeenCalledWith(
        ".agenthud/config.yaml",
        defaultConfig
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
      expect(result.created).toContain(".agenthud/plan/");
      expect(result.created).toContain(".agenthud/tests/");
      expect(result.created).toContain(".agenthud/plan/plan.json");
      expect(result.created).toContain(".agenthud/plan/decisions.json");
      expect(result.created).toContain(".agenthud/config.yaml");
      expect(result.created).toContain(".gitignore");
      expect(result.created).toContain("CLAUDE.md");
    });

    it("returns list of skipped files", () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockImplementation((path: string) => {
        if (path === ".gitignore") return ".agenthud/\n";
        if (path === "CLAUDE.md") return "## Agent State\n";
        return "";
      });

      const result = runInit();

      expect(result.skipped).toContain(".agenthud/");
      expect(result.skipped).toContain(".agenthud/plan/");
      expect(result.skipped).toContain(".agenthud/tests/");
      expect(result.skipped).toContain(".agenthud/plan/plan.json");
      expect(result.skipped).toContain(".agenthud/plan/decisions.json");
      expect(result.skipped).toContain(".agenthud/config.yaml");
      expect(result.skipped).toContain(".gitignore");
      expect(result.skipped).toContain("CLAUDE.md");
    });
  });
});
