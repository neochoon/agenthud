import { Box, Text, useApp, useInput, useStdout } from "ink";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getVersion } from "../cli.js";
import { parseConfig } from "../config/parser.js";
import { getClaudeData } from "../data/claude.js";
import {
  type CustomPanelResult,
  getCustomPanelData,
  getCustomPanelDataAsync,
} from "../data/custom.js";
import { type GitData, getGitData, getGitDataAsync } from "../data/git.js";
import {
  getOtherSessionsData,
  type OtherSessionsData,
} from "../data/otherSessions.js";
import { getProjectData, type ProjectData } from "../data/project.js";
import { getTestData } from "../data/tests.js";
import { runTestCommand } from "../runner/command.js";
import type { ClaudeData, TestData } from "../types/index.js";
import { ClaudePanel } from "./ClaudePanel.js";
import {
  DEFAULT_FALLBACK_WIDTH,
  MAX_TERMINAL_WIDTH,
  MIN_TERMINAL_WIDTH,
} from "./constants.js";
import { GenericPanel } from "./GenericPanel.js";
import { GitPanel } from "./GitPanel.js";
import { useCountdown } from "./hooks/useCountdown.js";
import { useHotkeys } from "./hooks/useHotkeys.js";
import { useVisualFeedback } from "./hooks/useVisualFeedback.js";
import { OtherSessionsPanel } from "./OtherSessionsPanel.js";
import { ProjectPanel } from "./ProjectPanel.js";
import { TestPanel } from "./TestPanel.js";
import { WelcomePanel } from "./WelcomePanel.js";

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

