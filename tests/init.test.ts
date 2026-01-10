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

  describe("creates .agent/ directory", () => {
    it("creates directory when it doesn't exist", () => {
      fsMock.existsSync.mockReturnValue(false);

      runInit();

      expect(fsMock.mkdirSync).toHaveBeenCalledWith(".agent", { recursive: true });
    });

    it("skips directory creation when it exists", () => {
      fsMock.existsSync.mockImplementation((path: string) => path === ".agent");

      runInit();

      expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe("creates plan.json", () => {
    it("creates empty plan.json when it doesn't exist", () => {
      fsMock.existsSync.mockReturnValue(false);

      runInit();

      expect(fsMock.writeFileSync).toHaveBeenCalledWith(
        ".agent/plan.json",
        "{}\n"
      );
    });

    it("skips plan.json when it exists", () => {
      fsMock.existsSync.mockImplementation((path: string) =>
        path === ".agent/plan.json"
      );

      runInit();

      expect(fsMock.writeFileSync).not.toHaveBeenCalledWith(
        ".agent/plan.json",
        expect.any(String)
      );
    });
  });

  describe("creates decisions.json", () => {
    it("creates empty decisions.json when it doesn't exist", () => {
      fsMock.existsSync.mockReturnValue(false);

      runInit();

      expect(fsMock.writeFileSync).toHaveBeenCalledWith(
        ".agent/decisions.json",
        "[]\n"
      );
    });

    it("skips decisions.json when it exists", () => {
      fsMock.existsSync.mockImplementation((path: string) =>
        path === ".agent/decisions.json"
      );

      runInit();

      expect(fsMock.writeFileSync).not.toHaveBeenCalledWith(
        ".agent/decisions.json",
        expect.any(String)
      );
    });
  });

  describe("updates CLAUDE.md", () => {
    const agentStateSection = `## Agent State

Maintain \`.agent/\` directory:
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

      expect(fsMock.appendFileSync).not.toHaveBeenCalled();
      expect(fsMock.writeFileSync).not.toHaveBeenCalledWith(
        "CLAUDE.md",
        expect.any(String)
      );
    });
  });

  describe("return value", () => {
    it("returns list of created files", () => {
      fsMock.existsSync.mockReturnValue(false);

      const result = runInit();

      expect(result.created).toContain(".agent/");
      expect(result.created).toContain(".agent/plan.json");
      expect(result.created).toContain(".agent/decisions.json");
      expect(result.created).toContain("CLAUDE.md");
    });

    it("returns list of skipped files", () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue("## Agent State\n");

      const result = runInit();

      expect(result.skipped).toContain(".agent/");
      expect(result.skipped).toContain(".agent/plan.json");
      expect(result.skipped).toContain(".agent/decisions.json");
      expect(result.skipped).toContain("CLAUDE.md");
    });
  });
});
