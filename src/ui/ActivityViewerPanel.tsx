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
  if (activity.type === "user") {
    return { color: "white", dimColor: false };
  }
  if (activity.type === "response") {
    return { color: "green", dimColor: false };
  }
  if (activity.type === "thinking") {
    return { color: "magenta", dimColor: true };
  }
  if (activity.type === "commit") {
    return { color: "yellow", dimColor: false };
  }
  if (activity.type === "tool") {
    if (activity.label === "Bash") {
      return { color: "gray", dimColor: false };
    }
    return { dimColor: true };
  }
  return { dimColor: true };
}

export interface ActivityViewerPanelProps {
  activities: ActivityEntry[];
  sessionName: string;
  scrollOffset: number;
  isLive: boolean;
  newCount: number;
  visibleRows: number;
  width: number;
  cursorLine: number;
  hasFocus: boolean;
  spinner?: string;
  filterLabel?: string;
}

function formatActivityTime(date: Date, now: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const time = `${hours}:${minutes}:${seconds}`;

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return time;

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day} ${time}`;
}

function flattenForOneLine(detail: string): string {
  return detail.replace(/[\r\n\t]+/g, " ").trim();
}

function truncateDetail(detail: string, maxWidth: number): string {
  const flat = flattenForOneLine(detail);
  if (getDisplayWidth(flat) <= maxWidth) return flat;
  let truncated = "";
  let width = 0;
  for (const char of flat) {
    const charWidth = getDisplayWidth(char);
    if (width + charWidth > maxWidth - 1) break;
    truncated += char;
    width += charWidth;
  }
  return `${truncated}…`;
}

export function ActivityViewerPanel({
  activities,
  sessionName,
  scrollOffset,
  isLive,
  newCount,
  visibleRows,
  width,
  cursorLine,
  hasFocus,
  spinner = "",
  filterLabel,
}: ActivityViewerPanelProps): React.ReactElement {
  const innerWidth = getInnerWidth(width);
  const contentWidth = innerWidth - 1;

  const filterSuffix =
    filterLabel && filterLabel !== "all" ? ` · ${filterLabel}` : "";
  let titleSuffix: string;
  if (isLive) {
    titleSuffix = `[LIVE ${spinner || "▼"}${filterSuffix}]`;
  } else {
    const badge = newCount > 0 ? ` +${newCount}↑` : "";
    titleSuffix = `[PAUSED ↓${scrollOffset}${badge}${filterSuffix}]`;
  }

  // Determine which slice to show, then reverse so newest is at top
  let visibleActivities: ActivityEntry[];
  if (activities.length === 0) {
    visibleActivities = [];
  } else if (isLive) {
    visibleActivities = activities.slice(-visibleRows).reverse();
  } else {
    const end = Math.max(0, activities.length - scrollOffset);
    const start = Math.max(0, end - visibleRows);
    visibleActivities = activities.slice(start, end).reverse();
  }

  const now = new Date();
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
    const effectiveCursor = Math.min(cursorLine, visibleActivities.length - 1);
    for (let i = 0; i < visibleActivities.length; i++) {
      const activity = visibleActivities[i];
      const style = getActivityStyle(activity);
      const isCursor = hasFocus && i === effectiveCursor;

      const time = formatActivityTime(activity.timestamp, now);
      const timestamp = `[${time}] `;
      const timestampWidth = timestamp.length;
      const icon = activity.icon;
      const iconWidth = getDisplayWidth(icon);
      const label = activity.label;
      const detail = activity.detail;
      const count = activity.count;

      const countSuffix = count && count > 1 ? ` (×${count})` : "";
      const countSuffixWidth = countSuffix.length;

      const prefixWidth = 2 + timestampWidth + iconWidth + 1;
      const labelPart = detail ? `${label}: ` : label;
      const labelWidth = labelPart.length;
      const _availableForDetail =
        contentWidth - prefixWidth - labelWidth - countSuffixWidth + 1;
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
          {BOX.v}{" "}
          <Text backgroundColor={isCursor ? "blue" : undefined}>
            <Text dimColor={!isCursor}>{timestamp}</Text>
            <Text color="cyan">{icon}</Text>{" "}
            <Text
              color={isCursor ? undefined : style.color}
              dimColor={!isCursor && style.dimColor}
            >
              {labelContent}
            </Text>
            {" ".repeat(padding)}
          </Text>
          {BOX.v}
        </Text>,
      );
    }
  }

  const emptyRow = `${BOX.v}${" ".repeat(contentWidth + 1)}${BOX.v}`;
  while (lines.length < visibleRows) {
    lines.push(<Text key={`pad-${lines.length}`}>{emptyRow}</Text>);
  }

  return (
    <Box flexDirection="column" width={width}>
      <Text color={isLive ? undefined : "yellow"}>
        {createTitleLine(sessionName, titleSuffix, width)}
      </Text>
      {lines}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
