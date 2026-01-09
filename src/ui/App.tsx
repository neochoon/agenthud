import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { GitPanel } from "./GitPanel.js";
import { PlanPanel } from "./PlanPanel.js";
import { getCurrentBranch, getTodayCommits, getTodayStats } from "../data/git.js";
import { getPlanData } from "../data/plan.js";
import type { Commit, GitStats, PlanData } from "../types/index.js";

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

function usePlanData(): [PlanData, () => void] {
  const [data, setData] = useState<PlanData>(() => getPlanData());

  const refresh = useCallback(() => {
    setData(getPlanData());
  }, []);

  return [data, refresh];
}

export function App({ mode }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [gitData, refreshGit] = useGitData();
  const [planData, refreshPlan] = usePlanData();

  const refreshAll = useCallback(() => {
    refreshGit();
    refreshPlan();
  }, [refreshGit, refreshPlan]);

  // Watch mode: refresh every 5 seconds
  useEffect(() => {
    if (mode !== "watch") return;

    const interval = setInterval(refreshAll, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [mode, refreshAll]);

  // Keyboard shortcuts (watch mode only)
  useInput(
    (input) => {
      if (mode !== "watch") return;

      if (input === "q") {
        exit();
      }
      if (input === "r") {
        refreshAll();
      }
    },
    { isActive: mode === "watch" }
  );

  return (
    <Box flexDirection="column">
      <GitPanel
        branch={gitData.branch}
        commits={gitData.commits}
        stats={gitData.stats}
      />
      <Box marginTop={1}>
        <PlanPanel
          plan={planData.plan}
          decisions={planData.decisions}
          error={planData.error}
        />
      </Box>
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
