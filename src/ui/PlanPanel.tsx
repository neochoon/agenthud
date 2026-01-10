import React from "react";
import { Box, Text } from "ink";
import type { Plan, Decision } from "../types/index.js";
import { PANEL_WIDTH, CONTENT_WIDTH, truncate } from "./constants.js";

// Border characters
const BOX = { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" };

interface PlanPanelProps {
  plan: Plan | null;
  decisions: Decision[];
  error?: string;
}

function StatusIcon({ status }: { status: string }): React.ReactElement {
  switch (status) {
    case "done":
      return <Text color="green">✓</Text>;
    case "in-progress":
      return <Text color="yellow">→</Text>;
    default:
      return <Text dimColor>○</Text>;
  }
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

// Inner width = PANEL_WIDTH - 2 (for left and right borders)
const INNER_WIDTH = PANEL_WIDTH - 2;

// Create title line: "┌─ Plan ──────────────────── 7/10 ███████░░░┐"
function createTitleLine(done: number, total: number): string {
  const label = " Plan ";
  const count = ` ${done}/${total} `;
  const bar = createProgressBar(done, total);
  // Total = ┌(1) + ─(1) + label + dashes + count + bar + ┐(1) = PANEL_WIDTH
  // dashes = PANEL_WIDTH - 3 - label - count - bar
  const dashCount = PANEL_WIDTH - 3 - label.length - count.length - bar.length;
  const dashes = BOX.h.repeat(Math.max(0, dashCount));
  return BOX.tl + BOX.h + label + dashes + count + bar + BOX.tr;
}

// Create bottom line
function createBottomLine(): string {
  return BOX.bl + BOX.h.repeat(INNER_WIDTH) + BOX.br;
}

// Pad content to fit inner width (content goes between │ and │)
function padLine(content: string): string {
  const padding = INNER_WIDTH - content.length;
  return content + " ".repeat(Math.max(0, padding));
}

// Create decisions header: "├─ Decisions ────────────────────────────────────┤"
function createDecisionsHeader(): string {
  const label = "─ Decisions ";
  // ├(1) + label + dashes + ┤(1) = PANEL_WIDTH
  const dashCount = PANEL_WIDTH - 1 - label.length - 1;
  return label + "─".repeat(dashCount) + "┤";
}

export function PlanPanel({ plan, decisions, error }: PlanPanelProps): React.ReactElement {
  // Error state - also handle empty plan object
  if (error || !plan || !plan.goal || !plan.steps) {
    return (
      <Box flexDirection="column" width={PANEL_WIDTH}>
        <Text>{BOX.tl}{BOX.h} Plan {BOX.h.repeat(INNER_WIDTH - 7)}{BOX.tr}</Text>
        <Text>{BOX.v}{padLine(" " + (error || "No plan found"))}{BOX.v}</Text>
        <Text>{createBottomLine()}</Text>
      </Box>
    );
  }

  const doneCount = plan.steps.filter((s) => s.status === "done").length;
  const totalCount = plan.steps.length;

  return (
    <Box flexDirection="column" width={PANEL_WIDTH}>
      {/* Title line with progress bar */}
      <Text>{createTitleLine(doneCount, totalCount)}</Text>

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
