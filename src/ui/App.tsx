import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { GitPanel } from "./GitPanel.js";
import { PlanPanel } from "./PlanPanel.js";
import { TestPanel } from "./TestPanel.js";
import { WelcomePanel } from "./WelcomePanel.js";
import { getGitData, type GitData } from "../data/git.js";
import { getPlanDataWithConfig } from "../data/plan.js";
import { getTestData } from "../data/tests.js";
import { runTestCommand } from "../runner/command.js";
import { parseConfig, type Config } from "../config/parser.js";
import { PANEL_WIDTH } from "./constants.js";
import type { PlanData, TestData } from "../types/index.js";

interface AppProps {
  mode: "watch" | "once";
  agentDirExists?: boolean;
}

interface PanelCountdowns {
  git: number | null;
  plan: number | null;
}

interface Hotkey {
  key: string;
  label: string;
  action: () => void;
}

// Generate hotkeys for manual panels
function generateHotkeys(
  config: Config,
  actions: { tests?: () => void }
): Hotkey[] {
  const hotkeys: Hotkey[] = [];
  const usedKeys = new Set<string>();

  // Tests panel - manual by default
  if (config.panels.tests.enabled && config.panels.tests.interval === null && actions.tests) {
    // Use first available letter from "tests"
    const name = "tests";
    for (const char of name.toLowerCase()) {
      if (!usedKeys.has(char)) {
        usedKeys.add(char);
        hotkeys.push({
          key: char,
          label: "run tests",
          action: actions.tests,
        });
        break;
      }
    }
  }

  return hotkeys;
}

function WelcomeApp(): React.ReactElement {
  return <WelcomePanel />;
}

