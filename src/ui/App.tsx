import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { GitPanel } from "./GitPanel.js";
import { TestPanel } from "./TestPanel.js";
import { ProjectPanel } from "./ProjectPanel.js";
import { ClaudePanel } from "./ClaudePanel.js";
import { GenericPanel } from "./GenericPanel.js";
import { WelcomePanel } from "./WelcomePanel.js";
import { MAX_TERMINAL_WIDTH, MIN_TERMINAL_WIDTH, DEFAULT_FALLBACK_WIDTH } from "./constants.js";
import { getGitData, getGitDataAsync, type GitData } from "../data/git.js";
import { getTestData } from "../data/tests.js";
import { getProjectData, type ProjectData } from "../data/project.js";
import { getClaudeData } from "../data/claude.js";
import { getCustomPanelData, getCustomPanelDataAsync, type CustomPanelResult } from "../data/custom.js";
import { runTestCommand } from "../runner/command.js";
import { parseConfig, type Config, type CustomPanelConfig } from "../config/parser.js";
import type { TestData, ClaudeData, GenericPanelRenderer } from "../types/index.js";

interface AppProps {
  mode: "watch" | "once";
  agentDirExists?: boolean;
}

interface PanelCountdowns {
  project: number | null;
  git: number | null;
  claude: number | null;
  [key: string]: number | null; // custom panels
}

// Visual feedback states for panels
interface VisualFeedback {
  isRunning: boolean;
  justRefreshed: boolean;
  justCompleted: boolean;
}

interface PanelVisualStates {
  project: VisualFeedback;
  git: VisualFeedback;
  tests: VisualFeedback;
  claude: VisualFeedback;
  [key: string]: VisualFeedback; // custom panels
}

const DEFAULT_VISUAL_STATE: VisualFeedback = {
  isRunning: false,
  justRefreshed: false,
  justCompleted: false,
};

const FEEDBACK_DURATION = 1500; // 1.5 seconds for visual feedback

interface Hotkey {
  key: string;
  label: string;
  action: () => void;
}

