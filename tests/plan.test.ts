import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getPlanData, setReadFileFn, resetReadFileFn } from "../src/data/plan.js";

describe("plan data module", () => {
  let mockReadFile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockReadFile = vi.fn();
    setReadFileFn(mockReadFile);
  });

  afterEach(() => {
    resetReadFileFn();
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
});
