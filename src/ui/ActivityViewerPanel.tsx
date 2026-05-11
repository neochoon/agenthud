import { Box, Text } from "ink";
import type React from "react";
import type { ActivityEntry } from "../types/index.js";
import {
  BOX,
  createBottomLine,
  createTitleLine,
  getDisplayWidth,
  getInnerWidth,
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

export interface ActivityViewerPanelProps {
  activities: ActivityEntry[];
  sessionName: string;
  hasFocus: boolean;
  scrollOffset: number;
  isLive: boolean;
  visibleRows: number;
  width: number;
}

function formatActivityTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function truncateDetail(detail: string, maxWidth: number): string {
  if (getDisplayWidth(detail) <= maxWidth) return detail;
  let truncated = "";
  let currentWidth = 0;
  for (const char of detail) {
    const charWidth = getDisplayWidth(char);
    if (currentWidth + charWidth > maxWidth - 3) {
      truncated += "...";
      break;
    }
    truncated += char;
    currentWidth += charWidth;
  }
  return truncated;
}

export function ActivityViewerPanel({
  activities,
  sessionName,
  hasFocus: _hasFocus,
  scrollOffset,
  isLive,
  visibleRows,
  width,
}: ActivityViewerPanelProps): React.ReactElement {
  const innerWidth = getInnerWidth(width);
  // contentWidth: space inside the box after "│ " prefix (│ + space = 2 chars, and trailing │ = 1)
  const contentWidth = innerWidth - 1;

  const liveIndicator = isLive ? "LIVE ▼" : "PAUSED";
  const titleSuffix = `[${liveIndicator}]`;

  // Determine which slice of activities to show
  let visibleActivities: ActivityEntry[];
  if (activities.length === 0) {
    visibleActivities = [];
  } else if (isLive) {
    // Show the latest visibleRows entries
    visibleActivities = activities.slice(-visibleRows);
  } else {
    // Scroll back: end index is activities.length - scrollOffset
    const endIndex = Math.max(0, activities.length - scrollOffset);
    const startIndex = Math.max(0, endIndex - visibleRows);
    visibleActivities = activities.slice(startIndex, endIndex);
  }

  // Build activity lines
  const lines: React.ReactElement[] = [];

  if (visibleActivities.length === 0) {
    const emptyText = "No activity yet";
    const emptyPadding = Math.max(0, contentWidth - emptyText.length - 1);
    lines.push(
      <Text key="empty">
        {BOX.v} <Text dimColor>{emptyText}</Text>
        {" ".repeat(emptyPadding)}
        {BOX.v}
      </Text>,
    );
  } else {
    for (let i = 0; i < visibleActivities.length; i++) {
      const activity = visibleActivities[i];
      const style = getActivityStyle(activity);

      const time = formatActivityTime(activity.timestamp);
      const timestamp = `[${time}] `;
      const timestampWidth = timestamp.length; // 12 chars: "[HH:MM:SS] "
      const icon = activity.icon;
      const iconWidth = getDisplayWidth(icon);
      const label = activity.label;
      const detail = activity.detail;
      const count = activity.count;

      const countSuffix = count && count > 1 ? ` (×${count})` : "";
      const countSuffixWidth = countSuffix.length;

      // Layout: "│ [HH:MM:SS] ICON label: detail (×N) │"
      // prefix = "│ " (2) + timestamp (12) + icon + " " (iconWidth + 1)
      const prefixWidth = 2 + timestampWidth + iconWidth + 1; // "│ " + timestamp + icon + " "
      const labelPart = detail ? `${label}: ` : label;
      const labelWidth = labelPart.length;
      const _availableForDetail =
        contentWidth - prefixWidth - labelWidth - countSuffixWidth + 1;
      // Note: contentWidth already accounts for trailing │, so adjust:
      // Full line width: 1 (│) + 1 ( ) + timestamp + icon + 1 ( ) + labelPart + detail + countSuffix + padding + 1 (│)
      // = 2 + timestampWidth + iconWidth + 1 + labelWidth + detail + suffix + 1
      // available for detail = width - 2 - timestampWidth - iconWidth - 1 - labelWidth - countSuffixWidth - 1
      const detailMaxWidth =
        width -
        2 -
        timestampWidth -
        iconWidth -
        1 -
        labelWidth -
        countSuffixWidth -
        1;

      let labelContent: string;
      let _displayWidth: number;

      if (detail) {
        const truncated = truncateDetail(detail, Math.max(0, detailMaxWidth));
        labelContent = `${labelPart}${truncated}${countSuffix}`;
        _displayWidth =
          prefixWidth -
          1 +
          labelWidth +
          getDisplayWidth(truncated) +
          countSuffixWidth;
      } else {
        labelContent = label + countSuffix;
        _displayWidth = prefixWidth - 1 + label.length + countSuffixWidth;
      }

      // Padding to fill the line up to the closing │
      // Full line: │(1) + space(1) + timestamp + icon + space(1) + labelContent + padding + │(1) = width
      // So padding = width - 1 - 1 - timestampWidth - iconWidth - 1 - labelContent_display_width - 1
      const usedWidth =
        1 +
        1 +
        timestampWidth +
        iconWidth +
        1 +
        getDisplayWidth(labelContent) +
        1;
      const padding = Math.max(0, width - usedWidth);

      lines.push(
        <Text key={`activity-${i}`}>
          {BOX.v} <Text dimColor>{timestamp}</Text>
          <Text color="cyan">{icon}</Text>{" "}
          <Text color={style.color} dimColor={style.dimColor}>
            {labelContent}
          </Text>
          {" ".repeat(padding)}
          {BOX.v}
        </Text>,
      );
    }
  }

  return (
    <Box flexDirection="column" width={width}>
      <Text>{createTitleLine(sessionName, titleSuffix, width)}</Text>
      {lines}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