// Generate hotkeys for manual panels
function generateHotkeys(
  config: Config,
  actions: {
    tests?: () => void;
    customPanels?: Record<string, () => void>;
  }
): Hotkey[] {
  const hotkeys: Hotkey[] = [];
  const usedKeys = new Set<string>(["r", "q"]); // reserved

  // Tests panel - manual by default
  if (config.panels.tests.enabled && config.panels.tests.interval === null && actions.tests) {
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

  // Custom panels with manual interval
  if (config.customPanels && actions.customPanels) {
    for (const [name, panelConfig] of Object.entries(config.customPanels)) {
      if (panelConfig.enabled && panelConfig.interval === null && actions.customPanels[name]) {
        for (const char of name.toLowerCase()) {
          if (!usedKeys.has(char)) {
            usedKeys.add(char);
            hotkeys.push({
              key: char,
              label: `run ${name}`,
              action: actions.customPanels[name],
            });
            break;
          }
        }
      }
    }
  }

  return hotkeys;
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

function WelcomeApp(): React.ReactElement {
  return <WelcomePanel />;
}

// Calculate capped terminal width
function getClampedWidth(columns: number | undefined): number {
  if (!columns || columns <= 0) {
    return DEFAULT_FALLBACK_WIDTH;
  }
  return Math.min(Math.max(columns, MIN_TERMINAL_WIDTH), MAX_TERMINAL_WIDTH);
}

function DashboardApp({ mode }: { mode: "watch" | "once" }): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // Parse config once at startup
  const { config, warnings } = useMemo(() => parseConfig(), []);

  // Responsive terminal width using Ink's useStdout hook
  const [width, setWidth] = useState(() => getClampedWidth(stdout?.columns));

  useEffect(() => {
    // Update width when stdout columns change
    const newWidth = getClampedWidth(stdout?.columns);
    if (newWidth !== width) {
      setWidth(newWidth);
    }
  }, [stdout?.columns, width]);

  useEffect(() => {
    const handleResize = () => {
      setWidth(getClampedWidth(stdout?.columns));
    };

    // Listen for terminal resize events
    stdout?.on("resize", handleResize);

    return () => {
      stdout?.off("resize", handleResize);
    };
  }, [stdout]);

  // Calculate interval in seconds for display
  const projectIntervalSeconds = config.panels.project.interval ? config.panels.project.interval / 1000 : null;
  const gitIntervalSeconds = config.panels.git.interval ? config.panels.git.interval / 1000 : null;
  const claudeIntervalSeconds = config.panels.claude.interval ? config.panels.claude.interval / 1000 : null;

  // Get current working directory for Claude session lookup
  const cwd = process.cwd();

  // Project data
  const [projectData, setProjectData] = useState<ProjectData>(() => getProjectData());
  const refreshProject = useCallback(() => {
    setProjectData(getProjectData());
  }, []);

  // Git data - uses config commands
  const [gitData, setGitData] = useState<GitData>(() => getGitData(config.panels.git));
  const refreshGit = useCallback(() => {
    setGitData(getGitData(config.panels.git));
  }, [config.panels.git]);

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

  // Claude data
  const [claudeData, setClaudeData] = useState<ClaudeData>(() => getClaudeData(cwd, config.panels.claude.maxActivities));
  const refreshClaude = useCallback(() => {
    setClaudeData(getClaudeData(cwd, config.panels.claude.maxActivities));
  }, [cwd, config.panels.claude.maxActivities]);

  // Custom panel data
  const customPanelNames = useMemo(
    () => Object.keys(config.customPanels || {}),
    [config.customPanels]
  );

  const [customPanelData, setCustomPanelData] = useState<Record<string, CustomPanelResult>>(() => {
    const data: Record<string, CustomPanelResult> = {};
    if (config.customPanels) {
      for (const [name, panelConfig] of Object.entries(config.customPanels)) {
        if (panelConfig.enabled) {
          data[name] = getCustomPanelData(name, panelConfig);
        }
      }
    }
    return data;
  });

  const refreshCustomPanel = useCallback(
    (name: string) => {
      if (config.customPanels && config.customPanels[name]) {
        setCustomPanelData((prev) => ({
          ...prev,
          [name]: getCustomPanelData(name, config.customPanels![name]),
        }));
      }
    },
    [config.customPanels]
  );

  // Per-panel countdowns
  const initialCountdowns = useMemo(() => {
    const countdowns: PanelCountdowns = {
      project: projectIntervalSeconds,
      git: gitIntervalSeconds,
      claude: claudeIntervalSeconds,
    };
    if (config.customPanels) {
      for (const [name, panelConfig] of Object.entries(config.customPanels)) {
        countdowns[name] = panelConfig.interval ? panelConfig.interval / 1000 : null;
      }
    }
    return countdowns;
  }, [projectIntervalSeconds, gitIntervalSeconds, claudeIntervalSeconds, config.customPanels]);

  const [countdowns, setCountdowns] = useState<PanelCountdowns>(initialCountdowns);

  // Visual feedback states
  const initialVisualStates = useMemo(() => {
    const states: PanelVisualStates = {
      project: { ...DEFAULT_VISUAL_STATE },
      git: { ...DEFAULT_VISUAL_STATE },
      tests: { ...DEFAULT_VISUAL_STATE },
      claude: { ...DEFAULT_VISUAL_STATE },
    };
    for (const name of customPanelNames) {
      states[name] = { ...DEFAULT_VISUAL_STATE };
    }
    return states;
  }, [customPanelNames]);

  const [visualStates, setVisualStates] = useState<PanelVisualStates>(initialVisualStates);

  // Helper to set visual state for a panel
  const setVisualState = useCallback((panel: string, update: Partial<VisualFeedback>) => {
    setVisualStates((prev) => ({
      ...prev,
      [panel]: { ...prev[panel], ...update },
    }));
  }, []);

  // Helper to clear visual feedback after duration
  const clearFeedback = useCallback((panel: string, key: keyof VisualFeedback) => {
    setTimeout(() => {
      setVisualState(panel, { [key]: false });
    }, FEEDBACK_DURATION);
  }, [setVisualState]);

  // Project panel refresh with visual feedback (sync, no async version needed)
  const refreshProjectWithFeedback = useCallback(() => {
    setProjectData(getProjectData());
    setVisualState("project", { justRefreshed: true });
    clearFeedback("project", "justRefreshed");
  }, [setVisualState, clearFeedback]);

  // Async refresh for Git with visual feedback
  const refreshGitAsync = useCallback(async () => {
    setVisualState("git", { isRunning: true });
    try {
      const data = await getGitDataAsync(config.panels.git);
      setGitData(data);
    } finally {
      setVisualState("git", { isRunning: false, justRefreshed: true });
      clearFeedback("git", "justRefreshed");
    }
  }, [config.panels.git, setVisualState, clearFeedback]);

  // Async refresh for custom panels with visual feedback
  const refreshCustomPanelAsync = useCallback(
    async (name: string) => {
      if (config.customPanels && config.customPanels[name]) {
        setVisualState(name, { isRunning: true });
        try {
          const result = await getCustomPanelDataAsync(name, config.customPanels[name]);
          setCustomPanelData((prev) => ({
            ...prev,
            [name]: result,
          }));
        } finally {
          setVisualState(name, { isRunning: false, justRefreshed: true });
          clearFeedback(name, "justRefreshed");
        }
      }
    },
    [config.customPanels, setVisualState, clearFeedback]
  );

  // Async refresh for tests with visual feedback
  const refreshTestAsync = useCallback(async () => {
    setVisualState("tests", { isRunning: true });
    try {
      // Tests still use sync for now, but wrapped in setTimeout to allow UI update
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          setTestData(getTestDataFromConfig());
          resolve();
        }, 0);
      });
    } finally {
      setVisualState("tests", { isRunning: false, justCompleted: true });
      clearFeedback("tests", "justCompleted");
    }
  }, [getTestDataFromConfig, setVisualState, clearFeedback]);

  // Claude panel refresh with visual feedback (file-based)
  const refreshClaudeWithFeedback = useCallback(() => {
    setClaudeData(getClaudeData(cwd, config.panels.claude.maxActivities));
    setVisualState("claude", { justRefreshed: true });
    clearFeedback("claude", "justRefreshed");
  }, [cwd, config.panels.claude.maxActivities, setVisualState, clearFeedback]);

  // Build custom panel refresh actions for hotkeys (async)
  const customPanelActionsAsync = useMemo(() => {
    const actions: Record<string, () => void> = {};
    for (const name of customPanelNames) {
      actions[name] = () => void refreshCustomPanelAsync(name);
    }
    return actions;
  }, [customPanelNames, refreshCustomPanelAsync]);

  const refreshAll = useCallback(async () => {
    if (config.panels.project.enabled) {
      refreshProjectWithFeedback();
      setCountdowns((prev) => ({ ...prev, project: projectIntervalSeconds }));
    }
    if (config.panels.git.enabled) {
      void refreshGitAsync();
      setCountdowns((prev) => ({ ...prev, git: gitIntervalSeconds }));
    }
    if (config.panels.tests.enabled) {
      void refreshTestAsync();
    }
    if (config.panels.claude.enabled) {
      refreshClaudeWithFeedback();
      setCountdowns((prev) => ({ ...prev, claude: claudeIntervalSeconds }));
    }
    // Refresh custom panels
    for (const name of customPanelNames) {
      if (config.customPanels![name].enabled) {
        void refreshCustomPanelAsync(name);
        const interval = config.customPanels![name].interval;
        setCountdowns((prev) => ({
          ...prev,
          [name]: interval ? interval / 1000 : null,
        }));
      }
    }
  }, [
    refreshProjectWithFeedback,
    refreshGitAsync,
    refreshTestAsync,
    refreshClaudeWithFeedback,
    refreshCustomPanelAsync,
    config,
    projectIntervalSeconds,
    gitIntervalSeconds,
    claudeIntervalSeconds,
    customPanelNames,
  ]);

  // Generate hotkeys for manual panels (using async functions)
  const hotkeys = useMemo(
    () => generateHotkeys(config, {
      tests: () => void refreshTestAsync(),
      customPanels: customPanelActionsAsync
    }),
    [config, refreshTestAsync, customPanelActionsAsync]
  );

  // Per-panel refresh timers (using async functions with visual feedback)
  useEffect(() => {
    if (mode !== "watch") return;

    const timers: NodeJS.Timeout[] = [];

    // Project panel timer
    if (config.panels.project.enabled && config.panels.project.interval !== null) {
      timers.push(
        setInterval(() => {
          refreshProjectWithFeedback();
          setCountdowns((prev) => ({ ...prev, project: projectIntervalSeconds }));
        }, config.panels.project.interval)
      );
    }

    // Git panel timer
    if (config.panels.git.enabled && config.panels.git.interval !== null) {
      timers.push(
        setInterval(() => {
          void refreshGitAsync();
          setCountdowns((prev) => ({ ...prev, git: gitIntervalSeconds }));
        }, config.panels.git.interval)
      );
    }

    // Tests panel timer (null = manual, no timer)
    if (config.panels.tests.enabled && config.panels.tests.interval !== null) {
      timers.push(setInterval(() => void refreshTestAsync(), config.panels.tests.interval));
    }

    // Claude panel timer
    if (config.panels.claude.enabled && config.panels.claude.interval !== null) {
      timers.push(
        setInterval(() => {
          refreshClaudeWithFeedback();
          setCountdowns((prev) => ({ ...prev, claude: claudeIntervalSeconds }));
        }, config.panels.claude.interval)
      );
    }

    // Custom panel timers
    if (config.customPanels) {
      for (const [name, panelConfig] of Object.entries(config.customPanels)) {
        if (panelConfig.enabled && panelConfig.interval !== null) {
          const intervalSeconds = panelConfig.interval / 1000;
          timers.push(
            setInterval(() => {
              void refreshCustomPanelAsync(name);
              setCountdowns((prev) => ({ ...prev, [name]: intervalSeconds }));
            }, panelConfig.interval)
          );
        }
      }
    }

    return () => timers.forEach((t) => clearInterval(t));
  }, [
    mode,
    config,
    refreshProjectWithFeedback,
    refreshGitAsync,
    refreshTestAsync,
    refreshClaudeWithFeedback,
    refreshCustomPanelAsync,
    projectIntervalSeconds,
    gitIntervalSeconds,
    claudeIntervalSeconds,
  ]);

  // Countdown ticker - decrements every second
  useEffect(() => {
    if (mode !== "watch") return;

    const tick = setInterval(() => {
      setCountdowns((prev) => {
        const next: PanelCountdowns = {
          project: prev.project !== null && prev.project > 1 ? prev.project - 1 : prev.project,
          git: prev.git !== null && prev.git > 1 ? prev.git - 1 : prev.git,
          claude: prev.claude !== null && prev.claude > 1 ? prev.claude - 1 : prev.claude,
        };
        // Decrement custom panel countdowns
        for (const name of customPanelNames) {
          next[name] = prev[name] !== null && prev[name]! > 1 ? prev[name]! - 1 : prev[name];
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [mode, customPanelNames]);

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
  statusBarItems.push("r: refresh all");
  statusBarItems.push("q: quit");

  return (
    <Box flexDirection="column">
      {warnings.length > 0 && (
        <Box marginBottom={1}>
          <Text color="yellow">⚠ {warnings.join(", ")}</Text>
        </Box>
      )}
      {config.panelOrder.map((panelName, index) => {
        const isFirst = index === 0;

        // Project panel
        if (panelName === "project" && config.panels.project.enabled) {
          const projectVisual = visualStates.project || DEFAULT_VISUAL_STATE;
          return (
            <Box key={`panel-project-${index}`} marginTop={isFirst ? 0 : 1}>
              <ProjectPanel
                data={projectData}
                countdown={mode === "watch" ? countdowns.project : null}
                width={width}
                justRefreshed={projectVisual.justRefreshed}
              />
            </Box>
          );
        }

        // Git panel
        if (panelName === "git" && config.panels.git.enabled) {
          const gitVisual = visualStates.git || DEFAULT_VISUAL_STATE;
          return (
            <Box key={`panel-git-${index}`} marginTop={isFirst ? 0 : 1}>
              <GitPanel
                branch={gitData.branch}
                commits={gitData.commits}
                stats={gitData.stats}
                uncommitted={gitData.uncommitted}
                countdown={mode === "watch" ? countdowns.git : null}
                width={width}
                isRunning={gitVisual.isRunning}
                justRefreshed={gitVisual.justRefreshed}
              />
            </Box>
          );
        }

        // Tests panel
        if (panelName === "tests" && config.panels.tests.enabled) {
          const testsVisual = visualStates.tests || DEFAULT_VISUAL_STATE;
          return (
            <Box key={`panel-tests-${index}`} marginTop={isFirst ? 0 : 1}>
              <TestPanel
                results={testData.results}
                isOutdated={testData.isOutdated}
                commitsBehind={testData.commitsBehind}
                error={testData.error}
                width={width}
                isRunning={testsVisual.isRunning}
                justCompleted={testsVisual.justCompleted}
              />
            </Box>
          );
        }

        // Claude panel
        if (panelName === "claude" && config.panels.claude.enabled) {
          const claudeVisual = visualStates.claude || DEFAULT_VISUAL_STATE;
          return (
            <Box key={`panel-claude-${index}`} marginTop={isFirst ? 0 : 1}>
              <ClaudePanel
                data={claudeData}
                countdown={mode === "watch" ? countdowns.claude : null}
                width={width}
                justRefreshed={claudeVisual.justRefreshed}
              />
            </Box>
          );
        }

        // Custom panel
        const customConfig = config.customPanels?.[panelName];
        if (customConfig && customConfig.enabled) {
          const result = customPanelData[panelName];
          if (!result) return null;

          const customVisual = visualStates[panelName] || DEFAULT_VISUAL_STATE;
          const isManual = customConfig.interval === null;
          const relativeTime = isManual ? formatRelativeTime(result.timestamp) : undefined;
          const countdown = !isManual && mode === "watch" ? countdowns[panelName] : null;

          return (
            <Box key={`panel-${panelName}-${index}`} marginTop={isFirst ? 0 : 1}>
              <GenericPanel
                data={result.data}
                renderer={customConfig.renderer}
                countdown={countdown}
                relativeTime={relativeTime}
                error={result.error}
                width={width}
                isRunning={customVisual.isRunning}
                justRefreshed={customVisual.justRefreshed}
              />
            </Box>
          );
        }

        return null;
      })}
      {mode === "watch" && (
        <Box marginTop={1} width={width}>
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