function DashboardApp({ mode }: { mode: "watch" | "once" }): React.ReactElement {
  const { exit } = useApp();

  // Parse config once at startup
  const { config, warnings } = useMemo(() => parseConfig(), []);

  // Calculate interval in seconds for display
  const gitIntervalSeconds = config.panels.git.interval ? config.panels.git.interval / 1000 : null;
  const planIntervalSeconds = config.panels.plan.interval ? config.panels.plan.interval / 1000 : null;

  // Git data - uses config commands
  const [gitData, setGitData] = useState<GitData>(() => getGitData(config.panels.git));
  const refreshGit = useCallback(() => {
    setGitData(getGitData(config.panels.git));
  }, [config.panels.git]);

  // Plan data - uses config source
  const [planData, setPlanData] = useState<PlanData>(() => getPlanDataWithConfig(config.panels.plan));
  const refreshPlan = useCallback(() => {
    setPlanData(getPlanDataWithConfig(config.panels.plan));
  }, [config.panels.plan]);

  // Test data - uses config command or falls back to file
  const getTestDataFromConfig = useCallback((): TestData => {
    if (config.panels.tests.command) {
      return runTestCommand(config.panels.tests.command);
    }
    return getTestData();
  }, [config.panels.tests.command]);

  const [testData, setTestData] = useState<TestData>(() => getTestDataFromConfig());
  const refreshTest = useCallback(() => {
    setTestData(getTestDataFromConfig());
  }, [getTestDataFromConfig]);

  // Per-panel countdowns
  const [countdowns, setCountdowns] = useState<PanelCountdowns>({
    git: gitIntervalSeconds,
    plan: planIntervalSeconds,
  });

  const refreshAll = useCallback(() => {
    if (config.panels.git.enabled) {
      refreshGit();
      setCountdowns((prev) => ({ ...prev, git: gitIntervalSeconds }));
    }
    if (config.panels.plan.enabled) {
      refreshPlan();
      setCountdowns((prev) => ({ ...prev, plan: planIntervalSeconds }));
    }
    if (config.panels.tests.enabled) {
      refreshTest();
    }
  }, [refreshGit, refreshPlan, refreshTest, config, gitIntervalSeconds, planIntervalSeconds]);

  // Generate hotkeys for manual panels
  const hotkeys = useMemo(
    () => generateHotkeys(config, { tests: refreshTest }),
    [config, refreshTest]
  );

  // Per-panel refresh timers
  useEffect(() => {
    if (mode !== "watch") return;

    const timers: NodeJS.Timeout[] = [];

    // Git panel timer
    if (config.panels.git.enabled && config.panels.git.interval !== null) {
      timers.push(
        setInterval(() => {
          refreshGit();
          setCountdowns((prev) => ({ ...prev, git: gitIntervalSeconds }));
        }, config.panels.git.interval)
      );
    }

    // Plan panel timer
    if (config.panels.plan.enabled && config.panels.plan.interval !== null) {
      timers.push(
        setInterval(() => {
          refreshPlan();
          setCountdowns((prev) => ({ ...prev, plan: planIntervalSeconds }));
        }, config.panels.plan.interval)
      );
    }

    // Tests panel timer (null = manual, no timer)
    if (config.panels.tests.enabled && config.panels.tests.interval !== null) {
      timers.push(setInterval(refreshTest, config.panels.tests.interval));
    }

    return () => timers.forEach((t) => clearInterval(t));
  }, [mode, config, refreshGit, refreshPlan, refreshTest, gitIntervalSeconds, planIntervalSeconds]);

  // Countdown ticker - decrements every second
  useEffect(() => {
    if (mode !== "watch") return;

    const tick = setInterval(() => {
      setCountdowns((prev) => ({
        git: prev.git !== null && prev.git > 1 ? prev.git - 1 : prev.git,
        plan: prev.plan !== null && prev.plan > 1 ? prev.plan - 1 : prev.plan,
      }));
    }, 1000);
    return () => clearInterval(tick);
  }, [mode]);

  // Keyboard shortcuts
  useInput(
    (input) => {
      if (input === "q") {
        exit();
      }
      if (input === "r") {
        refreshAll();
      }
      // Handle dynamic hotkeys
      for (const hotkey of hotkeys) {
        if (input === hotkey.key) {
          hotkey.action();
          break;
        }
      }
    },
    { isActive: mode === "watch" }
  );

  // Build status bar content
  const statusBarItems: string[] = [];
  for (const hotkey of hotkeys) {
    statusBarItems.push(`${hotkey.key}: ${hotkey.label}`);
  }
  statusBarItems.push("r: refresh");
  statusBarItems.push("q: quit");

  return (
    <Box flexDirection="column">
      {warnings.length > 0 && (
        <Box marginBottom={1}>
          <Text color="yellow">⚠ {warnings.join(", ")}</Text>
        </Box>
      )}
      {config.panels.git.enabled && (
        <Box>
          <GitPanel
            branch={gitData.branch}
            commits={gitData.commits}
            stats={gitData.stats}
            uncommitted={gitData.uncommitted}
            countdown={mode === "watch" ? countdowns.git : null}
          />
        </Box>
      )}
      {config.panels.plan.enabled && (
        <Box marginTop={config.panels.git.enabled ? 1 : 0}>
          <PlanPanel
            plan={planData.plan}
            decisions={planData.decisions}
            error={planData.error}
            countdown={mode === "watch" ? countdowns.plan : null}
          />
        </Box>
      )}
      {config.panels.tests.enabled && (
        <Box marginTop={config.panels.git.enabled || config.panels.plan.enabled ? 1 : 0}>
          <TestPanel
            results={testData.results}
            isOutdated={testData.isOutdated}
            commitsBehind={testData.commitsBehind}
            error={testData.error}
          />
        </Box>
      )}
      {mode === "watch" && (
        <Box marginTop={1} width={PANEL_WIDTH}>
          <Text dimColor>
            {statusBarItems.map((item, index) => (
              <React.Fragment key={index}>
                {index > 0 && " · "}
                <Text color="cyan">{item.split(":")[0]}:</Text>
                {item.split(":").slice(1).join(":")}
              </React.Fragment>
            ))}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export function App({ mode, agentDirExists = true }: AppProps): React.ReactElement {
  if (!agentDirExists) {
    return <WelcomeApp />;
  }
  return <DashboardApp mode={mode} />;
}
