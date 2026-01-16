import { Box, Text } from "ink";
import type React from "react";
import type { TestResults } from "../types/index.js";
import {
  BOX,
  createBottomLine,
  createTitleLine,
  DEFAULT_PANEL_WIDTH,
  getContentWidth,
  getInnerWidth,
  padLine,
  truncate,
} from "./constants.js";

interface TestPanelProps {
  results: TestResults | null;
  isOutdated: boolean;
  commitsBehind: number;
  error?: string;
  width?: number;
  isRunning?: boolean;
  justCompleted?: boolean;
}

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// Create separator line: "├─────────────────────────────────────────────────────────┤"
function createSeparator(panelWidth: number): string {
  return BOX.ml + BOX.h.repeat(getInnerWidth(panelWidth)) + BOX.mr;
}

export function TestPanel({
  results,
  isOutdated,
  commitsBehind,
  error,
  width = DEFAULT_PANEL_WIDTH,
  isRunning = false,
  justCompleted = false,
}: TestPanelProps): React.ReactElement {
  const innerWidth = getInnerWidth(width);
  const contentWidth = getContentWidth(width);

  // Determine title suffix: "running..." when running, "just now" when justCompleted
  const getTitleSuffix = (): string => {
    if (isRunning) return "running...";
    if (justCompleted) return "just now";
    if (results) return formatRelativeTime(results.timestamp);
    return "";
  };
  const titleSuffix = getTitleSuffix();

  // Error state
  if (error || !results) {
    return (
      <Box flexDirection="column" width={width}>
        <Text>{createTitleLine("Tests", titleSuffix, width)}</Text>
        <Text>
          {BOX.v}
          <Text dimColor>
            {padLine(` ${error || "No test results"}`, width)}
          </Text>
          {BOX.v}
        </Text>
        <Text>{createBottomLine(width)}</Text>
      </Box>
    );
  }

  const hasFailures = results.failures.length > 0;
  const relativeTime = titleSuffix;

  // Calculate summary line length for padding
  let summaryLength = 1 + 2 + String(results.passed).length + " passed".length; // " ✓ X passed"
  if (results.failed > 0) {
    summaryLength += 2 + 2 + String(results.failed).length + " failed".length; // "  ✗ X failed"
  }
  if (results.skipped > 0) {
    summaryLength += 2 + 2 + String(results.skipped).length + " skipped".length; // "  ○ X skipped"
  }
  summaryLength += " · ".length + results.hash.length;
  const summaryPadding = Math.max(0, innerWidth - summaryLength);

  return (
    <Box flexDirection="column" width={width}>
      {/* Title line with relative time */}
      <Text>{createTitleLine("Tests", relativeTime, width)}</Text>

      {/* Outdated warning */}
      {isOutdated && (
        <Text>
          {BOX.v}
          <Text color="yellow">
            {padLine(
              ` ⚠ Outdated (${commitsBehind} ${commitsBehind === 1 ? "commit" : "commits"} behind)`,
              width,
            )}
          </Text>
          {BOX.v}
        </Text>
      )}

      {/* Summary line with colors */}
      <Text>
        {BOX.v} <Text color="green">✓ {results.passed} passed</Text>
        {results.failed > 0 && (
          <>
            {"  "}
            <Text color="red">✗ {results.failed} failed</Text>
          </>
        )}
        {results.skipped > 0 && (
          <>
            {"  "}
            <Text dimColor>○ {results.skipped} skipped</Text>
          </>
        )}
        <Text dimColor> · {results.hash}</Text>
        {" ".repeat(summaryPadding)}
        {BOX.v}
      </Text>

      {/* Failures section */}
      {hasFailures && (
        <>
          <Text dimColor>{createSeparator(width)}</Text>
          {results.failures.map((failure, index) => {
            const fileName = truncate(failure.file, contentWidth - 3);
            const filePadding = Math.max(0, innerWidth - 3 - fileName.length); // " ✗ " + file
            const testName = truncate(failure.name, contentWidth - 5);
            const testPadding = Math.max(0, innerWidth - 5 - testName.length); // "   • " + name
            return (
              <Box key={`failure-${index}`} flexDirection="column">
                <Text>
                  {BOX.v} <Text color="red">✗ {fileName}</Text>
                  {" ".repeat(filePadding)}
                  {BOX.v}
                </Text>
                <Text>
                  {BOX.v}
                  {"   "}• {testName}
                  {" ".repeat(testPadding)}
                  {BOX.v}
                </Text>
              </Box>
            );
          })}
        </>
      )}

      {/* Bottom line */}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
