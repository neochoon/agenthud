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
  setReadFileFn as setPlanReadFileFn,
  resetReadFileFn as resetPlanReadFileFn,
} from "../src/data/plan.js";
import {
  setReadFileFn as setTestsReadFileFn,
  resetReadFileFn as resetTestsReadFileFn,
} from "../src/data/tests.js";

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

    // Plan read mock - throw to simulate missing file
    setPlanReadFileFn(() => {
      throw new Error("File not found");
    });

    // Tests read mock - throw to simulate missing file
    setTestsReadFileFn(() => {
      throw new Error("File not found");
    });
  });

  afterEach(() => {
    resetExecFn();
    resetConfigFsMock();
    resetPlanReadFileFn();
    resetTestsReadFileFn();
  });

  describe("panel visibility", () => {
    it("shows all panels with default config", () => {
      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).toContain("Git");
      expect(lastFrame()).toContain("Plan");
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
      expect(lastFrame()).toContain("Plan");
      expect(lastFrame()).toContain("Tests");
    });

    it("hides plan panel when disabled", () => {
      configFsMock.existsSync.mockReturnValue(true);
      configFsMock.readFileSync.mockReturnValue(`
panels:
  plan:
    enabled: false
`);

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).toContain("Git");
      expect(lastFrame()).not.toContain("─ Plan");
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
      expect(lastFrame()).toContain("Plan");
      expect(lastFrame()).not.toContain("─ Tests");
    });

    it("hides all panels when all disabled", () => {
      configFsMock.existsSync.mockReturnValue(true);
      configFsMock.readFileSync.mockReturnValue(`
panels:
  git:
    enabled: false
  plan:
    enabled: false
  tests:
    enabled: false
`);

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).not.toContain("─ Git");
      expect(lastFrame()).not.toContain("─ Plan");
      expect(lastFrame()).not.toContain("─ Tests");
    });
  });

  describe("config warnings", () => {
    it("shows warnings for invalid config", () => {
      configFsMock.existsSync.mockReturnValue(true);
      configFsMock.readFileSync.mockReturnValue(`
panels:
  unknown:
    enabled: true
`);

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).toContain("Unknown panel 'unknown'");
    });
  });
});
