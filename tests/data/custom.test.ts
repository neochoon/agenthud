import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process module
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  // Create a mock exec function with custom promisify
  const mockExecFn = vi.fn(
    (
      _cmd: string,
      callback?: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      // Default mock implementation that calls callback with error
      if (callback) {
        callback(new Error("Mock exec not configured"), "", "");
      }
      return {} as any;
    },
  );
  // Add custom promisify to return {stdout, stderr} like real exec
  (mockExecFn as any)[promisify.custom] = vi.fn(async () => {
    return { stdout: "", stderr: "" };
  });
  return {
    ...actual,
    execSync: vi.fn(),
    exec: mockExecFn,
  };
});

// Mock fs module
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(),
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
    },
  };
});

import { exec, execSync } from "node:child_process";
import { promises as fsPromises, readFileSync } from "node:fs";
import type { CustomPanelConfig } from "../../src/config/parser.js";
import {
  getCustomPanelData,
  getCustomPanelDataAsync,
} from "../../src/data/custom.js";

const mockExecSync = vi.mocked(execSync);
const _mockExec = vi.mocked(exec);
// Get the custom promisify mock for async exec tests
const mockExecAsync = vi.mocked((exec as any)[promisify.custom]);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReadFile = vi.mocked(fsPromises.readFile);

