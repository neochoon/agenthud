import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { GitPanel } from "./GitPanel.js";
import { TestPanel } from "./TestPanel.js";
import { ProjectPanel } from "./ProjectPanel.js";
import { ClaudePanel } from "./ClaudePanel.js";
import { OtherSessionsPanel } from "./OtherSessionsPanel.js";
import { GenericPanel } from "./GenericPanel.js";
import { WelcomePanel } from "./WelcomePanel.js";
import { MAX_TERMINAL_WIDTH, MIN_TERMINAL_WIDTH, DEFAULT_FALLBACK_WIDTH } from "./constants.js";
import { useCountdown } from "./hooks/useCountdown.js";
import { useVisualFeedback } from "./hooks/useVisualFeedback.js";
import { useHotkeys } from "./hooks/useHotkeys.js";
import { getGitData, getGitDataAsync, type GitData } from "../data/git.js";
import { getTestData } from "../data/tests.js";
import { getProjectData, type ProjectData } from "../data/project.js";
import { getClaudeData } from "../data/claude.js";
import { getOtherSessionsData, type OtherSessionsData } from "../data/otherSessions.js";
import { getCustomPanelData, getCustomPanelDataAsync, type CustomPanelResult } from "../data/custom.js";
import { runTestCommand } from "../runner/command.js";
import { parseConfig } from "../config/parser.js";
import { getVersion } from "../cli.js";
import type { TestData, ClaudeData } from "../types/index.js";

interface AppProps {
  mode: "watch" | "once";
  agentDirExists?: boolean;
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
  const { exit } = useApp();

  useInput((input) => {
    if (input === "q") {
      exit();
    }
  });

  return <WelcomePanel />;
}

function getClampedWidth(columns: number | undefined): number {
  if (!columns || columns <= 0) {
    return DEFAULT_FALLBACK_WIDTH;
  }
  return Math.min(Math.max(columns, MIN_TERMINAL_WIDTH), MAX_TERMINAL_WIDTH);
}

