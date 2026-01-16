import { Box, Text } from "ink";
import type React from "react";
import type { OtherSessionsData } from "../data/otherSessions.js";
import {
  BOX,
  createBottomLine,
  createTitleLine,
  DEFAULT_PANEL_WIDTH,
  getDisplayWidth,
  getInnerWidth,
} from "./constants.js";

interface OtherSessionsPanelProps {
  data: OtherSessionsData;
  countdown?: number | null;
  width?: number;
  isRunning?: boolean;
  messageMaxLength?: number;
}

function formatCountdown(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const padded = String(seconds).padStart(2, " ");
  return `↻ ${padded}s`;
}

function truncateMessage(message: string, maxLength: number): string {
  if (getDisplayWidth(message) <= maxLength) {
    return message;
  }

  let truncated = "";
  let currentWidth = 0;

  for (const char of message) {
    const charWidth = getDisplayWidth(char);
    if (currentWidth + charWidth > maxLength - 3) {
      truncated += "...";
      break;
    }
    truncated += char;
    currentWidth += charWidth;
  }

  return truncated;
}

function formatProjectNames(projectNames: string[], maxWidth: number): string {
  if (projectNames.length === 0) {
    return "No projects";
  }

  const MAX_NAMES_TO_SHOW = 3;
  const remaining = projectNames.length - MAX_NAMES_TO_SHOW;

  // Start with up to 3 names
  let namesToShow = projectNames.slice(0, MAX_NAMES_TO_SHOW);
  let suffix = remaining > 0 ? ` +${remaining}` : "";

  // Try to fit names within available width
  const availableWidth = maxWidth;

  // Build the text and truncate if needed
  let text = namesToShow.join(", ") + suffix;

  // If it fits, return as is
  if (text.length <= availableWidth) {
    return text;
  }

  // Try with fewer names
  for (let count = MAX_NAMES_TO_SHOW - 1; count >= 1; count--) {
    namesToShow = projectNames.slice(0, count);
    const newRemaining = projectNames.length - count;
    suffix = newRemaining > 0 ? ` +${newRemaining}` : "";
    text = namesToShow.join(", ") + suffix;

    if (text.length <= availableWidth) {
      return text;
    }
  }

  // If even 1 name doesn't fit, truncate it
  const firstProject = projectNames[0];
  const remainingCount = projectNames.length - 1;
  suffix = remainingCount > 0 ? ` +${remainingCount}` : "";
  const suffixLen = suffix.length;
  const maxNameLen = availableWidth - suffixLen - 3; // -3 for "..."

  if (maxNameLen > 0) {
    return `${firstProject.slice(0, maxNameLen)}...${suffix}`;
  }

  return "...";
}

export function OtherSessionsPanel({
  data,
  countdown,
  width = DEFAULT_PANEL_WIDTH,
  isRunning = false,
  messageMaxLength = 50,
}: OtherSessionsPanelProps): React.ReactElement {
  const countdownSuffix = isRunning ? "running..." : formatCountdown(countdown);
  const innerWidth = getInnerWidth(width);
  const contentWidth = innerWidth - 1; // Account for " " after │

  const { activeCount, projectNames, recentSession } = data;

  // Build header line content
  // Format: radar, backend, frontend +3 | * 2 active
  const activeSuffix = ` | * ${activeCount} active`;
  const projectsAvailableWidth = contentWidth - getDisplayWidth(activeSuffix);
  const projectsText = formatProjectNames(projectNames, projectsAvailableWidth);
  const headerText = `${projectsText}${activeSuffix}`;
  const headerPadding = Math.max(0, contentWidth - getDisplayWidth(headerText));

  // Determine colors based on counts
  const hasProjects = projectNames.length > 0;
  const hasActive = activeCount > 0;

  const lines: React.ReactElement[] = [];

  // Header line with counts (colored based on values)
  lines.push(
    <Text key="header">
      {BOX.v}{" "}
      <Text dimColor={!hasProjects} color={hasProjects ? "cyan" : undefined}>
        {projectsText}
      </Text>
      <Text dimColor={!hasActive} color={hasActive ? "yellow" : undefined}>
        {" "}| * {activeCount} active
      </Text>
      {" ".repeat(headerPadding)}
      {BOX.v}
          </Text>,
  );

  // Empty line
  lines.push(
    <Text key="empty">
      {BOX.v} {" ".repeat(contentWidth)}
      {BOX.v}
          </Text>,
  );

  // Recent session or empty state
  if (recentSession) {
    const statusIcon = recentSession.isActive ? "*" : "o";
    const sessionLine = `${statusIcon} ${recentSession.projectName} (${recentSession.relativeTime})`;
    const sessionLinePadding = Math.max(
      0,
      contentWidth - getDisplayWidth(sessionLine),
    );

    lines.push(
      <Text key="session">
        {BOX.v} <Text>{sessionLine}</Text>
        {" ".repeat(sessionLinePadding)}
        {BOX.v}
              </Text>,
    );

    // Last message (if available)
    if (recentSession.lastMessage) {
      // Calculate available width for message (accounting for indent)
      const indent = "   "; // 3 spaces for indent
      const quotePrefix = '"';
      const quoteSuffix = '"';
      const availableWidth = contentWidth - indent.length - 2; // -2 for quotes

      const truncatedMessage = truncateMessage(
        recentSession.lastMessage,
        Math.min(availableWidth, messageMaxLength),
      );
      const messageText = `${indent}${quotePrefix}${truncatedMessage}${quoteSuffix}`;
      const messagePadding = Math.max(
        0,
        contentWidth - getDisplayWidth(messageText),
      );

      lines.push(
        <Text key="message">
          {BOX.v} <Text dimColor>{messageText}</Text>
          {" ".repeat(messagePadding)}
          {BOX.v}
                  </Text>,
      );
    }
  } else {
    // No other sessions
    const noSessionText = "No other active sessions";
    const noSessionPadding = Math.max(0, contentWidth - noSessionText.length);

    lines.push(
      <Text key="no-session">
        {BOX.v} <Text dimColor>{noSessionText}</Text>
        {" ".repeat(noSessionPadding)}
        {BOX.v}
              </Text>,
    );
  }

  return (
    <Box flexDirection="column" width={width}>
      <Text>{createTitleLine("Other Sessions", countdownSuffix, width)}</Text>
      {lines}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
