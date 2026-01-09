import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { GitPanel } from "./GitPanel.js";
import { getCurrentBranch, getTodayCommits, getTodayStats } from "../data/git.js";
import type { Commit, GitStats } from "../types/index.js";

interface AppProps {
  mode: "watch" | "once";
}

interface GitData {
  branch: string | null;
  commits: Commit[];
  stats: GitStats;
}

const REFRESH_INTERVAL = 5000; // 5 seconds

function useGitData(): [GitData, () => void] {
  const [data, setData] = useState<GitData>(() => ({
    branch: getCurrentBranch(),
    commits: getTodayCommits(),
    stats: getTodayStats(),
  }));

  const refresh = useCallback(() => {
    setData({
      branch: getCurrentBranch(),
      commits: getTodayCommits(),
      stats: getTodayStats(),
    });
  }, []);

  return [data, refresh];
}

export function App({ mode }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [data, refresh] = useGitData();

  // Watch mode: refresh every 5 seconds
  useEffect(() => {
    if (mode !== "watch") return;

    const interval = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [mode, refresh]);

  // Keyboard shortcuts (watch mode only)
  useInput(
    (input, key) => {
      if (mode !== "watch") return;

      if (input === "q") {
        exit();
      }
      if (input === "r") {
        refresh();
      }
    },
    { isActive: mode === "watch" }
  );

  return (
    <Box flexDirection="column">
      <GitPanel
        branch={data.branch}
        commits={data.commits}
        stats={data.stats}
      />
      {mode === "watch" && (
        <Box marginTop={1}>
          <Text dimColor>
            Press <Text color="cyan">q</Text> to quit, <Text color="cyan">r</Text> to refresh
          </Text>
        </Box>
      )}
    </Box>
  );
}
