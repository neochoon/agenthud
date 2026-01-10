import React from "react";
import { Box, Text } from "ink";
import type { GenericPanelData, GenericPanelRenderer } from "../types/index.js";
import { DEFAULT_PANEL_WIDTH, BOX, createTitleLine, createBottomLine, padLine, truncate, getContentWidth, getInnerWidth } from "./constants.js";

interface GenericPanelProps {
  data: GenericPanelData;
  renderer?: GenericPanelRenderer;
  countdown?: number | null;
  relativeTime?: string;
  error?: string;
  width?: number;
  isRunning?: boolean;
  justRefreshed?: boolean;
}

const PROGRESS_BAR_WIDTH = 10;

function createProgressBar(done: number, total: number): string {
  if (total === 0) return "░".repeat(PROGRESS_BAR_WIDTH);
  const filled = Math.round((done / total) * PROGRESS_BAR_WIDTH);
  const empty = PROGRESS_BAR_WIDTH - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function formatTitleSuffix(countdown?: number | null, relativeTime?: string): string {
  if (countdown != null) {
    const padded = String(countdown).padStart(2, " ");
    return `↻ ${padded}s`;
  }
  if (relativeTime) return relativeTime;
  return "";
}

// Create progress title line: "┌─ Title ─────────── 7/10 ███████░░░ · ↻ 8s ─┐"
function createProgressTitleLine(
  title: string,
  done: number,
  total: number,
  panelWidth: number,
  countdown?: number | null,
  relativeTime?: string
): string {
  const label = ` ${title} `;
  const count = ` ${done}/${total} `;
  const bar = createProgressBar(done, total);
  const suffix = formatTitleSuffix(countdown, relativeTime);
  const suffixPart = suffix ? ` · ${suffix} ` + BOX.h : "";

  const dashCount = panelWidth - 3 - label.length - count.length - bar.length - suffixPart.length;
  const dashes = BOX.h.repeat(Math.max(0, dashCount));
  return BOX.tl + BOX.h + label + dashes + count + bar + suffixPart + BOX.tr;
}

function ListRenderer({ data, width }: { data: GenericPanelData; width: number }): React.ReactElement {
  const items = data.items || [];
  const contentWidth = getContentWidth(width);

  if (items.length === 0 && !data.summary) {
    return <Text>{BOX.v}<Text dimColor>{padLine(" No data", width)}</Text>{BOX.v}</Text>;
  }

  return (
    <>
      {data.summary && (
        <Text>{BOX.v}{padLine(" " + truncate(data.summary, contentWidth), width)}{BOX.v}</Text>
      )}
      {items.map((item, index) => (
        <Text key={`list-item-${index}`}>{BOX.v}{padLine(" • " + truncate(item.text, contentWidth - 3), width)}{BOX.v}</Text>
      ))}
      {items.length === 0 && data.summary && null}
    </>
  );
}

function ProgressRenderer({ data, width }: { data: GenericPanelData; width: number }): React.ReactElement {
  const items = data.items || [];
  const contentWidth = getContentWidth(width);

  return (
    <>
      {data.summary && (
        <Text>{BOX.v}{padLine(" " + truncate(data.summary, contentWidth), width)}{BOX.v}</Text>
      )}
      {items.map((item, index) => {
        const icon = item.status === "done" ? "✓" : item.status === "failed" ? "✗" : "○";
        const line = ` ${icon} ${truncate(item.text, contentWidth - 3)}`;
        return (
          <Text key={`progress-item-${index}`}>{BOX.v}{padLine(line, width)}{BOX.v}</Text>
        );
      })}
      {items.length === 0 && !data.summary && (
        <Text>{BOX.v}<Text dimColor>{padLine(" No data", width)}</Text>{BOX.v}</Text>
      )}
    </>
  );
}

function StatusRenderer({ data, width }: { data: GenericPanelData; width: number }): React.ReactElement {
  const stats = data.stats || { passed: 0, failed: 0 };
  const items = data.items?.filter(i => i.status === "failed") || [];
  const innerWidth = getInnerWidth(width);
  const contentWidth = getContentWidth(width);

  // Calculate summary line length for padding
  let summaryLength = 1 + 2 + String(stats.passed).length + " passed".length; // " ✓ X passed"
  if (stats.failed > 0) {
    summaryLength += 2 + 2 + String(stats.failed).length + " failed".length;
  }
  if (stats.skipped && stats.skipped > 0) {
    summaryLength += 2 + 2 + String(stats.skipped).length + " skipped".length;
  }
  const summaryPadding = Math.max(0, innerWidth - summaryLength);

  return (
    <>
      {data.summary && (
        <Text>{BOX.v}{padLine(" " + truncate(data.summary, contentWidth), width)}{BOX.v}</Text>
      )}
      <Text>
        {BOX.v}{" "}
        <Text color="green">✓ {stats.passed} passed</Text>
        {stats.failed > 0 && (
          <>
            {"  "}
            <Text color="red">✗ {stats.failed} failed</Text>
          </>
        )}
        {stats.skipped && stats.skipped > 0 && (
          <>
            {"  "}
            <Text dimColor>○ {stats.skipped} skipped</Text>
          </>
        )}
        {" ".repeat(summaryPadding)}{BOX.v}
      </Text>
      {items.length > 0 && items.map((item, index) => (
        <Text key={`status-item-${index}`}>{BOX.v}{padLine(" • " + truncate(item.text, contentWidth - 3), width)}{BOX.v}</Text>
      ))}
    </>
  );
}

export function GenericPanel({
  data,
  renderer = "list",
  countdown,
  relativeTime,
  error,
  width = DEFAULT_PANEL_WIDTH,
  isRunning = false,
  justRefreshed = false,
}: GenericPanelProps): React.ReactElement {
  // Determine suffix based on running state
  const suffix = isRunning ? "running..." : formatTitleSuffix(countdown, relativeTime);
  const suffixColor = isRunning ? "yellow" : justRefreshed ? "green" : undefined;
  const progress = data.progress || { done: 0, total: 0 };

  // Error state
  if (error) {
    return (
      <Box flexDirection="column" width={width}>
        <Text>{createTitleLine(data.title, suffix, width)}</Text>
        <Text>{BOX.v}<Text dimColor>{padLine(" " + error, width)}</Text>{BOX.v}</Text>
        <Text>{createBottomLine(width)}</Text>
      </Box>
    );
  }

  // Progress renderer has special title with progress bar
  if (renderer === "progress") {
    return (
      <Box flexDirection="column" width={width}>
        <Text>{createProgressTitleLine(data.title, progress.done, progress.total, width, countdown, relativeTime)}</Text>
        <ProgressRenderer data={data} width={width} />
        <Text>{createBottomLine(width)}</Text>
      </Box>
    );
  }

  // List and Status renderers use standard title
  return (
    <Box flexDirection="column" width={width}>
      <Text>{createTitleLine(data.title, suffix, width)}</Text>
      {renderer === "status" ? <StatusRenderer data={data} width={width} /> : <ListRenderer data={data} width={width} />}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
