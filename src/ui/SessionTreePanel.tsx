import { Box, Text } from "ink";
import type React from "react";
import type { SessionNode, SessionStatus } from "../types/index.js";
import {
  BOX,
  createBottomLine,
  createTitleLine,
  DEFAULT_PANEL_WIDTH,
  getDisplayWidth,
  getInnerWidth,
} from "./constants.js";

interface SessionTreePanelProps {
  sessions: SessionNode[];
  selectedId: string | null;
  hasFocus: boolean;
  width?: number;
}

function formatElapsed(lastModifiedMs: number): string {
  const elapsed = Date.now() - lastModifiedMs;
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  if (seconds > 0) return `${seconds}s`;
  return "<1s";
}

function getStatusColor(status: SessionStatus): string {
  switch (status) {
    case "running":
      return "green";
    case "idle":
      return "yellow";
    case "done":
      return "gray";
    default:
      return "white";
  }
}

interface SessionRowProps {
  session: SessionNode;
  isSelected: boolean;
  hasFocus: boolean;
  prefix: string;
  contentWidth: number;
}

function SessionRow({
  session,
  isSelected,
  hasFocus,
  prefix,
  contentWidth,
}: SessionRowProps): React.ReactElement {
  const statusColor = getStatusColor(session.status);
  const badge = `[${session.status}]`;
  const elapsed = formatElapsed(session.lastModifiedMs);
  const name = session.projectName || session.id.slice(0, 8);
  const model = session.modelName ?? "";

  // Build right side: elapsed + model (if any)
  const rightParts: string[] = [elapsed];
  if (model) rightParts.push(model);
  const rightSide = rightParts.join(" ");

  // Build left side: prefix + name + badge
  const leftSide = `${prefix}${name} ${badge}`;

  // Compute spacing
  const leftWidth = getDisplayWidth(leftSide);
  const rightWidth = getDisplayWidth(rightSide);
  const gapWidth = contentWidth - leftWidth - rightWidth;
  const gap = " ".repeat(Math.max(1, gapWidth));

  const fullLine = leftSide + gap + rightSide;
  const linePadding = Math.max(0, contentWidth - getDisplayWidth(fullLine));

  const highlight = isSelected && hasFocus;

  return (
    <Text>
      {BOX.v}{" "}
      <Text backgroundColor={highlight ? "blue" : undefined} bold={highlight}>
        <Text>{prefix}</Text>
        <Text bold>{name}</Text>
        <Text> </Text>
        <Text color={statusColor}>{badge}</Text>
        <Text>{gap}</Text>
        <Text dimColor>{elapsed}</Text>
        {model ? <Text dimColor>{`  ${model}`}</Text> : null}
      </Text>
      {" ".repeat(linePadding)}
      {BOX.v}
    </Text>
  );
}

function flattenSessions(
  sessions: SessionNode[],
): Array<{ session: SessionNode; prefix: string; isLast: boolean }> {
  const result: Array<{
    session: SessionNode;
    prefix: string;
    isLast: boolean;
  }> = [];

  for (const session of sessions) {
    result.push({ session, prefix: "", isLast: false });

    const subAgents = session.subAgents;
    for (let i = 0; i < subAgents.length; i++) {
      const isLast = i === subAgents.length - 1;
      const treeChar = isLast ? "└─ " : "├─ ";
      result.push({
        session: subAgents[i],
        prefix: `${treeChar}» `,
        isLast,
      });
    }
  }

  return result;
}

export function SessionTreePanel({
  sessions,
  selectedId,
  hasFocus,
  width = DEFAULT_PANEL_WIDTH,
}: SessionTreePanelProps): React.ReactElement {
  const innerWidth = getInnerWidth(width);
  const contentWidth = innerWidth - 1; // account for space after │

  const titleLine = createTitleLine("Sessions", "", width);
  const bottomLine = createBottomLine(width);

  if (sessions.length === 0) {
    const emptyText = "No Claude sessions";
    const emptyPadding = Math.max(0, contentWidth - emptyText.length);
    return (
      <Box flexDirection="column" width={width}>
        <Text>{titleLine}</Text>
        <Text>
          {BOX.v} <Text dimColor>{emptyText}</Text>
          {" ".repeat(emptyPadding)}
          {BOX.v}
        </Text>
        <Text>{bottomLine}</Text>
      </Box>
    );
  }

  const flatRows = flattenSessions(sessions);

  return (
    <Box flexDirection="column" width={width}>
      <Text>{titleLine}</Text>
      {flatRows.map(({ session, prefix }, idx) => (
        <SessionRow
          key={`${session.id}-${idx}`}
          session={session}
          isSelected={session.id === selectedId}
          hasFocus={hasFocus}
          prefix={prefix}
          contentWidth={contentWidth}
        />
      ))}
      <Text>{bottomLine}</Text>
    </Box>
  );
}
