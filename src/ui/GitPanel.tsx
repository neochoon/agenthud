import React from "react";
import { Box, Text } from "ink";
import type { Commit, GitStats } from "../types/index.js";
import { PANEL_WIDTH, CONTENT_WIDTH, truncate } from "./constants.js";

interface GitPanelProps {
  branch: string | null;
  commits: Commit[];
  stats: GitStats;
  uncommitted?: number;
}

const MAX_COMMITS = 5;
// "• abc1234 " = 10 chars, rest for message
const MAX_MESSAGE_LENGTH = CONTENT_WIDTH - 10;

export function GitPanel({ branch, commits, stats, uncommitted = 0 }: GitPanelProps): React.ReactElement {
  // Not a git repository
  if (branch === null) {
    return (
      <Box flexDirection="column" borderStyle="single" paddingX={1} width={PANEL_WIDTH}>
        <Box marginTop={-1}>
          <Text> Git </Text>
        </Box>
        <Text dimColor>Not a git repository</Text>
      </Box>
    );
  }

  const displayCommits = commits.slice(0, MAX_COMMITS);
  const hasCommits = commits.length > 0;
  const commitWord = commits.length === 1 ? "commit" : "commits";
  const fileWord = stats.files === 1 ? "file" : "files";
  const hasUncommitted = uncommitted > 0;

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={PANEL_WIDTH}>
      {/* Header */}
      <Box marginTop={-1}>
        <Text> Git </Text>
      </Box>

      {/* Branch and stats */}
      <Text>
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
      </Text>

      {hasCommits ? (
        <>
          {/* Commit list */}
          {displayCommits.map((commit) => (
            <Text key={commit.hash}>
              • <Text dimColor>{commit.hash.slice(0, 7)}</Text> {truncate(commit.message, MAX_MESSAGE_LENGTH)}
            </Text>
          ))}
        </>
      ) : (
        <Text dimColor>No commits today</Text>
      )}
    </Box>
  );
}
