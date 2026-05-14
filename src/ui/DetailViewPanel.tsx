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

export function wrapText(text: string, maxWidth: number): string[] {
  if (!text) return ["(empty)"];
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (getDisplayWidth(`${current} ${word}`) <= maxWidth) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : ["(empty)"];
}

export interface DetailViewPanelProps {
  activity: ActivityEntry;
  sessionName: string;
  width: number;
  visibleRows: number;
  scrollOffset: number;
}

export function DetailViewPanel({
  activity,
  width,
  visibleRows,
  scrollOffset,
}: DetailViewPanelProps): React.ReactElement {
  const innerWidth = getInnerWidth(width);
  const contentWidth = innerWidth - 1;

  const allLines = wrapText(activity.detail, contentWidth);
  const totalLines = allLines.length;
  const clampedOffset = Math.min(
    scrollOffset,
    Math.max(0, totalLines - visibleRows),
  );
  const visibleSlice = allLines.slice(
    clampedOffset,
    clampedOffset + visibleRows,
  );

  const titleLabel = `${activity.icon} ${activity.label}`;
  const scrollSuffix =
    totalLines > visibleRows
      ? `[${clampedOffset + 1}-${Math.min(clampedOffset + visibleRows, totalLines)}/${totalLines}]`
      : "";

  const contentRows: React.ReactElement[] = [];
  for (let i = 0; i < visibleRows; i++) {
    const line = visibleSlice[i] ?? "";
    const padding = Math.max(0, contentWidth - getDisplayWidth(line));
    contentRows.push(
      <Text key={i}>
        {BOX.v} {line}
        {" ".repeat(padding)}
        {BOX.v}
      </Text>,
    );
  }

  return (
    <Box flexDirection="column" width={width}>
      <Text>{createTitleLine(titleLabel, scrollSuffix, width)}</Text>
      {contentRows}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
