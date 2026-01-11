import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getPlanData, getPlanDataWithConfig, setReadFileFn, resetReadFileFn, setFileExistsFn, resetFileExistsFn } from "../src/data/plan.js";
import type { PlanPanelConfig } from "../src/config/parser.js";

describe("plan data module", () => {
  let mockReadFile: ReturnType<typeof vi.fn>;
  let mockFileExists: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockReadFile = vi.fn();
    mockFileExists = vi.fn();
    setReadFileFn(mockReadFile);
    setFileExistsFn(mockFileExists);
  });

  afterEach(() => {
    resetReadFileFn();
    resetFileExistsFn();
  });

  describe("getPlanData", () => {
    it("returns plan and decisions when both files exist", () => {
      const planJson = JSON.stringify({
        goal: "Build CLI tool",
        steps: [
          { step: "Setup project", status: "done" },
          { step: "Add feature", status: "in-progress" },
          { step: "Deploy", status: "pending" },
        ],
      });

      const decisionsJson = JSON.stringify({
        decisions: [
          { timestamp: "2026-01-09T10:00:00Z", decision: "Use TypeScript" },
          { timestamp: "2026-01-09T09:00:00Z", decision: "Use Vitest" },
        ],
      });

      mockReadFile.mockImplementation((path: string) => {
        if (path.endsWith("plan.json")) return planJson;
        if (path.endsWith("decisions.json")) return decisionsJson;
        throw new Error("File not found");
      });

      const result = getPlanData();

      expect(result.plan).toEqual({
        goal: "Build CLI tool",
        steps: [
          { step: "Setup project", status: "done" },
          { step: "Add feature", status: "in-progress" },
          { step: "Deploy", status: "pending" },
        ],
      });
      expect(result.decisions).toHaveLength(2);
      expect(result.error).toBeUndefined();
    });

    it("returns null plan with error when plan.json is missing", () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path.endsWith("plan.json")) {
          throw new Error("ENOENT: no such file or directory");
        }
        return "{}";
      });

      const result = getPlanData();

      expect(result.plan).toBeNull();
      expect(result.error).toBe("No plan found");
    });

    it("returns empty decisions when decisions.json is missing", () => {
      const planJson = JSON.stringify({
        goal: "Test",
        steps: [],
      });

      mockReadFile.mockImplementation((path: string) => {
        if (path.endsWith("plan.json")) return planJson;
        if (path.endsWith("decisions.json")) {
          throw new Error("ENOENT: no such file or directory");
        }
        return "{}";
      });

      const result = getPlanData();

      expect(result.plan).not.toBeNull();
      expect(result.decisions).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    it("returns error when plan.json has invalid JSON", () => {
      mockReadFile.mockImplementation((path: string) => {
        if (path.endsWith("plan.json")) return "{ invalid json }";
        return "{}";
      });

      const result = getPlanData();

      expect(result.plan).toBeNull();
      expect(result.error).toBe("Invalid plan.json");
    });

    it("ignores decisions when decisions.json has invalid JSON", () => {
      const planJson = JSON.stringify({
        goal: "Test",
        steps: [],
      });

      mockReadFile.mockImplementation((path: string) => {
        if (path.endsWith("plan.json")) return planJson;
        if (path.endsWith("decisions.json")) return "{ invalid }";
        return "{}";
      });

      const result = getPlanData();

      expect(result.plan).not.toBeNull();
      expect(result.decisions).toEqual([]);
      // No error for invalid decisions.json - just hide the section
    });

    it("limits decisions to most recent 3", () => {
      const planJson = JSON.stringify({ goal: "Test", steps: [] });
      const decisionsJson = JSON.stringify({
        decisions: [
          { timestamp: "2026-01-09T10:00:00Z", decision: "First" },
          { timestamp: "2026-01-09T09:00:00Z", decision: "Second" },
          { timestamp: "2026-01-09T08:00:00Z", decision: "Third" },
          { timestamp: "2026-01-09T07:00:00Z", decision: "Fourth" },
          { timestamp: "2026-01-09T06:00:00Z", decision: "Fifth" },
        ],
      });

      mockReadFile.mockImplementation((path: string) => {
        if (path.endsWith("plan.json")) return planJson;
        if (path.endsWith("decisions.json")) return decisionsJson;
        return "{}";
      });

      const result = getPlanData();

      expect(result.decisions).toHaveLength(3);
      expect(result.decisions[0].decision).toBe("First");
      expect(result.decisions[2].decision).toBe("Third");
    });
  });

  describe("getPlanDataWithConfig", () => {
    it("reads from config.source path", () => {
      const config: PlanPanelConfig = {
        enabled: true,
        interval: 10000,
        source: "custom/path/plan.json",
      };

      const planJson = JSON.stringify({
        goal: "Custom Plan",
        steps: [{ step: "Step 1", status: "done" }],
      });

      mockReadFile.mockImplementation((path: string) => {
        if (path === "custom/path/plan.json") return planJson;
        throw new Error("File not found");
      });

      const result = getPlanDataWithConfig(config);

      expect(result.plan?.goal).toBe("Custom Plan");
      expect(mockReadFile).toHaveBeenCalledWith("custom/path/plan.json");
    });

    it("reads decisions from same directory as plan", () => {
      const config: PlanPanelConfig = {
        enabled: true,
        interval: 10000,
        source: "my/dir/plan.json",
      };

      const planJson = JSON.stringify({ goal: "Test", steps: [] });
      const decisionsJson = JSON.stringify({
        decisions: [{ timestamp: "2026-01-10T10:00:00Z", decision: "Decision 1" }],
      });

      mockReadFile.mockImplementation((path: string) => {
        if (path === "my/dir/plan.json") return planJson;
        if (path === "my/dir/decisions.json") return decisionsJson;
        throw new Error("File not found");
      });

      const result = getPlanDataWithConfig(config);

      expect(result.decisions).toHaveLength(1);
      expect(result.decisions[0].decision).toBe("Decision 1");
    });

    it("uses default path when source not specified", () => {
      const config: PlanPanelConfig = {
        enabled: true,
        interval: 10000,
        source: ".agenthud/plan/plan.json",
      };

      const planJson = JSON.stringify({ goal: "Default", steps: [] });

      mockFileExists.mockReturnValue(true);
      mockReadFile.mockImplementation((path: string) => {
        if (path === ".agenthud/plan/plan.json") return planJson;
        throw new Error("File not found");
      });

      const result = getPlanDataWithConfig(config);

      expect(result.plan?.goal).toBe("Default");
    });

    it("falls back to old location when new location does not exist", () => {
      const config: PlanPanelConfig = {
        enabled: true,
        interval: 10000,
        source: ".agenthud/plan/plan.json",
      };

      const planJson = JSON.stringify({ goal: "Old Location", steps: [] });
      const decisionsJson = JSON.stringify({
        decisions: [{ timestamp: "2026-01-10T10:00:00Z", decision: "Old Decision" }],
      });

      mockFileExists.mockImplementation((path: string) => {
        // New location doesn't exist, old location does
        if (path === ".agenthud/plan/plan.json") return false;
        if (path === ".agenthud/plan.json") return true;
        return false;
      });

      mockReadFile.mockImplementation((path: string) => {
        if (path === ".agenthud/plan.json") return planJson;
        if (path === ".agenthud/decisions.json") return decisionsJson;
        throw new Error("File not found");
      });

      const result = getPlanDataWithConfig(config);

      expect(result.plan?.goal).toBe("Old Location");
      expect(result.decisions).toHaveLength(1);
      expect(result.decisions[0].decision).toBe("Old Decision");
    });

    it("uses new location when both locations exist", () => {
      const config: PlanPanelConfig = {
        enabled: true,
        interval: 10000,
        source: ".agenthud/plan/plan.json",
      };

      const newPlanJson = JSON.stringify({ goal: "New Location", steps: [] });
      const oldPlanJson = JSON.stringify({ goal: "Old Location", steps: [] });

      mockFileExists.mockReturnValue(true);

      mockReadFile.mockImplementation((path: string) => {
        if (path === ".agenthud/plan/plan.json") return newPlanJson;
        if (path === ".agenthud/plan.json") return oldPlanJson;
        throw new Error("File not found");
      });

      const result = getPlanDataWithConfig(config);

      expect(result.plan?.goal).toBe("New Location");
    });

    it("returns error when neither location exists", () => {
      const config: PlanPanelConfig = {
        enabled: true,
        interval: 10000,
        source: ".agenthud/plan/plan.json",
      };

      mockFileExists.mockReturnValue(false);
      mockReadFile.mockImplementation(() => {
        throw new Error("File not found");
      });

      const result = getPlanDataWithConfig(config);

      expect(result.plan).toBeNull();
      expect(result.error).toBe("No plan found");
    });

    it("falls back decisions.json to old location", () => {
      const config: PlanPanelConfig = {
        enabled: true,
        interval: 10000,
        source: ".agenthud/plan/plan.json",
      };

      const planJson = JSON.stringify({ goal: "Test", steps: [] });
      const decisionsJson = JSON.stringify({
        decisions: [{ timestamp: "2026-01-10T10:00:00Z", decision: "From old location" }],
      });

      mockFileExists.mockImplementation((path: string) => {
        if (path === ".agenthud/plan/plan.json") return true;
        if (path === ".agenthud/plan/decisions.json") return false;
        if (path === ".agenthud/decisions.json") return true;
        return false;
      });

      mockReadFile.mockImplementation((path: string) => {
        if (path === ".agenthud/plan/plan.json") return planJson;
        if (path === ".agenthud/decisions.json") return decisionsJson;
        throw new Error("File not found");
      });

      const result = getPlanDataWithConfig(config);

      expect(result.decisions).toHaveLength(1);
      expect(result.decisions[0].decision).toBe("From old location");
    });
  });
});
