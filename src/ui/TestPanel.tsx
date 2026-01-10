import React from "react";
import { Box, Text } from "ink";
import type { TestResults } from "../types/index.js";
import { PANEL_WIDTH, CONTENT_WIDTH, SEPARATOR, truncate } from "./constants.js";

interface TestPanelProps {
  results: TestResults | null;
  isOutdated: boolean;
  commitsBehind: number;
  error?: string;
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

export function TestPanel({
  results,
  isOutdated,
  commitsBehind,
  error,
}: TestPanelProps): React.ReactElement {
  // Error state
  if (error || !results) {
    return (
      <Box flexDirection="column" borderStyle="single" paddingX={1} width={PANEL_WIDTH}>
        <Box marginTop={-1}>
          <Text> Tests </Text>
        </Box>
        <Text dimColor>{error || "No test results"}</Text>
      </Box>
    );
  }

  const hasFailures = results.failures.length > 0;
  const relativeTime = formatRelativeTime(results.timestamp);

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={PANEL_WIDTH}>
      {/* Header */}
      <Box marginTop={-1}>
        <Text> Tests </Text>
      </Box>

      {/* Outdated warning */}
      {isOutdated && (
        <Text color="yellow">
          ⚠ Outdated ({commitsBehind} {commitsBehind === 1 ? "commit" : "commits"} behind)
        </Text>
      )}

      {/* Summary line */}
      <Text>
        <Text color="green">✓ {results.passed} passed</Text>
        {"  "}
        {results.failed > 0 ? (
          <Text color="red">✗ {results.failed} failed</Text>
        ) : (
          <Text dimColor>✗ 0 failed</Text>
        )}
        {results.skipped > 0 && (
          <>
            {"  "}
            <Text dimColor>○ {results.skipped} skipped</Text>
          </>
        )}
        {"  "}
        <Text dimColor>
          · {results.hash} · {relativeTime}
        </Text>
      </Text>

      {/* Failures section */}
      {hasFailures && (
        <>
          <Text dimColor>{SEPARATOR}</Text>
          {results.failures.map((failure, index) => (
            <Box key={index} flexDirection="column">
              <Text color="red">✗ {truncate(failure.file, CONTENT_WIDTH - 2)}</Text>
              <Text>
                {"  "}• {truncate(failure.name, CONTENT_WIDTH - 4)}
              </Text>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
}
