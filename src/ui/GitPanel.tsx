import { Box, Text } from "ink";
import type React from "react";
import type { Commit, GitStats } from "../types/index.js";
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

interface GitPanelProps {
  branch: string | null;
  commits: Commit[];
  stats: GitStats;
  uncommitted?: number;
  countdown?: number | null;
  width?: number;
  isRunning?: boolean;
  justRefreshed?: boolean;
}

const MAX_COMMITS = 5;

function formatCountdown(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const padded = String(seconds).padStart(2, " ");
  return `↻ ${padded}s`;
}

export function GitPanel({
  branch,
  commits,
  stats,
  uncommitted = 0,
  countdown,
  width = DEFAULT_PANEL_WIDTH,
  isRunning = false,
  justRefreshed = false,
}: GitPanelProps): React.ReactElement {
  // When running, show "running..." instead of countdown
  const countdownSuffix = isRunning ? "running..." : formatCountdown(countdown);
  const innerWidth = getInnerWidth(width);
  const contentWidth = getContentWidth(width);
  const maxMessageLength = contentWidth - 10; // "• abc1234 " = 10 chars

  // Not a git repository
  if (branch === null) {
    return (
      <Box flexDirection="column" width={width}>
        <Text>{createTitleLine("Git", countdownSuffix, width)}</Text>
        <Text>
          {BOX.v}
          <Text dimColor>{padLine(" Not a git repository", width)}</Text>
          {BOX.v}
        </Text>
        <Text>{createBottomLine(width)}</Text>
      </Box>
    );
  }

  const displayCommits = commits.slice(0, MAX_COMMITS);
  const hasCommits = commits.length > 0;
  const commitWord = commits.length === 1 ? "commit" : "commits";
  const fileWord = stats.files === 1 ? "file" : "files";
  const hasUncommitted = uncommitted > 0;

  // Calculate stats suffix length first
  let statsSuffix = "";
  if (hasCommits) {
    statsSuffix = ` · +${stats.added} -${stats.deleted} · ${commits.length} ${commitWord} · ${stats.files} ${fileWord}`;
  }
  if (hasUncommitted) {
    statsSuffix += ` · ${uncommitted} dirty`;
  }

  // Truncate branch name to fit within inner width
  const availableForBranch = innerWidth - 1 - statsSuffix.length; // 1 for leading space
  const displayBranch =
    availableForBranch > 3
      ? truncate(branch, availableForBranch)
      : truncate(branch, 10);

  // Calculate content length for padding (plain text, no ANSI codes)
  const branchLineLength = 1 + displayBranch.length + statsSuffix.length; // " " + branch + stats
  const branchPadding = Math.max(0, innerWidth - branchLineLength);

  return (
    <Box flexDirection="column" width={width}>
      {/* Title line with countdown */}
      <Text>{createTitleLine("Git", countdownSuffix, width)}</Text>

      {/* Branch and stats with colors */}
      <Text>
        {BOX.v} <Text color="green">{displayBranch}</Text>
        {hasCommits && (
          <>
            <Text dimColor> · </Text>
            <Text color="green">+{stats.added}</Text>
            <Text> </Text>
            <Text color="red">-{stats.deleted}</Text>
            <Text dimColor>
              {" "}
              · {commits.length} {commitWord} · {stats.files} {fileWord}
            </Text>
          </>
        )}
        {hasUncommitted && (
          <>
            <Text dimColor> · </Text>
            <Text color="yellow">{uncommitted} dirty</Text>
          </>
        )}
        {" ".repeat(branchPadding)}
        {BOX.v}
      </Text>

      {hasCommits ? (
        <>
          {/* Commit list */}
          {displayCommits.map((commit) => {
            const msg = truncate(commit.message, maxMessageLength);
            const lineLength = 3 + 7 + 1 + msg.length; // " • " + hash + " " + msg
            const commitPadding = Math.max(0, innerWidth - lineLength);
            return (
              <Text key={commit.hash}>
                {BOX.v} • <Text dimColor>{commit.hash.slice(0, 7)}</Text> {msg}
                {" ".repeat(commitPadding)}
                {BOX.v}
              </Text>
            );
          })}
        </>
      ) : (
        <Text>
          {BOX.v}
          <Text dimColor>{padLine(" No commits today", width)}</Text>
          {BOX.v}
        </Text>
      )}

      {/* Bottom line */}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
