import React from "react";
import { Box, Text } from "ink";
import type { Plan, Decision } from "../types/index.js";
import { PANEL_WIDTH, CONTENT_WIDTH, INNER_WIDTH, BOX, createBottomLine, padLine, truncate } from "./constants.js";

interface PlanPanelProps {
  plan: Plan | null;
  decisions: Decision[];
  error?: string;
  countdown?: number | null;
}

const PROGRESS_BAR_WIDTH = 10;
// "✓ " = 2 chars, rest for step text
const MAX_STEP_LENGTH = CONTENT_WIDTH - 2;
// "• " = 2 chars, rest for decision text
const MAX_DECISION_LENGTH = CONTENT_WIDTH - 2;

function createProgressBar(done: number, total: number): string {
  if (total === 0) return "░".repeat(PROGRESS_BAR_WIDTH);
  const filled = Math.round((done / total) * PROGRESS_BAR_WIDTH);
  const empty = PROGRESS_BAR_WIDTH - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function formatCountdown(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  return `↻ ${seconds}s`;
}

// Create title line: "┌─ Plan ─────────── 7/10 ███████░░░ · ↻ 8s ─┐"
function createPlanTitleLine(done: number, total: number, countdown?: number | null): string {
  const label = " Plan ";
  const count = ` ${done}/${total} `;
  const bar = createProgressBar(done, total);
  const countdownStr = formatCountdown(countdown);
  const suffix = countdownStr ? ` · ${countdownStr} ` + BOX.h : "";

  // Total = ┌(1) + ─(1) + label + dashes + count + bar + suffix + ┐(1) = PANEL_WIDTH
  const dashCount = PANEL_WIDTH - 3 - label.length - count.length - bar.length - suffix.length;
  const dashes = BOX.h.repeat(Math.max(0, dashCount));
  return BOX.tl + BOX.h + label + dashes + count + bar + suffix + BOX.tr;
}

// Create simple title line without progress (for error state)
function createSimpleTitleLine(countdown?: number | null): string {
  const label = " Plan ";
  const countdownStr = formatCountdown(countdown);
  const suffix = countdownStr ? ` ${countdownStr} ` + BOX.h : "";
  const dashCount = PANEL_WIDTH - 3 - label.length - suffix.length;
  const dashes = BOX.h.repeat(Math.max(0, dashCount));
  return BOX.tl + BOX.h + label + dashes + suffix + BOX.tr;
}

// Create decisions header: "├─ Decisions ────────────────────────────────────┤"
function createDecisionsHeader(): string {
  const label = "─ Decisions ";
  // ├(1) + label + dashes + ┤(1) = PANEL_WIDTH
  const dashCount = PANEL_WIDTH - 1 - label.length - 1;
  return label + "─".repeat(dashCount) + "┤";
}

export function PlanPanel({ plan, decisions, error, countdown }: PlanPanelProps): React.ReactElement {
  // Error state - also handle empty plan object
  if (error || !plan || !plan.goal || !plan.steps) {
    return (
      <Box flexDirection="column" width={PANEL_WIDTH}>
        <Text>{createSimpleTitleLine(countdown)}</Text>
        <Text>{BOX.v}{padLine(" " + (error || "No plan found"))}{BOX.v}</Text>
        <Text>{createBottomLine()}</Text>
      </Box>
    );
  }

  const doneCount = plan.steps.filter((s) => s.status === "done").length;
  const totalCount = plan.steps.length;

  return (
    <Box flexDirection="column" width={PANEL_WIDTH}>
      {/* Title line with progress bar and countdown */}
      <Text>{createPlanTitleLine(doneCount, totalCount, countdown)}</Text>

      {/* Goal */}
      <Text>{BOX.v}{padLine(" " + truncate(plan.goal, CONTENT_WIDTH))}{BOX.v}</Text>

      {/* Steps */}
      {plan.steps.map((step, index) => {
        const stepText = " " + (step.status === "done" ? "✓" : step.status === "in-progress" ? "→" : "○") + " " + truncate(step.step, MAX_STEP_LENGTH);
        return (
          <Text key={index}>{BOX.v}{padLine(stepText)}{BOX.v}</Text>
        );
      })}

      {/* Decisions section (only if there are decisions) */}
      {decisions.length > 0 && (
        <>
          <Text>├<Text dimColor>{createDecisionsHeader()}</Text></Text>
          {decisions.map((decision, index) => {
            const decText = " • " + truncate(decision.decision, MAX_DECISION_LENGTH);
            return (
              <Text key={index}>{BOX.v}<Text dimColor>{padLine(decText)}</Text>{BOX.v}</Text>
            );
          })}
        </>
      )}

      {/* Bottom line */}
      <Text>{createBottomLine()}</Text>
    </Box>
  );
}