function DashboardApp({
  mode,
}: {
  mode: "watch" | "once";
}): React.ReactElement {
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
    [config.width],
  );

  // Calculate dynamic maxActivities based on terminal height for wide layout
  // todoCount: number of active todos (not all completed) to account for TodoSection height
  // isWideLayout: whether we're in 2-column mode
  const getEffectiveMaxActivities = useCallback(
    (
      terminalRows: number | undefined,
      todoCount = 0,
      isWideLayout = false,
    ): number => {
      const configMax = config.panels.claude.maxActivities ?? 10;
      if (!terminalRows || !isWideLayout) {
        return configMax;
      }
      // In wide layout: Claude shares left column with Other Sessions panel
      // Claude: title(1) + bottom(1) = 2
      // OtherSessions: ~6 lines (title, header, empty, session, message, bottom)
      // Margins: 2 (between panels + before status bar)
      // StatusBar: 1
      // Buffer: 2 (for subActivities or variations)
      // Total fixed = 2 + 6 + 2 + 1 + 2 = 13
      // TodoSection adds: separator (1) + todo items (todoCount)
      const todoHeight = todoCount > 0 ? 1 + todoCount : 0;
      const heightBasedMax = Math.max(5, terminalRows - 13 - todoHeight);
      return Math.max(configMax, heightBasedMax);
    },
    [config.panels.claude.maxActivities],
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
    return () => {
      stdout?.off("resize", handleResize);
    };
  }, [stdout, config.width, getEffectiveWidth]);

  // Panel names for hooks
  const customPanelNames = useMemo(
    () => Object.keys(config.customPanels || {}),
    [config.customPanels],
  );

  const allPanelNames = useMemo(
    () => [
      "project",
      "git",
      "tests",
      "claude",
      "other_sessions",
      ...customPanelNames,
    ],
    [customPanelNames],
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
  const [projectData, setProjectData] = useState<ProjectData>(() =>
    getProjectData(),
  );
  const [gitData, setGitData] = useState<GitData>(() =>
    getGitData(config.panels.git),
  );
  // Fetch more activities than needed; display will be limited by claudeMaxActivities
  const fetchMaxActivities = Math.max(
    config.panels.claude.maxActivities ?? 10,
    stdout?.rows ?? 50,
  );
  const [claudeData, setClaudeData] = useState<ClaudeData>(() =>
    getClaudeData(cwd, fetchMaxActivities, config.panels.claude.sessionTimeout),
  );
  const [otherSessionsData, setOtherSessionsData] = useState<OtherSessionsData>(
    () =>
      getOtherSessionsData(cwd, {
        activeThresholdMs: config.panels.other_sessions.activeThreshold,
      }),
  );

  // Test data with lazy loading for faster initial render
  const getTestDataFromConfig = useCallback((): TestData => {
    if (config.panels.tests.command) {
      return runTestCommand(config.panels.tests.command);
    }
    return getTestData();
  }, [config.panels.tests.command]);

  const [testData, setTestData] = useState<TestData>({
    results: null,
    isOutdated: false,
    commitsBehind: 0,
  });
  const testsInitializedRef = useRef(false);

  // Lazy load test data after initial render
  useEffect(() => {
    if (testsInitializedRef.current) return;
    testsInitializedRef.current = true;

    // Use setTimeout to defer test loading after first paint
    const timer = setTimeout(() => {
      setTestData(getTestDataFromConfig());
    }, 0);

    return () => clearTimeout(timer);
  }, [getTestDataFromConfig]);

  // Custom panel data
  const [customPanelData, setCustomPanelData] = useState<
    Record<string, CustomPanelResult>
  >(() => {
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
          setTestData(getTestDataFromConfig());
          resolve();
        }, 0);
      });
    } finally {
      visualFeedback.endAsync("tests", { completed: true });
    }
  }, [getTestDataFromConfig, visualFeedback]);

  const refreshClaude = useCallback(() => {
    const maxFetch = Math.max(
      config.panels.claude.maxActivities ?? 10,
      stdout?.rows ?? 50,
    );
    setClaudeData(
      getClaudeData(cwd, maxFetch, config.panels.claude.sessionTimeout),
    );
    visualFeedback.setRefreshed("claude");
    resetCountdown("claude");
  }, [
    cwd,
    stdout?.rows,
    config.panels.claude.maxActivities,
    config.panels.claude.sessionTimeout,
    visualFeedback,
    resetCountdown,
  ]);

  const refreshOtherSessions = useCallback(() => {
    setOtherSessionsData(
      getOtherSessionsData(cwd, {
        activeThresholdMs: config.panels.other_sessions.activeThreshold,
      }),
    );
    visualFeedback.setRefreshed("other_sessions");
    resetCountdown("other_sessions");
  }, [
    cwd,
    config.panels.other_sessions.activeThreshold,
    visualFeedback,
    resetCountdown,
  ]);

  const refreshCustomPanelAsync = useCallback(
    async (name: string) => {
      if (config.customPanels?.[name]) {
        visualFeedback.startAsync(name);
        try {
          const result = await getCustomPanelDataAsync(
            name,
            config.customPanels[name],
          );
          setCustomPanelData((prev) => ({ ...prev, [name]: result }));
        } finally {
          visualFeedback.endAsync(name);
          resetCountdown(name);
        }
      }
    },
    [config.customPanels, visualFeedback, resetCountdown],
  );

  // Refresh all panels
  const refreshAll = useCallback(() => {
    if (config.panels.project.enabled) refreshProject();
    if (config.panels.git.enabled) void refreshGitAsync();
    if (config.panels.tests.enabled) void refreshTestAsync();
    if (config.panels.claude.enabled) refreshClaude();
    if (config.panels.other_sessions.enabled) refreshOtherSessions();
    for (const name of customPanelNames) {
      if (config.customPanels?.[name].enabled) {
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
    const panels: Array<{ name: string; label: string; action: () => void }> =
      [];

    if (config.panels.tests.enabled && config.panels.tests.interval === null) {
      panels.push({
        name: "tests",
        label: "run tests",
        action: () => void refreshTestAsync(),
      });
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
    { isActive: isWatchMode },
  );

  // Keep refs to latest refresh functions to avoid stale closures in setInterval
  const refreshProjectRef = useRef(refreshProject);
  const refreshGitAsyncRef = useRef(refreshGitAsync);
  const refreshTestAsyncRef = useRef(refreshTestAsync);
  const refreshClaudeRef = useRef(refreshClaude);
  const refreshOtherSessionsRef = useRef(refreshOtherSessions);
  const refreshCustomPanelAsyncRef = useRef(refreshCustomPanelAsync);

  // Update refs on each render
  refreshProjectRef.current = refreshProject;
  refreshGitAsyncRef.current = refreshGitAsync;
  refreshTestAsyncRef.current = refreshTestAsync;
  refreshClaudeRef.current = refreshClaude;
  refreshOtherSessionsRef.current = refreshOtherSessions;
  refreshCustomPanelAsyncRef.current = refreshCustomPanelAsync;

  // Per-panel refresh timers - only recreate when config or mode changes
  useEffect(() => {
    if (!isWatchMode) return;

    const timers: NodeJS.Timeout[] = [];

    if (
      config.panels.project.enabled &&
      config.panels.project.interval !== null
    ) {
      timers.push(
        setInterval(
          () => refreshProjectRef.current(),
          config.panels.project.interval,
        ),
      );
    }
    if (config.panels.git.enabled && config.panels.git.interval !== null) {
      timers.push(
        setInterval(
          () => void refreshGitAsyncRef.current(),
          config.panels.git.interval,
        ),
      );
    }
    if (config.panels.tests.enabled && config.panels.tests.interval !== null) {
      timers.push(
        setInterval(
          () => void refreshTestAsyncRef.current(),
          config.panels.tests.interval,
        ),
      );
    }
    if (
      config.panels.claude.enabled &&
      config.panels.claude.interval !== null
    ) {
      timers.push(
        setInterval(
          () => refreshClaudeRef.current(),
          config.panels.claude.interval,
        ),
      );
    }
    if (
      config.panels.other_sessions.enabled &&
      config.panels.other_sessions.interval !== null
    ) {
      timers.push(
        setInterval(
          () => refreshOtherSessionsRef.current(),
          config.panels.other_sessions.interval,
        ),
      );
    }
    if (config.customPanels) {
      for (const [name, panelConfig] of Object.entries(config.customPanels)) {
        if (panelConfig.enabled && panelConfig.interval !== null) {
          timers.push(
            setInterval(
              () => void refreshCustomPanelAsyncRef.current(name),
              panelConfig.interval,
            ),
          );
        }
      }
    }

    return () => timers.forEach((t) => clearInterval(t));
  }, [isWatchMode, config]);

  // Check for wide layout mode
  const terminalWidth = stdout?.columns ?? 0;
  const terminalHeight = stdout?.rows ?? 0;
  const columnGap = 2;

  // Calculate effective threshold for wide layout
  // If config has threshold, use it; otherwise auto-calculate from MIN_TERMINAL_WIDTH
  const effectiveThreshold =
    config.wideLayoutThreshold ?? MIN_TERMINAL_WIDTH * 2 + columnGap;
  const useWideLayout = terminalWidth >= effectiveThreshold;

  // Calculate widths for 2-column layout (50:50 ratio)
  // In single column mode, use full terminal width (clamped)
  const singleColumnWidth = getClampedWidth(terminalWidth);
  const leftColumnWidth = useWideLayout
    ? Math.floor((terminalWidth - columnGap) / 2)
    : singleColumnWidth;
  const rightColumnWidth = useWideLayout
    ? terminalWidth - leftColumnWidth - columnGap
    : singleColumnWidth;

  // Calculate dynamic maxActivities for Claude panel in wide layout
  // Account for TodoSection height when todos exist and not all completed
  const claudeMaxActivities = useMemo(() => {
    if (!useWideLayout) return undefined; // No limit in normal layout
    const todos = claudeData.state.todos;
    const hasTodos = todos && todos.length > 0;
    const allCompleted =
      hasTodos && todos.every((t) => t.status === "completed");
    // Only count todos if TodoSection will be shown (has todos and not all completed)
    const activeTodoCount = hasTodos && !allCompleted ? todos.length : 0;
    return getEffectiveMaxActivities(terminalHeight, activeTodoCount, true);
  }, [
    useWideLayout,
    claudeData.state.todos,
    terminalHeight,
    getEffectiveMaxActivities,
  ]);

  // Helper to render a panel by name
  const renderPanel = (
    panelName: string,
    panelWidth: number,
    marginTop: number,
  ): React.ReactElement | null => {
    if (panelName === "project" && config.panels.project.enabled) {
      const vs = visualFeedback.getState("project");
      return (
        <Box key={`panel-${panelName}`} marginTop={marginTop}>
          <ProjectPanel
            data={projectData}
            countdown={isWatchMode ? countdowns.project : null}
            width={panelWidth}
            justRefreshed={vs.justRefreshed}
          />
        </Box>
      );
    }

    if (panelName === "git" && config.panels.git.enabled) {
      const vs = visualFeedback.getState("git");
      return (
        <Box key={`panel-${panelName}`} marginTop={marginTop}>
          <GitPanel
            branch={gitData.branch}
            commits={gitData.commits}
            stats={gitData.stats}
            uncommitted={gitData.uncommitted}
            countdown={isWatchMode ? countdowns.git : null}
            width={panelWidth}
            isRunning={vs.isRunning}
            justRefreshed={vs.justRefreshed}
          />
        </Box>
      );
    }

    if (panelName === "tests" && config.panels.tests.enabled) {
      const vs = visualFeedback.getState("tests");
      return (
        <Box key={`panel-${panelName}`} marginTop={marginTop}>
          <TestPanel
            results={testData.results}
            isOutdated={testData.isOutdated}
            commitsBehind={testData.commitsBehind}
            error={testData.error}
            width={panelWidth}
            isRunning={vs.isRunning}
            justCompleted={vs.justCompleted}
          />
        </Box>
      );
    }

    if (panelName === "claude" && config.panels.claude.enabled) {
      const vs = visualFeedback.getState("claude");
      return (
        <Box key={`panel-${panelName}`} marginTop={marginTop}>
          <ClaudePanel
            data={claudeData}
            countdown={isWatchMode ? countdowns.claude : null}
            width={panelWidth}
            justRefreshed={vs.justRefreshed}
            maxActivities={claudeMaxActivities}
          />
        </Box>
      );
    }

    if (
      panelName === "other_sessions" &&
      config.panels.other_sessions.enabled
    ) {
      const vs = visualFeedback.getState("other_sessions");
      return (
        <Box key={`panel-${panelName}`} marginTop={marginTop}>
          <OtherSessionsPanel
            data={otherSessionsData}
            countdown={isWatchMode ? countdowns.other_sessions : null}
            width={panelWidth}
            isRunning={vs.isRunning}
            messageMaxLength={config.panels.other_sessions.messageMaxLength}
          />
        </Box>
      );
    }

    // Custom panel
    const customConfig = config.customPanels?.[panelName];
    if (customConfig?.enabled) {
      const result = customPanelData[panelName];
      if (!result) return null;

      const vs = visualFeedback.getState(panelName);
      const isManual = customConfig.interval === null;
      const relativeTime = isManual
        ? formatRelativeTime(result.timestamp)
        : undefined;
      const countdown = !isManual && isWatchMode ? countdowns[panelName] : null;

      return (
        <Box key={`panel-${panelName}`} marginTop={marginTop}>
          <GenericPanel
            data={result.data}
            renderer={customConfig.renderer}
            countdown={countdown}
            relativeTime={relativeTime}
            error={result.error}
            width={panelWidth}
            isRunning={vs.isRunning}
            justRefreshed={vs.justRefreshed}
          />
        </Box>
      );
    }

    return null;
  };

  // Render panels
  if (useWideLayout) {
    // 2-column layout: Claude + Other Sessions on left, others on right
    const leftPanels = ["claude", "other_sessions"];
    const rightPanels = config.panelOrder.filter(
      (name) => !leftPanels.includes(name),
    );

    return (
      <Box flexDirection="column">
        {warnings.length > 0 && (
          <Box marginBottom={1}>
            <Text color="yellow">⚠ {warnings.join(", ")}</Text>
          </Box>
        )}

        <Box flexDirection="row">
          {/* Left column: Claude + Other Sessions */}
          <Box flexDirection="column" width={leftColumnWidth}>
            {renderPanel("claude", leftColumnWidth, 0)}
            {renderPanel("other_sessions", leftColumnWidth, 1)}
          </Box>

          {/* Right column: Other panels */}
          <Box
            flexDirection="column"
            width={rightColumnWidth}
            marginLeft={columnGap}
          >
            {rightPanels.map((panelName, index) =>
              renderPanel(panelName, rightColumnWidth, index === 0 ? 0 : 1),
            )}
          </Box>
        </Box>

        {isWatchMode && (
          <Box
            marginTop={1}
            width={terminalWidth}
            justifyContent="space-between"
          >
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

  // Standard vertical layout
  return (
    <Box flexDirection="column">
      {warnings.length > 0 && (
        <Box marginBottom={1}>
          <Text color="yellow">⚠ {warnings.join(", ")}</Text>
        </Box>
      )}

      {config.panelOrder.map((panelName, index) =>
        renderPanel(panelName, width, index === 0 ? 0 : 1),
      )}

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

export function App({
  mode,
  agentDirExists = true,
}: AppProps): React.ReactElement {
  if (!agentDirExists) {
    return <WelcomeApp />;
  }
  return <DashboardApp mode={mode} />;
}
