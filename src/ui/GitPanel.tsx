import React from "react";
import { Box, Text } from "ink";
import type { Commit, GitStats } from "../types/index.js";
import { PANEL_WIDTH, SEPARATOR } from "./constants.js";

interface GitPanelProps {
  branch: string | null;
  commits: Commit[];
  stats: GitStats;
}

const MAX_COMMITS = 5;

export function GitPanel({ branch, commits, stats }: GitPanelProps): React.ReactElement {
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

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} width={PANEL_WIDTH}>
      {/* Header */}
      <Box marginTop={-1}>
        <Text> Git </Text>
      </Box>

      {/* Branch */}
      <Text>
        Branch: <Text color="green">{branch}</Text>
      </Text>

      {/* Separator */}
      <Box marginY={0}>
        <Text dimColor>{SEPARATOR}</Text>
      </Box>

      {hasCommits ? (
        <>
          {/* Stats line */}
          <Text>
            Today: <Text color="green">+{stats.added}</Text>{" "}
            <Text color="red">-{stats.deleted}</Text>{" "}
            <Text>({commits.length} {commitWord})</Text>
          </Text>

          {/* Commit list */}
          {displayCommits.map((commit) => (
            <Text key={commit.hash}>
              • <Text dimColor>{commit.hash.slice(0, 7)}</Text> {commit.message}
            </Text>
          ))}
        </>
      ) : (
        <Text dimColor>No commits today</Text>
      )}
    </Box>
  );
}
