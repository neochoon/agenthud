import React from "react";
import { Box, Text } from "ink";
import type { ClaudeData, ClaudeSessionStatus, ActivityEntry } from "../types/index.js";
import {
  DEFAULT_PANEL_WIDTH,
  BOX,
  createTitleLine,
  createBottomLine,
  getInnerWidth,
  getDisplayWidth,
} from "./constants.js";

export interface ActivityStyle {
  color?: string;
  dimColor: boolean;
}

export function getActivityStyle(activity: ActivityEntry): ActivityStyle {
  // User input - bright white
  if (activity.type === "user") {
    return { color: "white", dimColor: false };
  }

  // Claude's response - green
  if (activity.type === "response") {
    return { color: "green", dimColor: false };
  }

  // Tool types
  if (activity.type === "tool") {
    // Bash commands - gray (secondary but visible)
    if (activity.label === "Bash") {
      return { color: "gray", dimColor: false };
    }

    // All other tools (Edit, Read, Write, Grep, Glob, TodoWrite, etc.) - dim
    return { dimColor: true };
  }

  // Default fallback - dim
  return { dimColor: true };
}

interface ClaudePanelProps {
  data: ClaudeData;
  countdown?: number | null;
  width?: number;
  isRunning?: boolean;
  justRefreshed?: boolean;
}

function formatCountdown(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const padded = String(seconds).padStart(2, " ");
  return `↻ ${padded}s`;
}

function getStatusIcon(status: ClaudeSessionStatus): string {
  switch (status) {
    case "running":
      return "🔄";
    case "completed":
      return "✅";
    case "idle":
      return "⏳";
    case "none":
    default:
      return "";
  }
}

function formatActivityTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

interface ActivityParts {
  timestamp: string;  // "[HH:MM:SS] "
  icon: string;       // ">" or "$" etc.
  labelContent: string; // "label: detail" or "label"
  displayWidth: number;
}

function formatActivityParts(activity: ActivityEntry, maxWidth: number): ActivityParts {
  const time = formatActivityTime(activity.timestamp);
  const icon = activity.icon;
  const label = activity.label;
  const detail = activity.detail;

  // Fixed parts: "[HH:MM:SS] " = 12 chars, icon = varies, " " = 1, label, ": " = 2
  const timestamp = `[${time}] `;
  const timestampWidth = timestamp.length; // 12
  const iconWidth = getDisplayWidth(icon); // Use actual icon width
  const labelWidth = label.length;
  const separatorWidth = detail ? 2 : 0; // ": " if there's detail

  const contentPrefixWidth = iconWidth + 1 + labelWidth + separatorWidth;
  const totalPrefixWidth = timestampWidth + contentPrefixWidth;

  if (detail) {
    const availableWidth = maxWidth - totalPrefixWidth;
    let truncatedDetail = detail;
    let detailDisplayWidth = getDisplayWidth(detail);

    // Truncate if needed, accounting for wide characters
    if (detailDisplayWidth > availableWidth) {
      truncatedDetail = "";
      let currentWidth = 0;
      for (const char of detail) {
        const charWidth = getDisplayWidth(char);
        if (currentWidth + charWidth > availableWidth - 3) {
          truncatedDetail += "...";
          currentWidth += 3;
          break;
        }
        truncatedDetail += char;
        currentWidth += charWidth;
      }
      detailDisplayWidth = currentWidth;
    }

    const labelContent = `${label}: ${truncatedDetail}`;
    const displayWidth = totalPrefixWidth + detailDisplayWidth;
    return { timestamp, icon, labelContent, displayWidth };
  }

  const labelContent = label;
  const displayWidth = totalPrefixWidth;
  return { timestamp, icon, labelContent, displayWidth };
}

export function ClaudePanel({
  data,
  countdown,
  width = DEFAULT_PANEL_WIDTH,
  isRunning = false,
  justRefreshed = false,
}: ClaudePanelProps): React.ReactElement {
  const countdownSuffix = isRunning ? "running..." : formatCountdown(countdown);
  const innerWidth = getInnerWidth(width);
  const contentWidth = innerWidth - 1; // Account for " " after │ (│ is counted in innerWidth)

  const { state } = data;
  const statusIcon = getStatusIcon(state.status);

  // Build title suffix (countdown only, like other panels)
  const titleSuffix = countdownSuffix;

  // Error state
  if (data.error) {
    const errorPadding = Math.max(0, contentWidth - data.error.length);
    return (
      <Box flexDirection="column" width={width}>
        <Text>{createTitleLine("Claude", titleSuffix, width)}</Text>
        <Text>
          {BOX.v}{" "}
          <Text color="red">{data.error}</Text>
          {" ".repeat(errorPadding)}
          {BOX.v}
        </Text>
        <Text>{createBottomLine(width)}</Text>
      </Box>
    );
  }

  // No Claude session (never used Claude in this project)
  if (!data.hasSession) {
    const noSessionText = "No Claude session";
    const noSessionPadding = Math.max(0, contentWidth - noSessionText.length);
    return (
      <Box flexDirection="column" width={width}>
        <Text>{createTitleLine("Claude", countdownSuffix, width)}</Text>
        <Text>
          {BOX.v}{" "}
          <Text dimColor>{noSessionText}</Text>
          {" ".repeat(noSessionPadding)}
          {BOX.v}
        </Text>
        <Text>{createBottomLine(width)}</Text>
      </Box>
    );
  }

  // No active session (session exists but inactive for 5+ minutes)
  if (state.status === "none" || state.activities.length === 0) {
    const noActiveText = "No active session";
    const noActivePadding = Math.max(0, contentWidth - noActiveText.length);
    return (
      <Box flexDirection="column" width={width}>
        <Text>{createTitleLine("Claude", countdownSuffix, width)}</Text>
        <Text>
          {BOX.v}{" "}
          <Text dimColor>{noActiveText}</Text>
          {" ".repeat(noActivePadding)}
          {BOX.v}
        </Text>
        <Text>{createBottomLine(width)}</Text>
      </Box>
    );
  }

  // Active session - build activity log lines
  const lines: React.ReactElement[] = [];

  for (let i = 0; i < state.activities.length; i++) {
    const activity = state.activities[i];
    const { timestamp, icon, labelContent, displayWidth } = formatActivityParts(activity, contentWidth);
    const padding = Math.max(0, contentWidth - displayWidth);
    const style = getActivityStyle(activity);

    // Clear to end of line to prevent ghost text from terminal width mismatch
    const clearEOL = "\x1b[K";

    lines.push(
      <Text key={`activity-${i}`}>
        {BOX.v}{" "}
        <Text dimColor>{timestamp}</Text>
        <Text color="cyan">{icon}</Text>
        {" "}
        <Text color={style.color} dimColor={style.dimColor}>{labelContent}</Text>
        {" ".repeat(padding)}
        {BOX.v}{clearEOL}
      </Text>
    );
  }

  // Add token count if available
  if (state.tokenCount > 0) {
    const tokenText = `${state.tokenCount.toLocaleString()} tokens`;
    const tokenPadding = Math.max(0, contentWidth - tokenText.length);
    lines.push(
      <Text key="tokens">
        {BOX.v}{" "}
        <Text dimColor>{tokenText}</Text>
        {" ".repeat(tokenPadding)}
        {BOX.v}
      </Text>
    );
  }

  return (
    <Box flexDirection="column" width={width}>
      <Text>{createTitleLine("Claude", titleSuffix, width)}</Text>
      {lines}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
