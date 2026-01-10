import React from "react";
import { Box, Text } from "ink";
import type { Plan, Decision } from "../types/index.js";
import { PANEL_WIDTH, CONTENT_WIDTH, truncate } from "./constants.js";

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

// Create decisions header: "── Decisions ────────────────────────────────────"
function createDecisionsHeader(): string {
  const label = "── Decisions ";
  const remaining = CONTENT_WIDTH - label.length;
  return label + "─".repeat(remaining);
}

export function PlanPanel({ plan, decisions, error }: PlanPanelProps): React.ReactElement {
  // Error state
  if (error || !plan) {
    return (
      <Box flexDirection="column" borderStyle="single" paddingX={1} width={PANEL_WIDTH}>
        <Box marginTop={-1}>
          <Text> Plan </Text>
        </Box>
        <Text dimColor>{error || "No plan found"}</Text>
      </Box>
    );
  }

  const doneCount = plan.steps.filter((s) => s.status === "done").length;
  const totalCount = plan.steps.length;
  const stepWord = totalCount === 1 ? "step" : "steps";

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={PANEL_WIDTH}>
      {/* Header */}
      <Box marginTop={-1}>
        <Text> Plan </Text>
      </Box>

      {/* Goal */}
      <Text>{truncate(plan.goal, CONTENT_WIDTH)}</Text>

      {/* Steps */}
      {plan.steps.map((step, index) => (
        <Text key={index}>
          <StatusIcon status={step.status} /> {truncate(step.step, MAX_STEP_LENGTH)}
        </Text>
      ))}

      {/* Progress bar */}
      <Text>
        <Text color="green">{createProgressBar(doneCount, totalCount)}</Text>
        <Text dimColor> {doneCount}/{totalCount}</Text>
      </Text>

      {/* Decisions section (only if there are decisions) */}
      {decisions.length > 0 && (
        <>
          <Text dimColor>{createDecisionsHeader()}</Text>
          {decisions.map((decision, index) => (
            <Text key={index} dimColor>
              • {truncate(decision.decision, MAX_DECISION_LENGTH)}
            </Text>
          ))}
        </>
      )}
    </Box>
  );
}
