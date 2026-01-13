import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import {
  getCustomPanelData,
  getCustomPanelDataAsync,
  setExecFn,
  resetExecFn,
  setReadFileFn,
  resetReadFileFn,
} from "../src/data/custom.js";
import type { CustomPanelConfig } from "../src/config/parser.js";

describe("custom panel data", () => {
  beforeEach(() => {
    resetExecFn();
    resetReadFileFn();
  });

  afterEach(() => {
    resetExecFn();
    resetReadFileFn();
  });

  describe("getCustomPanelData", () => {
    describe("command execution", () => {
      it("parses JSON output from command", () => {
        setExecFn(() =>
          JSON.stringify({
            title: "My Panel",
            summary: "Test summary",
            items: [{ text: "item1" }],
          })
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
        setExecFn(() => JSON.stringify({ summary: "No title" }));

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
        setExecFn(() => "line1\nline2\nline3");

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
        setExecFn(() => "line1\n\nline2\n  \nline3");

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
        setExecFn(() => {
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
        setReadFileFn(() =>
          JSON.stringify({
            title: "File Panel",
            summary: "From file",
            items: [{ text: "file item" }],
            progress: { current: 5, total: 10 },
            stats: [{ label: "Count", value: "42" }],
          })
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
        setReadFileFn(() => {
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
        setReadFileFn(() => "not valid json");

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
      setExecFn(() => "output");

      const config: CustomPanelConfig = {
        enabled: true,
        interval: 30000,
        command: "echo test",
        renderer: {} as CustomPanelConfig["renderer"],
      };

      const result = getCustomPanelData("test", config);

      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("getCustomPanelDataAsync", () => {
    it("parses JSON output from command", async () => {
      const config: CustomPanelConfig = {
        enabled: true,
        interval: 30000,
        // Use node -e for cross-platform JSON output (single quotes don't work on Windows)
        command: 'node -e "console.log(JSON.stringify({title:\\"Async Panel\\",summary:\\"async test\\"}))"',
        renderer: {} as CustomPanelConfig["renderer"],
      };

      const result = await getCustomPanelDataAsync("test", config);

      expect(result.data.title).toBe("Async Panel");
      expect(result.data.summary).toBe("async test");
    });

    it("parses non-JSON output as line-separated items", async () => {
      const config: CustomPanelConfig = {
        enabled: true,
        interval: 30000,
        // Use node -e for cross-platform output (printf doesn't work on Windows)
        command: 'node -e "console.log(\\"line1\\");console.log(\\"line2\\")"',
        renderer: {} as CustomPanelConfig["renderer"],
      };

      const result = await getCustomPanelDataAsync("test", config);

      expect(result.data.items).toEqual([{ text: "line1" }, { text: "line2" }]);
    });

    it("handles command failure", async () => {
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
      // Create a temp file for testing
      const fs = await import("fs/promises");
      const testPath = join(tmpdir(), "agenthud-test-panel.json");
      await fs.writeFile(
        testPath,
        JSON.stringify({ title: "Async File", summary: "from file" })
      );

      const config: CustomPanelConfig = {
        enabled: true,
        interval: 30000,
        source: testPath,
        renderer: {} as CustomPanelConfig["renderer"],
      };

      const result = await getCustomPanelDataAsync("test", config);

      expect(result.data.title).toBe("Async File");
      expect(result.data.summary).toBe("from file");

      await fs.unlink(testPath);
    });

    it("handles file not found", async () => {
      const config: CustomPanelConfig = {
        enabled: true,
        interval: 30000,
        source: join(tmpdir(), "this-file-does-not-exist-12345.json"),
        renderer: {} as CustomPanelConfig["renderer"],
      };

      const result = await getCustomPanelDataAsync("test", config);

      expect(result.error).toBe("File not found");
    });

    it("handles invalid JSON in file", async () => {
      const fs = await import("fs/promises");
      const testPath = join(tmpdir(), "agenthud-test-invalid.json");
      await fs.writeFile(testPath, "not json");

      const config: CustomPanelConfig = {
        enabled: true,
        interval: 30000,
        source: testPath,
        renderer: {} as CustomPanelConfig["renderer"],
      };

      const result = await getCustomPanelDataAsync("test", config);

      expect(result.error).toBe("Invalid JSON");

      await fs.unlink(testPath);
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