function DashboardApp({ mode }: { mode: "watch" | "once" }): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const isWatchMode = mode === "watch";

  // Parse config once at startup
  const { config, warnings } = useMemo(() => parseConfig(), []);

  // Width management
  const getEffectiveWidth = useCallback(
    (terminalColumns: number | undefined): number => {
      if (config.width) return config.width;
      return getClampedWidth(terminalColumns);
    },
    [config.width]
  );

  const [width, setWidth] = useState(() => getEffectiveWidth(stdout?.columns));

  useEffect(() => {
    if (!config.width) {
      const newWidth = getEffectiveWidth(stdout?.columns);
      if (newWidth !== width) setWidth(newWidth);
    }
  }, [stdout?.columns, width, config.width, getEffectiveWidth]);

  useEffect(() => {
    if (config.width) return;
    const handleResize = () => setWidth(getEffectiveWidth(stdout?.columns));
    stdout?.on("resize", handleResize);
    return () => { stdout?.off("resize", handleResize); };
  }, [stdout, config.width, getEffectiveWidth]);

  // Panel names for hooks
  const customPanelNames = useMemo(
    () => Object.keys(config.customPanels || {}),
    [config.customPanels]
  );

  const allPanelNames = useMemo(
    () => ["project", "git", "tests", "claude", "other_sessions", ...customPanelNames],
    [customPanelNames]
  );

  // Build panel intervals for useCountdown
  const panelIntervals = useMemo(() => {
    const panels: Record<string, { interval: number | null }> = {
      project: { interval: config.panels.project.interval },
      git: { interval: config.panels.git.interval },
      tests: { interval: config.panels.tests.interval },
      claude: { interval: config.panels.claude.interval },
      other_sessions: { interval: config.panels.other_sessions.interval },
    };
    const customPanels: Record<string, { interval: number | null }> = {};
    if (config.customPanels) {
      for (const [name, cfg] of Object.entries(config.customPanels)) {
        customPanels[name] = { interval: cfg.interval };
      }
    }
    return { panels, customPanels };
  }, [config]);

  // Use extracted hooks
  const { countdowns, reset: resetCountdown } = useCountdown({
    panels: panelIntervals.panels,
    customPanels: panelIntervals.customPanels,
    enabled: isWatchMode,
  });

  const visualFeedback = useVisualFeedback({ panels: allPanelNames });

  // Current working directory
  const cwd = process.cwd();

  // Panel data states
  const [projectData, setProjectData] = useState<ProjectData>(() => getProjectData());
  const [gitData, setGitData] = useState<GitData>(() => getGitData(config.panels.git));
  const [claudeData, setClaudeData] = useState<ClaudeData>(() =>
    getClaudeData(cwd, config.panels.claude.maxActivities, config.panels.claude.sessionTimeout)
  );
  const [otherSessionsData, setOtherSessionsData] = useState<OtherSessionsData>(() =>
    getOtherSessionsData(cwd, { activeThresholdMs: config.panels.other_sessions.activeThreshold })
  );

  // Test data with disabled state
  const getTestDataFromConfig = useCallback((): TestData => {
    if (config.panels.tests.command) {
      return runTestCommand(config.panels.tests.command);
    }
    return getTestData();
  }, [config.panels.tests.command]);

  const initialTestData = useMemo(() => getTestDataFromConfig(), [getTestDataFromConfig]);
  const [testsDisabled, setTestsDisabled] = useState(
    !!(initialTestData.error && config.panels.tests.command)
  );
  const [testData, setTestData] = useState<TestData>(initialTestData);

  // Custom panel data
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

  // Refresh functions with visual feedback
  const refreshProject = useCallback(() => {
    setProjectData(getProjectData());
    visualFeedback.setRefreshed("project");
    resetCountdown("project");
  }, [visualFeedback, resetCountdown]);

  const refreshGitAsync = useCallback(async () => {
    visualFeedback.startAsync("git");
    try {
      const data = await getGitDataAsync(config.panels.git);
      setGitData(data);
    } finally {
      visualFeedback.endAsync("git");
      resetCountdown("git");
    }
  }, [config.panels.git, visualFeedback, resetCountdown]);

  const refreshTestAsync = useCallback(async () => {
    visualFeedback.startAsync("tests");
    try {
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          const data = getTestDataFromConfig();
          if (config.panels.tests.command) {
            setTestsDisabled(!!data.error);
          }
          setTestData(data);
          resolve();
        }, 0);
      });
    } finally {
      visualFeedback.endAsync("tests", { completed: true });
    }
  }, [getTestDataFromConfig, config.panels.tests.command, visualFeedback]);

  const refreshClaude = useCallback(() => {
    setClaudeData(getClaudeData(cwd, config.panels.claude.maxActivities, config.panels.claude.sessionTimeout));
    visualFeedback.setRefreshed("claude");
    resetCountdown("claude");
  }, [cwd, config.panels.claude.maxActivities, config.panels.claude.sessionTimeout, visualFeedback, resetCountdown]);

  const refreshOtherSessions = useCallback(() => {
    setOtherSessionsData(
      getOtherSessionsData(cwd, { activeThresholdMs: config.panels.other_sessions.activeThreshold })
    );
    visualFeedback.setRefreshed("other_sessions");
    resetCountdown("other_sessions");
  }, [cwd, config.panels.other_sessions.activeThreshold, visualFeedback, resetCountdown]);

  const refreshCustomPanelAsync = useCallback(
    async (name: string) => {
      if (config.customPanels && config.customPanels[name]) {
        visualFeedback.startAsync(name);
        try {
          const result = await getCustomPanelDataAsync(name, config.customPanels[name]);
          setCustomPanelData((prev) => ({ ...prev, [name]: result }));
        } finally {
          visualFeedback.endAsync(name);
          resetCountdown(name);
        }
      }
    },
    [config.customPanels, visualFeedback, resetCountdown]
  );

  // Refresh all panels
  const refreshAll = useCallback(() => {
    if (config.panels.project.enabled) refreshProject();
    if (config.panels.git.enabled) void refreshGitAsync();
    if (config.panels.tests.enabled) void refreshTestAsync();
    if (config.panels.claude.enabled) refreshClaude();
    if (config.panels.other_sessions.enabled) refreshOtherSessions();
    for (const name of customPanelNames) {
      if (config.customPanels![name].enabled) {
        void refreshCustomPanelAsync(name);
      }
    }
  }, [
    config,
    customPanelNames,
    refreshProject,
    refreshGitAsync,
    refreshTestAsync,
    refreshClaude,
    refreshOtherSessions,
    refreshCustomPanelAsync,
  ]);

  // Build manual panels for hotkeys
  const manualPanels = useMemo(() => {
    const panels: Array<{ name: string; label: string; action: () => void }> = [];

    if (config.panels.tests.enabled && config.panels.tests.interval === null) {
      panels.push({ name: "tests", label: "run tests", action: () => void refreshTestAsync() });
    }

    if (config.customPanels) {
      for (const [name, panelConfig] of Object.entries(config.customPanels)) {
        if (panelConfig.enabled && panelConfig.interval === null) {
          panels.push({
            name,
            label: `run ${name}`,
            action: () => void refreshCustomPanelAsync(name),
          });
        }
      }
    }

    return panels;
  }, [config, refreshTestAsync, refreshCustomPanelAsync]);

  // Use hotkeys hook
  const { handleInput, statusBarItems } = useHotkeys({
    manualPanels,
    onRefreshAll: refreshAll,
    onQuit: exit,
  });

  // Keyboard input handling
  useInput(
    (input) => {
      handleInput(input);
    },
    { isActive: isWatchMode }
  );

  // Per-panel refresh timers
  useEffect(() => {
    if (!isWatchMode) return;

    const timers: NodeJS.Timeout[] = [];

    if (config.panels.project.enabled && config.panels.project.interval !== null) {
      timers.push(setInterval(refreshProject, config.panels.project.interval));
    }
    if (config.panels.git.enabled && config.panels.git.interval !== null) {
      timers.push(setInterval(() => void refreshGitAsync(), config.panels.git.interval));
    }
    if (config.panels.tests.enabled && config.panels.tests.interval !== null) {
      timers.push(setInterval(() => void refreshTestAsync(), config.panels.tests.interval));
    }
    if (config.panels.claude.enabled && config.panels.claude.interval !== null) {
      timers.push(setInterval(refreshClaude, config.panels.claude.interval));
    }
    if (config.panels.other_sessions.enabled && config.panels.other_sessions.interval !== null) {
      timers.push(setInterval(refreshOtherSessions, config.panels.other_sessions.interval));
    }
    if (config.customPanels) {
      for (const [name, panelConfig] of Object.entries(config.customPanels)) {
        if (panelConfig.enabled && panelConfig.interval !== null) {
          timers.push(setInterval(() => void refreshCustomPanelAsync(name), panelConfig.interval));
        }
      }
    }

    return () => timers.forEach((t) => clearInterval(t));
  }, [
    isWatchMode,
    config,
    refreshProject,
    refreshGitAsync,
    refreshTestAsync,
    refreshClaude,
    refreshOtherSessions,
    refreshCustomPanelAsync,
  ]);

  // Render panels
  return (
    <Box flexDirection="column">
      {warnings.length > 0 && (
        <Box marginBottom={1}>
          <Text color="yellow">⚠ {warnings.join(", ")}</Text>
        </Box>
      )}

      {config.panelOrder.map((panelName, index) => {
        const isFirst = index === 0;
        const marginTop = isFirst ? 0 : 1;

        if (panelName === "project" && config.panels.project.enabled) {
          const vs = visualFeedback.getState("project");
          return (
            <Box key={`panel-${panelName}-${index}`} marginTop={marginTop}>
              <ProjectPanel
                data={projectData}
                countdown={isWatchMode ? countdowns.project : null}
                width={width}
                justRefreshed={vs.justRefreshed}
              />
            </Box>
          );
        }

        if (panelName === "git" && config.panels.git.enabled) {
          const vs = visualFeedback.getState("git");
          return (
            <Box key={`panel-${panelName}-${index}`} marginTop={marginTop}>
              <GitPanel
                branch={gitData.branch}
                commits={gitData.commits}
                stats={gitData.stats}
                uncommitted={gitData.uncommitted}
                countdown={isWatchMode ? countdowns.git : null}
                width={width}
                isRunning={vs.isRunning}
                justRefreshed={vs.justRefreshed}
              />
            </Box>
          );
        }

        if (panelName === "tests" && config.panels.tests.enabled && !testsDisabled) {
          const vs = visualFeedback.getState("tests");
          return (
            <Box key={`panel-${panelName}-${index}`} marginTop={marginTop}>
              <TestPanel
                results={testData.results}
                isOutdated={testData.isOutdated}
                commitsBehind={testData.commitsBehind}
                error={testData.error}
                width={width}
                isRunning={vs.isRunning}
                justCompleted={vs.justCompleted}
              />
            </Box>
          );
        }

        if (panelName === "claude" && config.panels.claude.enabled) {
          const vs = visualFeedback.getState("claude");
          return (
            <Box key={`panel-${panelName}-${index}`} marginTop={marginTop}>
              <ClaudePanel
                data={claudeData}
                countdown={isWatchMode ? countdowns.claude : null}
                width={width}
                justRefreshed={vs.justRefreshed}
              />
            </Box>
          );
        }

        if (panelName === "other_sessions" && config.panels.other_sessions.enabled) {
          const vs = visualFeedback.getState("other_sessions");
          return (
            <Box key={`panel-${panelName}-${index}`} marginTop={marginTop}>
              <OtherSessionsPanel
                data={otherSessionsData}
                countdown={isWatchMode ? countdowns.other_sessions : null}
                width={width}
                isRunning={vs.isRunning}
                messageMaxLength={config.panels.other_sessions.messageMaxLength}
              />
            </Box>
          );
        }

        // Custom panel
        const customConfig = config.customPanels?.[panelName];
        if (customConfig && customConfig.enabled) {
          const result = customPanelData[panelName];
          if (!result) return null;

          const vs = visualFeedback.getState(panelName);
          const isManual = customConfig.interval === null;
          const relativeTime = isManual ? formatRelativeTime(result.timestamp) : undefined;
          const countdown = !isManual && isWatchMode ? countdowns[panelName] : null;

          return (
            <Box key={`panel-${panelName}-${index}`} marginTop={marginTop}>
              <GenericPanel
                data={result.data}
                renderer={customConfig.renderer}
                countdown={countdown}
                relativeTime={relativeTime}
                error={result.error}
                width={width}
                isRunning={vs.isRunning}
                justRefreshed={vs.justRefreshed}
              />
            </Box>
          );
        }

        return null;
      })}

      {isWatchMode && (
        <Box marginTop={1} width={width} justifyContent="space-between">
          <Text dimColor>
            {statusBarItems.map((item, index) => (
              <React.Fragment key={index}>
                {index > 0 && " · "}
                <Text color="cyan">{item.split(":")[0]}:</Text>
                {item.split(":").slice(1).join(":")}
              </React.Fragment>
            ))}
          </Text>
          <Text dimColor>AgentHUD v{getVersion()}</Text>
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
