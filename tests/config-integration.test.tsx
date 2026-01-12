import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../src/ui/App.js";
import { setExecFn, resetExecFn } from "../src/data/git.js";
import {
  setFsMock as setConfigFsMock,
  resetFsMock as resetConfigFsMock,
  type FsMock as ConfigFsMock,
} from "../src/config/parser.js";
import {
  setReadFileFn as setTestsReadFileFn,
  resetReadFileFn as resetTestsReadFileFn,
} from "../src/data/tests.js";
import {
  setFsMock as setClaudeFsMock,
  resetFsMock as resetClaudeFsMock,
  type FsMock as ClaudeFsMock,
} from "../src/data/claude.js";

describe("App with config", () => {
  let mockExec: ReturnType<typeof vi.fn>;
  let configFsMock: ConfigFsMock;

  beforeEach(() => {
    mockExec = vi.fn();
    setExecFn(mockExec);

    // Default git mock
    mockExec.mockImplementation((cmd: string) => {
      if (cmd.includes("branch --show-current")) return "main\n";
      if (cmd.includes("git log")) return "";
      if (cmd.includes("git diff")) return "";
      if (cmd.includes("status --porcelain")) return "";
      return "";
    });

    // Config fs mock
    configFsMock = {
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn(),
    };
    setConfigFsMock(configFsMock);

    // Tests read mock - throw to simulate missing file
    setTestsReadFileFn(() => {
      throw new Error("File not found");
    });

    // Claude fs mock - simulate no active session
    const claudeFsMock: ClaudeFsMock = {
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn().mockReturnValue(""),
      readdirSync: vi.fn().mockReturnValue([]),
      statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }),
    };
    setClaudeFsMock(claudeFsMock);
  });

  afterEach(() => {
    resetExecFn();
    resetConfigFsMock();
    resetTestsReadFileFn();
    resetClaudeFsMock();
  });

  describe("panel visibility", () => {
    it("shows all panels with default config", () => {
      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).toContain("Git");
      expect(lastFrame()).toContain("Tests");
    });

    it("hides git panel when disabled", () => {
      configFsMock.existsSync.mockReturnValue(true);
      configFsMock.readFileSync.mockReturnValue(`
panels:
  git:
    enabled: false
`);

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).not.toContain("─ Git");
      expect(lastFrame()).toContain("Tests");
    });

    it("hides tests panel when disabled", () => {
      configFsMock.existsSync.mockReturnValue(true);
      configFsMock.readFileSync.mockReturnValue(`
panels:
  tests:
    enabled: false
`);

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).toContain("Git");
      expect(lastFrame()).not.toContain("─ Tests");
    });

    it("hides all panels when all disabled", () => {
      configFsMock.existsSync.mockReturnValue(true);
      configFsMock.readFileSync.mockReturnValue(`
panels:
  git:
    enabled: false
  tests:
    enabled: false
`);

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).not.toContain("─ Git");
      expect(lastFrame()).not.toContain("─ Tests");
    });
  });

  describe("config warnings", () => {
    it("shows warnings for invalid renderer", () => {
      configFsMock.existsSync.mockReturnValue(true);
      configFsMock.readFileSync.mockReturnValue(`
panels:
  custom:
    enabled: true
    command: echo test
    renderer: invalid
`);

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).toContain("Invalid renderer 'invalid'");
    });
  });

  describe("panel order", () => {
    it("renders panels in config.yaml order", () => {
      configFsMock.existsSync.mockReturnValue(true);
      configFsMock.readFileSync.mockReturnValue(`
panels:
  git:
    enabled: true
  docker:
    enabled: true
    command: echo "nginx"
  tests:
    enabled: true
`);

      const { lastFrame } = render(<App mode="once" />);
      const output = lastFrame() || "";

      // Verify order by checking positions
      const gitPos = output.indexOf("─ Git");
      const dockerPos = output.indexOf("─ Docker");
      const testsPos = output.indexOf("─ Tests");

      expect(gitPos).toBeLessThan(dockerPos);
      expect(dockerPos).toBeLessThan(testsPos);
    });

    it("places custom panel between built-in panels", () => {
      configFsMock.existsSync.mockReturnValue(true);
      configFsMock.readFileSync.mockReturnValue(`
panels:
  git:
    enabled: true
  docker:
    enabled: true
    command: echo "nginx"
  tests:
    enabled: true
`);

      const { lastFrame } = render(<App mode="once" />);
      const output = lastFrame() || "";

      // Order: git -> docker -> tests
      const gitPos = output.indexOf("─ Git");
      const dockerPos = output.indexOf("─ Docker");
      const testsPos = output.indexOf("─ Tests");

      expect(gitPos).toBeLessThan(dockerPos);
      expect(dockerPos).toBeLessThan(testsPos);
    });
  });
});
