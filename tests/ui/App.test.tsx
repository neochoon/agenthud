import { render } from "ink-testing-library";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process module
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
    exec: vi.fn(),
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
    statSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

import { execSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { App } from "../../src/ui/App.js";
import { getDisplayWidth } from "../../src/ui/constants.js";

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockStatSync = vi.mocked(statSync);
const _mockUnlinkSync = vi.mocked(unlinkSync);

// Helper to strip ANSI codes (including colors and clear-to-EOL)
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: no config file exists, but package.json exists
    mockExistsSync.mockReturnValue(false);

    // Default readFileSync - handle package.json for getVersion()
    mockReadFileSync.mockImplementation((path: any) => {
      if (String(path).includes("package.json")) {
        return JSON.stringify({ version: "0.0.0-test" });
      }
      return "";
    });

    // Default git mock
    mockExecSync.mockImplementation((cmd: any) => {
      if (String(cmd).includes("branch --show-current")) return "main\n";
      if (String(cmd).includes("git log")) return "";
      if (String(cmd).includes("git diff")) return "";
      if (String(cmd).includes("status --porcelain")) return "";
      if (String(cmd).includes("rev-parse --short HEAD")) return "abc1234\n";
      return "";
    });

    // Default: no projects directory for other sessions
    mockReaddirSync.mockReturnValue([]);
    mockStatSync.mockReturnValue({
      mtimeMs: 0,
      isDirectory: () => true,
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("renders GitPanel with git data", () => {
      // Mock git commands
      mockExecSync.mockImplementation((cmd: any) => {
        if (String(cmd).includes("branch --show-current")) {
          return "main\n";
        }
        if (String(cmd).includes("git log")) {
          return "abc1234|2025-01-09T10:00:00+09:00|Add feature\n";
        }
        if (String(cmd).includes("git diff")) {
          return " 1 file changed, 10 insertions(+), 5 deletions(-)\n";
        }
        return "";
      });

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).toContain("Git");
      expect(lastFrame()).toContain("main");
    });

    it("shows 'Not a git repository' when not in git repo", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("fatal: not a git repository");
      });

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).toContain("Not a git repository");
    });
  });

  describe("once mode", () => {
    it("renders once and exits", () => {
      mockExecSync.mockReturnValue("main\n");

      const { lastFrame } = render(<App mode="once" />);

      // Should render content
      expect(lastFrame()).toContain("Git");
    });
  });

  describe("status bar", () => {
    it("shows status bar with countdown in watch mode", () => {
      mockExecSync.mockReturnValue("main\n");

      const { lastFrame } = render(<App mode="watch" />);

      expect(lastFrame()).toContain("↻");
      expect(lastFrame()).toMatch(/\ds/); // countdown like "5s" or "3s"
    });

    it("shows keyboard shortcuts in status bar", () => {
      mockExecSync.mockReturnValue("main\n");

      const { lastFrame } = render(<App mode="watch" />);

      expect(lastFrame()).toContain("q:");
      expect(lastFrame()).toContain("quit");
      expect(lastFrame()).toContain("r:");
      expect(lastFrame()).toContain("refresh");
    });

    it("does not show status bar in once mode", () => {
      mockExecSync.mockReturnValue("main\n");

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).not.toContain("↻");
      expect(lastFrame()).not.toContain("quit");
    });
  });

  describe("responsive width", () => {
    it("renders all panel lines with consistent width", () => {
      mockExecSync.mockImplementation((cmd: any) => {
        if (String(cmd).includes("branch --show-current")) {
          return "main\n";
        }
        return "";
      });

      const { lastFrame } = render(<App mode="once" />);
      const output = lastFrame() || "";
      const lines = output.split("\n").filter((line) => line.trim());

      // Find panel border lines (contain box drawing characters)
      const panelLines = lines.filter(
        (line) =>
          line.includes("┌") || line.includes("│") || line.includes("└"),
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

  describe("testsDisabled", () => {
    it("shows Tests panel with error when test command fails initially", () => {
      // Mock config file exists with test command
      mockExistsSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) {
          return `
panels:
  git:
    enabled: true
    interval: 30s
  tests:
    enabled: true
    interval: manual
    command: npx vitest run --reporter=json
`;
        }
        return "";
      });

      // Mock git commands and test command failure
      mockExecSync.mockImplementation((cmd: any) => {
        if (String(cmd).includes("branch --show-current")) {
          return "main\n";
        }
        if (String(cmd).includes("npx vitest")) {
          throw new Error("Command failed: npx vitest run --reporter=json");
        }
        return "";
      });

      const { lastFrame } = render(<App mode="once" />);

      // Tests panel should be rendered when command is configured (even if it fails)
      expect(lastFrame()).toContain("Tests");
    });

    it("shows Tests panel when test command succeeds", async () => {
      vi.useFakeTimers();

      // Mock config file exists with test command
      mockExistsSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) return true;
        if (String(path).includes("test-results.xml")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) {
          return `
panels:
  git:
    enabled: true
    interval: 30s
  tests:
    enabled: true
    interval: manual
    command: npx vitest run --reporter=junit --outputFile=.agenthud/test-results.xml
`;
        }
        if (String(path).includes("test-results.xml")) {
          return `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="vitest" tests="10" errors="0" failures="0" skipped="0">
    <testcase classname="test" name="test" time="0.001"/>
  </testsuite>
</testsuites>`;
        }
        return "";
      });

      mockExecSync.mockImplementation((cmd: any) => {
        if (String(cmd).includes("branch --show-current")) {
          return "main\n";
        }
        if (String(cmd).includes("rev-parse --short HEAD")) {
          return "abc1234\n";
        }
        return "";
      });

      const { lastFrame } = render(<App mode="once" />);

      // Wait for lazy test loading
      await act(async () => {
        vi.advanceTimersByTime(10);
      });

      // Tests panel should be rendered when command succeeds
      expect(lastFrame()).toContain("Tests");
      expect(lastFrame()).toContain("10 passed");

      vi.useRealTimers();
    });

    it("shows Tests panel when no command is configured (file-based)", async () => {
      vi.useFakeTimers();

      // Mock config file exists WITHOUT test command (file-based mode)
      mockExistsSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) return true;
        if (String(path).includes("test-results.json")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) {
          return `
panels:
  git:
    enabled: true
    interval: 30s
  tests:
    enabled: true
    interval: manual
`;
        }
        if (String(path).includes("test-results.json")) {
          return JSON.stringify({
            hash: "abc1234",
            timestamp: "2025-01-01T00:00:00Z",
            passed: 5,
            failed: 1,
            skipped: 0,
            failures: [{ file: "test.ts", name: "test1" }],
          });
        }
        return "";
      });

      mockExecSync.mockImplementation((cmd: any) => {
        if (String(cmd).includes("branch --show-current")) {
          return "main\n";
        }
        if (String(cmd).includes("rev-parse --short HEAD")) {
          return "abc1234\n";
        }
        return "";
      });

      const { lastFrame } = render(<App mode="once" />);

      // Wait for lazy test loading
      await act(async () => {
        vi.advanceTimersByTime(10);
      });

      // Tests panel should be rendered when file-based data is available
      // (testsDisabled only applies to command-based tests)
      expect(lastFrame()).toContain("Tests");
      expect(lastFrame()).toContain("5 passed");

      vi.useRealTimers();
    });
  });
});
