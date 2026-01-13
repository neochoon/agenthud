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
import {
  setFsMock as setOtherSessionsFsMock,
  resetFsMock as resetOtherSessionsFsMock,
  type FsMock as OtherSessionsFsMock,
} from "../src/data/otherSessions.js";
import { getDisplayWidth } from "../src/ui/constants.js";

// Helper to strip ANSI codes (including colors and clear-to-EOL)
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

describe("App", () => {
  let mockExec: ReturnType<typeof vi.fn>;
  let configFsMock: ConfigFsMock;

  beforeEach(() => {
    mockExec = vi.fn();
    setExecFn(mockExec);

    // Mock config to avoid running actual npm test command
    configFsMock = {
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue(`
panels:
  git:
    enabled: true
    interval: 30s
  tests:
    enabled: true
    interval: manual
`),
    };
    setConfigFsMock(configFsMock);

    // Mock test results file
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

    // Other sessions fs mock - simulate no projects
    const otherSessionsFsMock: OtherSessionsFsMock = {
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn().mockReturnValue(""),
      readdirSync: vi.fn().mockReturnValue([]),
      statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }),
    };
    setOtherSessionsFsMock(otherSessionsFsMock);
  });

  afterEach(() => {
    resetExecFn();
    resetConfigFsMock();
    resetTestsReadFileFn();
    resetClaudeFsMock();
    resetOtherSessionsFsMock();
  });

  describe("rendering", () => {
    it("renders GitPanel with git data", () => {
      // Mock git commands
      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes("branch --show-current")) {
          return "main\n";
        }
        if (cmd.includes("git log")) {
          return "abc1234|2025-01-09T10:00:00+09:00|Add feature\n";
        }
        if (cmd.includes("git diff")) {
          return " 1 file changed, 10 insertions(+), 5 deletions(-)\n";
        }
        return "";
      });

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).toContain("Git");
      expect(lastFrame()).toContain("main");
    });

    it("shows 'Not a git repository' when not in git repo", () => {
      mockExec.mockImplementation(() => {
        throw new Error("fatal: not a git repository");
      });

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).toContain("Not a git repository");
    });
  });

  describe("once mode", () => {
    it("renders once and exits", () => {
      mockExec.mockReturnValue("main\n");

      const { lastFrame } = render(<App mode="once" />);

      // Should render content
      expect(lastFrame()).toContain("Git");
    });
  });

  describe("status bar", () => {
    it("shows status bar with countdown in watch mode", () => {
      mockExec.mockReturnValue("main\n");

      const { lastFrame } = render(<App mode="watch" />);

      expect(lastFrame()).toContain("↻");
      expect(lastFrame()).toMatch(/\ds/); // countdown like "5s" or "3s"
    });

    it("shows keyboard shortcuts in status bar", () => {
      mockExec.mockReturnValue("main\n");

      const { lastFrame } = render(<App mode="watch" />);

      expect(lastFrame()).toContain("q:");
      expect(lastFrame()).toContain("quit");
      expect(lastFrame()).toContain("r:");
      expect(lastFrame()).toContain("refresh");
    });

    it("does not show status bar in once mode", () => {
      mockExec.mockReturnValue("main\n");

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).not.toContain("↻");
      expect(lastFrame()).not.toContain("quit");
    });
  });

  describe("responsive width", () => {
    it("renders all panel lines with consistent width", () => {
      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes("branch --show-current")) {
          return "main\n";
        }
        return "";
      });

      const { lastFrame } = render(<App mode="once" />);
      const output = lastFrame() || "";
      const lines = output.split("\n").filter((line) => line.trim());

      // Find panel border lines (contain box drawing characters)
      const panelLines = lines.filter(
        (line) => line.includes("┌") || line.includes("│") || line.includes("└")
      );

      // All panel lines should have the same display width (accounting for emojis)
      const widths = panelLines.map((line) => getDisplayWidth(stripAnsi(line)));
      const uniqueWidths = [...new Set(widths)];

      // There should be only one unique width (all lines same width)
      expect(uniqueWidths.length).toBe(1);
      // Width should be consistent (either fallback 80 or detected)
      expect(widths[0]).toBeGreaterThanOrEqual(50);
      expect(widths[0]).toBeLessThanOrEqual(120);
    });
  });
});
