import { Box, Text } from "ink";
import type React from "react";
import type { ActivityEntry } from "../types/index.js";
import { getActivityStyle } from "./ActivityViewerPanel.js";
import {
  BOX,
  createBottomLine,
  getDisplayWidth,
  getInnerWidth,
} from "./constants.js";
import {
  classifyCodeFences,
  classifyDiffLines,
  getLineStyle,
  type LineCategory,
} from "./lineColoring.js";

export function wrapText(text: string, maxWidth: number): string[] {
  if (!text) return ["(empty)"];
  const result: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (!rawLine) {
      result.push("");
      continue;
    }
    const words = rawLine.split(" ");
    let current = "";
    for (const word of words) {
      if (!current) {
        current = word;
      } else if (getDisplayWidth(`${current} ${word}`) <= maxWidth) {
        current += ` ${word}`;
      } else {
        result.push(current);
        current = word;
      }
    }
    if (current) result.push(current);
  }
  return result.length > 0 ? result : ["(empty)"];
}

/**
 * Wrap each source line and propagate its line category to every wrapped
 * piece. Classification happens on raw source lines (before wrapping) so
 * fence/diff heuristics see the original prefixes intact.
 */
// Hard-wrap a line into chunks no wider than maxWidth display columns,
// preserving every character (including leading/internal whitespace). Used for
// code and diff bodies where indentation is meaningful.
function hardWrapByWidth(line: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [line];
  const out: string[] = [];
  let cur = "";
  let curW = 0;
  for (const ch of line) {
    const w = getDisplayWidth(ch);
    if (curW + w > maxWidth && cur !== "") {
      out.push(cur);
      cur = ch;
      curW = w;
    } else {
      cur += ch;
      curW += w;
    }
  }
  if (cur !== "") out.push(cur);
  return out.length > 0 ? out : [line];
}

export function wrapClassified(
  text: string,
  maxWidth: number,
  classifier: (lines: string[]) => LineCategory[],
  preserveWhitespace = false,
): Array<{ text: string; category: LineCategory }> {
  if (!text) return [{ text: "(empty)", category: "prose" }];
  const sourceLines = text.split("\n");
  const categories = classifier(sourceLines);
  const out: Array<{ text: string; category: LineCategory }> = [];
  for (let i = 0; i < sourceLines.length; i++) {
    const line = sourceLines[i];
    const cat = categories[i] ?? "prose";
    if (!line) {
      out.push({ text: "", category: cat });
      continue;
    }
    if (preserveWhitespace) {
      for (const chunk of hardWrapByWidth(line, maxWidth)) {
        out.push({ text: chunk, category: cat });
      }
      continue;
    }
    const words = line.split(" ");
    let current = "";
    for (const word of words) {
      if (!current) {
        current = word;
      } else if (getDisplayWidth(`${current} ${word}`) <= maxWidth) {
        current += ` ${word}`;
      } else {
        out.push({ text: current, category: cat });
        current = word;
      }
    }
    if (current) out.push({ text: current, category: cat });
  }
  return out.length > 0 ? out : [{ text: "(empty)", category: "prose" }];
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

  const body = activity.detailBody ?? activity.detail;
  const classifier =
    activity.detailKind === "diff"
      ? classifyDiffLines
      : activity.detailKind === "code"
        ? classifyCodeFences
        : activity.type === "commit"
          ? classifyDiffLines
          : classifyCodeFences;
  const preserveWhitespace =
    activity.detailKind === "diff" ||
    activity.detailKind === "code" ||
    activity.type === "commit";
  const allLines = wrapClassified(
    body,
    contentWidth,
    classifier,
    preserveWhitespace,
  );
  const totalLines = allLines.length;
  const clampedOffset = Math.min(
    scrollOffset,
    Math.max(0, totalLines - visibleRows),
  );
  const visibleSlice = allLines.slice(
    clampedOffset,
    clampedOffset + visibleRows,
  );

  const style = getActivityStyle(activity);
  const scrollSuffix =
    totalLines > visibleRows
      ? `[${clampedOffset + 1}-${Math.min(clampedOffset + visibleRows, totalLines)}/${totalLines}]`
      : "";

  const iconWidth = getDisplayWidth(activity.icon);
  const labelWidth = activity.label.length;
  const scrollPart = scrollSuffix ? ` ${scrollSuffix} ${BOX.h}` : "";
  const scrollPartWidth = scrollSuffix ? getDisplayWidth(scrollPart) : 0;
  const dashCount = Math.max(
    0,
    width - 3 - iconWidth - 1 - labelWidth - 1 - scrollPartWidth - 1,
  );
  const dashes = BOX.h.repeat(dashCount);
  const titleRight = `${dashes}${scrollPart}${BOX.tr}`;

  const contentRows: React.ReactElement[] = [];
  for (let i = 0; i < visibleRows; i++) {
    const entry = visibleSlice[i] ?? { text: "", category: "prose" as const };
    const padding = Math.max(0, contentWidth - getDisplayWidth(entry.text));
    const lineStyle = getLineStyle(entry.category);
    contentRows.push(
      <Text key={i}>
        {BOX.v}{" "}
        <Text color={lineStyle.color} dimColor={lineStyle.dimColor}>
          {entry.text}
        </Text>
        {" ".repeat(padding)}
        {BOX.v}
      </Text>,
    );
  }

  return (
    <Box flexDirection="column" width={width}>
      <Text>
        {BOX.tl}
        {BOX.h} <Text color="cyan">{activity.icon}</Text>{" "}
        <Text color={style.color} dimColor={style.dimColor}>
          {activity.label}
        </Text>{" "}
        {titleRight}
      </Text>
      {contentRows}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
