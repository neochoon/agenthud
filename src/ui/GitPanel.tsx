import React from "react";
import { Box, Text } from "ink";
import type { Commit, GitStats } from "../types/index.js";
import { PANEL_WIDTH, CONTENT_WIDTH, INNER_WIDTH, BOX, createTitleLine, createBottomLine, padLine, truncate } from "./constants.js";

interface GitPanelProps {
  branch: string | null;
  commits: Commit[];
  stats: GitStats;
  uncommitted?: number;
  countdown?: number | null;
}

const MAX_COMMITS = 5;
// "• abc1234 " = 10 chars, rest for message
const MAX_MESSAGE_LENGTH = CONTENT_WIDTH - 10;

function formatCountdown(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  return `↻ ${seconds}s`;
}

export function GitPanel({ branch, commits, stats, uncommitted = 0, countdown }: GitPanelProps): React.ReactElement {
  const countdownSuffix = formatCountdown(countdown);

  // Not a git repository
  if (branch === null) {
    return (
      <Box flexDirection="column" width={PANEL_WIDTH}>
        <Text>{createTitleLine("Git", countdownSuffix)}</Text>
        <Text>{BOX.v}<Text dimColor>{padLine(" Not a git repository")}</Text>{BOX.v}</Text>
        <Text>{createBottomLine()}</Text>
      </Box>
    );
  }

  const displayCommits = commits.slice(0, MAX_COMMITS);
  const hasCommits = commits.length > 0;
  const commitWord = commits.length === 1 ? "commit" : "commits";
  const fileWord = stats.files === 1 ? "file" : "files";
  const hasUncommitted = uncommitted > 0;

  // Calculate content length for padding (plain text, no ANSI codes)
  let branchLineLength = 1 + branch.length; // " " + branch
  if (hasCommits) {
    branchLineLength += ` · +${stats.added} -${stats.deleted} · ${commits.length} ${commitWord} · ${stats.files} ${fileWord}`.length;
  }
  if (hasUncommitted) {
    branchLineLength += ` · ${uncommitted} dirty`.length;
  }
  const branchPadding = Math.max(0, INNER_WIDTH - branchLineLength);

  return (
    <Box flexDirection="column" width={PANEL_WIDTH}>
      {/* Title line with countdown */}
      <Text>{createTitleLine("Git", countdownSuffix)}</Text>

      {/* Branch and stats with colors */}
      <Text>
        {BOX.v}{" "}
        <Text color="green">{branch}</Text>
        {hasCommits && (
          <>
            <Text dimColor> · </Text>
            <Text color="green">+{stats.added}</Text>
            <Text> </Text>
            <Text color="red">-{stats.deleted}</Text>
            <Text dimColor> · {commits.length} {commitWord} · {stats.files} {fileWord}</Text>
          </>
        )}
        {hasUncommitted && (
          <>
            <Text dimColor> · </Text>
            <Text color="yellow">{uncommitted} dirty</Text>
          </>
        )}
        {" ".repeat(branchPadding)}{BOX.v}
      </Text>

      {hasCommits ? (
        <>
          {/* Commit list */}
          {displayCommits.map((commit) => {
            const msg = truncate(commit.message, MAX_MESSAGE_LENGTH);
            const lineLength = 3 + 7 + 1 + msg.length; // " • " + hash + " " + msg
            const commitPadding = Math.max(0, INNER_WIDTH - lineLength);
            return (
              <Text key={commit.hash}>
                {BOX.v} • <Text dimColor>{commit.hash.slice(0, 7)}</Text> {msg}
                {" ".repeat(commitPadding)}{BOX.v}
              </Text>
            );
          })}
        </>
      ) : (
        <Text>{BOX.v}<Text dimColor>{padLine(" No commits today")}</Text>{BOX.v}</Text>
      )}

      {/* Bottom line */}
      <Text>{createBottomLine()}</Text>
    </Box>
  );
}
