import React from "react";
import { Box, Text } from "ink";
import type { OtherSessionsData } from "../data/otherSessions.js";
import {
  DEFAULT_PANEL_WIDTH,
  BOX,
  createTitleLine,
  createBottomLine,
  getInnerWidth,
  getDisplayWidth,
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

  const { totalProjects, activeCount, recentSession } = data;

  // Build header line content
  const projectWord = totalProjects === 1 ? "project" : "projects";
  const headerText = `📁 ${totalProjects} ${projectWord} | ⚡ ${activeCount} active`;
  const headerPadding = Math.max(0, contentWidth - getDisplayWidth(headerText));

  // Clear to end of line to prevent ghost text
  const clearEOL = "\x1b[K";

  const lines: React.ReactElement[] = [];

  // Header line with counts
  lines.push(
    <Text key="header">
      {BOX.v}{" "}
      <Text>{headerText}</Text>
      {" ".repeat(headerPadding)}
      {BOX.v}{clearEOL}
    </Text>
  );

  // Empty line
  lines.push(
    <Text key="empty">
      {BOX.v}{" "}
      {" ".repeat(contentWidth)}
      {BOX.v}{clearEOL}
    </Text>
  );

  // Recent session or empty state
  if (recentSession) {
    const statusIcon = recentSession.isActive ? "🔵" : "⚪";
    const sessionLine = `${statusIcon} ${recentSession.projectName} (${recentSession.relativeTime})`;
    const sessionLinePadding = Math.max(0, contentWidth - getDisplayWidth(sessionLine));

    lines.push(
      <Text key="session">
        {BOX.v}{" "}
        <Text>{sessionLine}</Text>
        {" ".repeat(sessionLinePadding)}
        {BOX.v}{clearEOL}
      </Text>
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
        Math.min(availableWidth, messageMaxLength)
      );
      const messageText = `${indent}${quotePrefix}${truncatedMessage}${quoteSuffix}`;
      const messagePadding = Math.max(0, contentWidth - getDisplayWidth(messageText));

      lines.push(
        <Text key="message">
          {BOX.v}{" "}
          <Text dimColor>{messageText}</Text>
          {" ".repeat(messagePadding)}
          {BOX.v}{clearEOL}
        </Text>
      );
    }
  } else {
    // No other sessions
    const noSessionText = "No other active sessions";
    const noSessionPadding = Math.max(0, contentWidth - noSessionText.length);

    lines.push(
      <Text key="no-session">
        {BOX.v}{" "}
        <Text dimColor>{noSessionText}</Text>
        {" ".repeat(noSessionPadding)}
        {BOX.v}{clearEOL}
      </Text>
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
