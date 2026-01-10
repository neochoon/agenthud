import React from "react";
import { Box, Text } from "ink";
import type { Plan, Decision } from "../types/index.js";
import { DEFAULT_PANEL_WIDTH, BOX, createBottomLine, padLine, truncate, getContentWidth, getInnerWidth } from "./constants.js";

interface PlanPanelProps {
  plan: Plan | null;
  decisions: Decision[];
  error?: string;
  countdown?: number | null;
  width?: number;
  justRefreshed?: boolean;
  relativeTime?: string;
}

const PROGRESS_BAR_WIDTH = 10;

function createProgressBar(done: number, total: number): string {
  if (total === 0) return "░".repeat(PROGRESS_BAR_WIDTH);
  const filled = Math.round((done / total) * PROGRESS_BAR_WIDTH);
  const empty = PROGRESS_BAR_WIDTH - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function formatCountdown(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const padded = String(seconds).padStart(2, " ");
  return `↻ ${padded}s`;
}

// Create title line: "┌─ Plan ─────────── 7/10 ███████░░░ · ↻ 8s ─┐"
function createPlanTitleLine(done: number, total: number, countdown: number | null | undefined, panelWidth: number, suffixOverride?: string): string {
  const label = " Plan ";
  const count = ` ${done}/${total} `;
  const bar = createProgressBar(done, total);
  // Use suffixOverride if provided, otherwise use countdown
  const suffixStr = suffixOverride || formatCountdown(countdown);
  const suffix = suffixStr ? ` · ${suffixStr} ` + BOX.h : "";

  // Total = ┌(1) + ─(1) + label + dashes + count + bar + suffix + ┐(1) = panelWidth
  const dashCount = panelWidth - 3 - label.length - count.length - bar.length - suffix.length;
  const dashes = BOX.h.repeat(Math.max(0, dashCount));
  return BOX.tl + BOX.h + label + dashes + count + bar + suffix + BOX.tr;
}

// Create simple title line without progress (for error state)
function createSimpleTitleLine(countdown: number | null | undefined, panelWidth: number): string {
  const label = " Plan ";
  const countdownStr = formatCountdown(countdown);
  const suffix = countdownStr ? ` ${countdownStr} ` + BOX.h : "";
  const dashCount = panelWidth - 3 - label.length - suffix.length;
  const dashes = BOX.h.repeat(Math.max(0, dashCount));
  return BOX.tl + BOX.h + label + dashes + suffix + BOX.tr;
}

// Create decisions header: "├─ Decisions ────────────────────────────────────┤"
function createDecisionsHeader(panelWidth: number): string {
  const label = "─ Decisions ";
  // ├(1) + label + dashes + ┤(1) = panelWidth
  const dashCount = panelWidth - 1 - label.length - 1;
  return label + "─".repeat(dashCount) + "┤";
}

export function PlanPanel({ plan, decisions, error, countdown, width = DEFAULT_PANEL_WIDTH, justRefreshed = false, relativeTime }: PlanPanelProps): React.ReactElement {
  const contentWidth = getContentWidth(width);
  const maxStepLength = contentWidth - 2; // "✓ " = 2 chars
  const maxDecisionLength = contentWidth - 2; // "• " = 2 chars

  // Error state - also handle empty plan object
  if (error || !plan || !plan.goal || !plan.steps) {
    return (
      <Box flexDirection="column" width={width}>
        <Text>{createSimpleTitleLine(countdown, width)}</Text>
        <Text>{BOX.v}{padLine(" " + (error || "No plan found"), width)}{BOX.v}</Text>
        <Text>{createBottomLine(width)}</Text>
      </Box>
    );
  }

  const doneCount = plan.steps.filter((s) => s.status === "done").length;
  const totalCount = plan.steps.length;

  // Determine suffix: "just now" when justRefreshed, relativeTime if provided, otherwise countdown
  const titleSuffix = justRefreshed ? "just now" : relativeTime || undefined;

  return (
    <Box flexDirection="column" width={width}>
      {/* Title line with progress bar and countdown */}
      <Text>{createPlanTitleLine(doneCount, totalCount, countdown, width, titleSuffix)}</Text>

      {/* Goal */}
      <Text>{BOX.v}{padLine(" " + truncate(plan.goal, contentWidth), width)}{BOX.v}</Text>

      {/* Steps */}
      {plan.steps.map((step, index) => {
        const stepText = " " + (step.status === "done" ? "✓" : step.status === "in-progress" ? "→" : "○") + " " + truncate(step.step, maxStepLength);
        return (
          <Text key={index}>{BOX.v}{padLine(stepText, width)}{BOX.v}</Text>
        );
      })}

      {/* Decisions section (only if there are decisions) */}
      {decisions.length > 0 && (
        <>
          <Text>├<Text dimColor>{createDecisionsHeader(width)}</Text></Text>
          {decisions.map((decision, index) => {
            const decText = " • " + truncate(decision.decision, maxDecisionLength);
            return (
              <Text key={index}>{BOX.v}<Text dimColor>{padLine(decText, width)}</Text>{BOX.v}</Text>
            );
          })}
        </>
      )}

      {/* Bottom line */}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
