import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { PlanPanel } from "../src/ui/PlanPanel.js";
import type { Plan, Decision } from "../src/types/index.js";

describe("PlanPanel", () => {
  const mockPlan: Plan = {
    goal: "Build agenthud CLI tool",
    steps: [
      { step: "Set up project", status: "done" },
      { step: "Add git module", status: "done" },
      { step: "Create UI", status: "in-progress" },
      { step: "Deploy", status: "pending" },
    ],
  };

  const mockDecisions: Decision[] = [
    { timestamp: "2026-01-09T10:00:00Z", decision: "Use TypeScript for type safety" },
    { timestamp: "2026-01-09T09:00:00Z", decision: "Use Ink for terminal UI" },
  ];

  describe("plan section", () => {
    it("shows the goal", () => {
      const { lastFrame } = render(
        <PlanPanel plan={mockPlan} decisions={[]} />
      );

      expect(lastFrame()).toContain("Build agenthud CLI tool");
    });

    it("shows done steps with checkmark", () => {
      const { lastFrame } = render(
        <PlanPanel plan={mockPlan} decisions={[]} />
      );

      expect(lastFrame()).toContain("✓");
      expect(lastFrame()).toContain("Set up project");
    });

    it("shows in-progress steps with arrow", () => {
      const { lastFrame } = render(
        <PlanPanel plan={mockPlan} decisions={[]} />
      );

      expect(lastFrame()).toContain("→");
      expect(lastFrame()).toContain("Create UI");
    });

    it("shows pending steps with circle", () => {
      const { lastFrame } = render(
        <PlanPanel plan={mockPlan} decisions={[]} />
      );

      expect(lastFrame()).toContain("○");
      expect(lastFrame()).toContain("Deploy");
    });

    it("shows progress count", () => {
      const { lastFrame } = render(
        <PlanPanel plan={mockPlan} decisions={[]} />
      );

      expect(lastFrame()).toContain("2/4");
    });

    it("shows progress bar with filled and empty blocks", () => {
      const { lastFrame } = render(
        <PlanPanel plan={mockPlan} decisions={[]} />
      );

      // 2/4 = 50% = 5 filled blocks out of 10
      expect(lastFrame()).toContain("█████░░░░░");
    });
  });

  describe("decisions section", () => {
    it("shows decisions with bullet points", () => {
      const { lastFrame } = render(
        <PlanPanel plan={mockPlan} decisions={mockDecisions} />
      );

      expect(lastFrame()).toContain("•");
      expect(lastFrame()).toContain("Use TypeScript for type safety");
      expect(lastFrame()).toContain("Use Ink for terminal UI");
    });

    it("hides decisions section when no decisions", () => {
      const { lastFrame } = render(
        <PlanPanel plan={mockPlan} decisions={[]} />
      );

      expect(lastFrame()).not.toContain("Decisions");
    });

    it("does not show timestamps", () => {
      const { lastFrame } = render(
        <PlanPanel plan={mockPlan} decisions={mockDecisions} />
      );

      expect(lastFrame()).not.toContain("2026-01-09");
      expect(lastFrame()).not.toContain("10:00");
    });
  });

  describe("error states", () => {
    it("shows 'No plan found' when plan is null", () => {
      const { lastFrame } = render(
        <PlanPanel plan={null} decisions={[]} error="No plan found" />
      );

      expect(lastFrame()).toContain("No plan found");
    });

    it("shows error message for invalid JSON", () => {
      const { lastFrame } = render(
        <PlanPanel plan={null} decisions={[]} error="Invalid plan.json" />
      );

      expect(lastFrame()).toContain("Invalid plan.json");
    });
  });

  describe("edge cases", () => {
    it("handles plan with no steps", () => {
      const emptyPlan: Plan = { goal: "Empty plan", steps: [] };

      const { lastFrame } = render(
        <PlanPanel plan={emptyPlan} decisions={[]} />
      );

      expect(lastFrame()).toContain("Empty plan");
      expect(lastFrame()).toContain("0/0");
      // Empty progress bar
      expect(lastFrame()).toContain("░░░░░░░░░░");
    });

    it("handles all steps done", () => {
      const allDonePlan: Plan = {
        goal: "Complete",
        steps: [
          { step: "Step 1", status: "done" },
          { step: "Step 2", status: "done" },
        ],
      };

      const { lastFrame } = render(
        <PlanPanel plan={allDonePlan} decisions={[]} />
      );

      expect(lastFrame()).toContain("2/2");
      // Full progress bar
      expect(lastFrame()).toContain("██████████");
    });
  });
});
