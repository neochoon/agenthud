import React from "react";
import { Box, Text } from "ink";
import type { Plan, Decision } from "../types/index.js";
import { PANEL_WIDTH, SEPARATOR } from "./constants.js";

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
      <Text>{plan.goal}</Text>

      {/* Separator */}
      <Box marginY={0}>
        <Text dimColor>{SEPARATOR}</Text>
      </Box>

      {/* Steps */}
      {plan.steps.map((step, index) => (
        <Text key={index}>
          <StatusIcon status={step.status} /> {step.step}
        </Text>
      ))}

      {/* Progress */}
      <Box marginY={0}>
        <Text dimColor>{SEPARATOR}</Text>
      </Box>
      <Text dimColor>
        {doneCount}/{totalCount} {stepWord} done
      </Text>

      {/* Decisions section (only if there are decisions) */}
      {decisions.length > 0 && (
        <>
          <Box marginY={0}>
            <Text dimColor>─ Decisions {SEPARATOR.slice(12)}</Text>
          </Box>
          {decisions.map((decision, index) => (
            <Text key={index} dimColor>
              • {decision.decision}
            </Text>
          ))}
        </>
      )}
    </Box>
  );
}