describe("custom panel data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getCustomPanelData", () => {
    describe("command execution", () => {
      it("parses JSON output from command", () => {
        mockExecSync.mockReturnValue(
          JSON.stringify({
            title: "My Panel",
            summary: "Test summary",
            items: [{ text: "item1" }],
          }),
        );

        const config: CustomPanelConfig = {
          enabled: true,
          interval: 30000,
          command: "echo test",
          renderer: {} as CustomPanelConfig["renderer"],
        };

        const result = getCustomPanelData("test", config);

        expect(result.data.title).toBe("My Panel");
        expect(result.data.summary).toBe("Test summary");
        expect(result.data.items).toEqual([{ text: "item1" }]);
        expect(result.error).toBeUndefined();
      });

      it("uses panel name as title if not in JSON", () => {
        mockExecSync.mockReturnValue(JSON.stringify({ summary: "No title" }));

        const config: CustomPanelConfig = {
          enabled: true,
          interval: 30000,
          command: "echo test",
          renderer: {} as CustomPanelConfig["renderer"],
        };

        const result = getCustomPanelData("myPanel", config);

        expect(result.data.title).toBe("MyPanel");
      });

      it("parses non-JSON output as line-separated items", () => {
        mockExecSync.mockReturnValue("line1\nline2\nline3");

        const config: CustomPanelConfig = {
          enabled: true,
          interval: 30000,
          command: "echo lines",
          renderer: {} as CustomPanelConfig["renderer"],
        };

        const result = getCustomPanelData("test", config);

        expect(result.data.title).toBe("Test");
        expect(result.data.items).toEqual([
          { text: "line1" },
          { text: "line2" },
          { text: "line3" },
        ]);
      });

      it("filters empty lines from output", () => {
        mockExecSync.mockReturnValue("line1\n\nline2\n  \nline3");

        const config: CustomPanelConfig = {
          enabled: true,
          interval: 30000,
          command: "echo lines",
          renderer: {} as CustomPanelConfig["renderer"],
        };

        const result = getCustomPanelData("test", config);

        expect(result.data.items).toHaveLength(3);
      });

      it("handles command failure", () => {
        mockExecSync.mockImplementation(() => {
          throw new Error("Command not found");
        });

        const config: CustomPanelConfig = {
          enabled: true,
          interval: 30000,
          command: "invalid-command",
          renderer: {} as CustomPanelConfig["renderer"],
        };

        const result = getCustomPanelData("test", config);

        expect(result.error).toContain("Command failed");
        expect(result.data.title).toBe("Test");
      });
    });

    describe("source file", () => {
      it("reads and parses JSON from source file", () => {
        mockReadFileSync.mockReturnValue(
          JSON.stringify({
            title: "File Panel",
            summary: "From file",
            items: [{ text: "file item" }],
            progress: { current: 5, total: 10 },
            stats: [{ label: "Count", value: "42" }],
          }),
        );

        const config: CustomPanelConfig = {
          enabled: true,
          interval: 30000,
          source: "panel.json",
          renderer: {} as CustomPanelConfig["renderer"],
        };

        const result = getCustomPanelData("test", config);

        expect(result.data.title).toBe("File Panel");
        expect(result.data.summary).toBe("From file");
        expect(result.data.items).toEqual([{ text: "file item" }]);
        expect(result.data.progress).toEqual({ current: 5, total: 10 });
        expect(result.data.stats).toEqual([{ label: "Count", value: "42" }]);
      });

      it("handles file not found", () => {
        mockReadFileSync.mockImplementation(() => {
          throw new Error("ENOENT: no such file");
        });

        const config: CustomPanelConfig = {
          enabled: true,
          interval: 30000,
          source: "missing.json",
          renderer: {} as CustomPanelConfig["renderer"],
        };

        const result = getCustomPanelData("test", config);

        expect(result.error).toBe("File not found");
      });

      it("handles invalid JSON in file", () => {
        mockReadFileSync.mockReturnValue("not valid json");

        const config: CustomPanelConfig = {
          enabled: true,
          interval: 30000,
          source: "invalid.json",
          renderer: {} as CustomPanelConfig["renderer"],
        };

        const result = getCustomPanelData("test", config);

        expect(result.error).toBe("Invalid JSON");
      });
    });

    it("returns error when no command or source configured", () => {
      const config: CustomPanelConfig = {
        enabled: true,
        interval: 30000,
        renderer: {} as CustomPanelConfig["renderer"],
      };

      const result = getCustomPanelData("test", config);

      expect(result.error).toBe("No command or source configured");
    });

    it("includes timestamp in result", () => {
      mockExecSync.mockReturnValue("output");

      const config: CustomPanelConfig = {
        enabled: true,
        interval: 30000,
        command: "echo test",
        renderer: {} as CustomPanelConfig["renderer"],
      };

      const result = getCustomPanelData("test", config);

      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
    });
  });

  describe("getCustomPanelDataAsync", () => {
    it("parses JSON output from command", async () => {
      // Mock execAsync (promisified exec) to return JSON output
      mockExecAsync.mockResolvedValue({
        stdout: JSON.stringify({ title: "Async Panel", summary: "async test" }),
        stderr: "",
      });

      const config: CustomPanelConfig = {
        enabled: true,
        interval: 30000,
        command: "echo test",
        renderer: {} as CustomPanelConfig["renderer"],
      };

      const result = await getCustomPanelDataAsync("test", config);

      expect(result.data.title).toBe("Async Panel");
      expect(result.data.summary).toBe("async test");
    });

    it("parses non-JSON output as line-separated items", async () => {
      // Mock execAsync to return line-separated output
      mockExecAsync.mockResolvedValue({
        stdout: "line1\nline2",
        stderr: "",
      });

      const config: CustomPanelConfig = {
        enabled: true,
        interval: 30000,
        command: "echo lines",
        renderer: {} as CustomPanelConfig["renderer"],
      };

      const result = await getCustomPanelDataAsync("test", config);

      expect(result.data.items).toEqual([{ text: "line1" }, { text: "line2" }]);
    });

    it("handles command failure", async () => {
      // Mock execAsync to reject with error
      mockExecAsync.mockRejectedValue(new Error("Command not found"));

      const config: CustomPanelConfig = {
        enabled: true,
        interval: 30000,
        command: "this-command-does-not-exist-12345",
        renderer: {} as CustomPanelConfig["renderer"],
      };

      const result = await getCustomPanelDataAsync("test", config);

      expect(result.error).toContain("Command failed");
    });

    it("reads from source file", async () => {
      // Mock fsPromises.readFile to return JSON
      mockReadFile.mockResolvedValue(
        JSON.stringify({ title: "Async File", summary: "from file" }),
      );

      const config: CustomPanelConfig = {
        enabled: true,
        interval: 30000,
        source: "/tmp/agenthud-test-panel.json",
        renderer: {} as CustomPanelConfig["renderer"],
      };

      const result = await getCustomPanelDataAsync("test", config);

      expect(result.data.title).toBe("Async File");
      expect(result.data.summary).toBe("from file");
    });

    it("handles file not found", async () => {
      // Mock fsPromises.readFile to reject with ENOENT error
      mockReadFile.mockRejectedValue(
        new Error("ENOENT: no such file or directory"),
      );

      const config: CustomPanelConfig = {
        enabled: true,
        interval: 30000,
        source: "/tmp/this-file-does-not-exist.json",
        renderer: {} as CustomPanelConfig["renderer"],
      };

      const result = await getCustomPanelDataAsync("test", config);

      expect(result.error).toBe("File not found");
    });

    it("handles invalid JSON in file", async () => {
      // Mock fsPromises.readFile to return invalid JSON
      mockReadFile.mockResolvedValue("not json");

      const config: CustomPanelConfig = {
        enabled: true,
        interval: 30000,
        source: "/tmp/agenthud-test-invalid.json",
        renderer: {} as CustomPanelConfig["renderer"],
      };

      const result = await getCustomPanelDataAsync("test", config);

      expect(result.error).toBe("Invalid JSON");
    });

    it("returns error when no command or source configured", async () => {
      const config: CustomPanelConfig = {
        enabled: true,
        interval: 30000,
        renderer: {} as CustomPanelConfig["renderer"],
      };

      const result = await getCustomPanelDataAsync("test", config);

      expect(result.error).toBe("No command or source configured");
    });
  });
});
