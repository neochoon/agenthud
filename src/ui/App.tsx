// src/ui/App.tsx

import type { FSWatcher } from "node:fs";
import { existsSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "../cli.js";
import {
  ensureLogDir,
  hasProjectLevelConfig,
  hideProject,
  hideSession,
  hideSubAgent,
  loadGlobalConfig,
} from "../config/globalConfig.js";
import { getCommitDetail, parseGitCommits } from "../data/gitCommits.js";
import { parseSessionHistory } from "../data/sessionHistory.js";
import { discoverSessions, getProjectsDir } from "../data/sessions.js";
import type {
  ActivityEntry,
  ProjectNode,
  SessionNode,
  SessionTree,
} from "../types/index.js";
import { ActivityViewerPanel } from "./ActivityViewerPanel.js";
import { DetailViewPanel } from "./DetailViewPanel.js";
import { HelpPanel } from "./HelpPanel.js";
import { useHotkeys } from "./hooks/useHotkeys.js";
import { useSpinner } from "./hooks/useSpinner.js";
import { SessionTreePanel } from "./SessionTreePanel.js";

const VIEWER_HEIGHT_FRACTION = 0.55;

function subSummarySentinel(parentId: string): SessionNode {
  return {
    id: `__sub-${parentId}__`,
    hideKey: "",
    filePath: "",
    projectPath: "",
    projectName: "",
    lastModifiedMs: 0,
    status: "cold",
    modelName: null,
    subAgents: [],
    nonInteractive: false,
    firstUserPrompt: null,
  };
}

function appendSubAgentRows(
  result: SessionNode[],
  session: SessionNode,
  expandedIds: Set<string>,
): void {
  const isCold = session.status === "cold";
  const sessionCollapsedKey = `__collapsed-session-${session.id}`;
  const sessionExpandedKey = `__expanded-session-${session.id}`;
  const sessionHidden = isCold
    ? !expandedIds.has(sessionExpandedKey) // cold default: hidden
    : expandedIds.has(sessionCollapsedKey); // alive default: visible

  if (sessionHidden) return;

  if (expandedIds.has(session.id)) {
    result.push(...session.subAgents);
  } else {
    result.push(
      ...session.subAgents.filter(
        (sub) => sub.status === "hot" || sub.status === "warm",
      ),
    );
    if (
      session.subAgents.some(
        (sub) => sub.status === "cool" || sub.status === "cold",
      )
    ) {
      result.push(subSummarySentinel(session.id));
    }
  }
}

function flattenSessions(
  tree: SessionTree,
  expandedIds: Set<string>,
): SessionNode[] {
  const result: SessionNode[] = [];

  const projectToFlat = (project: ProjectNode, isCold: boolean) => {
    // Synthesize a sentinel SessionNode for the project header.
    const sentinelId = `__proj-${project.name}__`;
    result.push({
      id: sentinelId,
      hideKey: "",
      filePath: "",
      projectPath: project.projectPath,
      projectName: project.name,
      lastModifiedMs: 0,
      status: project.hotness,
      modelName: null,
      subAgents: [],
      nonInteractive: false,
      firstUserPrompt: null,
    });

    const shouldShowSessions = isCold
      ? expandedIds.has(`__expanded-${sentinelId}`)
      : !expandedIds.has(`__collapsed-${sentinelId}`);

    if (shouldShowSessions) {
      for (const session of project.sessions) {
        result.push(session);
        appendSubAgentRows(result, session, expandedIds);
      }
    }
  };

  for (const project of tree.projects) {
    projectToFlat(project, false);
  }

  if (tree.coldProjects.length > 0) {
    result.push({
      id: "__cold__",
      hideKey: "",
      filePath: "",
      projectPath: "",
      projectName: `${tree.coldProjects.length} cold`,
      lastModifiedMs: 0,
      status: "cold",
      modelName: null,
      subAgents: [],
      nonInteractive: false,
      firstUserPrompt: null,
    });
    if (expandedIds.has("__cold__")) {
      for (const project of tree.coldProjects) {
        projectToFlat(project, true);
      }
    }
  }

  return result;
}

function getSelectedActivity(
  acts: ActivityEntry[],
  live: boolean,
  scrollOff: number,
  rows: number,
  cursorLine: number,
): ActivityEntry | null {
  if (acts.length === 0) return null;
  let visible: ActivityEntry[];
  if (live) {
    visible = acts.slice(-rows).reverse();
  } else {
    const end = Math.max(0, acts.length - scrollOff);
    const start = Math.max(0, end - rows);
    visible = acts.slice(start, end).reverse();
  }
  const effectiveCursor = Math.min(cursorLine, visible.length - 1);
  return visible[effectiveCursor] ?? null;
}

export function App({ mode }: { mode: "watch" | "once" }): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const isWatchMode = mode === "watch";

  const config = useMemo(() => loadGlobalConfig(), []);
  const migrationWarning = useMemo(() => hasProjectLevelConfig(), []);

  const [sessionTree, setSessionTree] = useState<SessionTree>(() =>
    discoverSessions(config),
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    // Select the first project sentinel if projects exist, otherwise null.
    const firstProject = sessionTree.projects[0];
    if (firstProject) return `__proj-${firstProject.name}__`;
    return null;
  });
  const [focus, setFocus] = useState<"tree" | "viewer">("tree");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isLive, setIsLive] = useState(true);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [gitActivities, setGitActivities] = useState<ActivityEntry[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [viewerCursorLine, setViewerCursorLine] = useState(0);
  const [detailMode, setDetailMode] = useState(false);
  const [detailActivity, setDetailActivity] = useState<ActivityEntry | null>(
    null,
  );
  const [detailScrollOffset, setDetailScrollOffset] = useState(0);
  const [filterIndex, setFilterIndex] = useState(0);
  const [helpMode, setHelpMode] = useState(false);

  const allFlat = useMemo(
    () => flattenSessions(sessionTree, expandedIds),
    [sessionTree, expandedIds],
  );

  const allFlatRef = useRef<SessionNode[]>(allFlat);
  useEffect(() => {
    allFlatRef.current = allFlat;
  }, [allFlat]);

  const activitiesLengthRef = useRef(0);
  const activitiesRef = useRef<ActivityEntry[]>(activities);
  useEffect(() => {
    activitiesLengthRef.current = activities.length;
    activitiesRef.current = activities;
  }, [activities]);

  // Load activities whenever selected session changes.
  // Only resets cursor/scroll when the loaded FILE changes (selection moved or
  // hottest-session-of-project changed), not on every sessionTree refresh.
  const lastLoadedFileRef = useRef<string | null>(null);
  useEffect(() => {
    let node = allFlatRef.current.find((s) => s.id === selectedId);

    // If selected is a project sentinel, use its hottest session
    if (
      node &&
      selectedId?.startsWith("__proj-") &&
      selectedId.endsWith("__")
    ) {
      const projectName = selectedId.slice(7, -2);
      const project =
        sessionTree.projects.find((p) => p.name === projectName) ??
        sessionTree.coldProjects.find((p) => p.name === projectName);
      if (project && project.sessions.length > 0) {
        node = project.sessions[0]; // hottest
      } else {
        node = undefined;
      }
    }

    const newFile = node?.filePath ?? null;
    const fileChanged = lastLoadedFileRef.current !== newFile;
    lastLoadedFileRef.current = newFile;

    if (node?.filePath) {
      setActivities(parseSessionHistory(node.filePath));
      if (fileChanged) {
        setScrollOffset(0);
        setIsLive(true);
        setNewCount(0);
        setViewerCursorLine(0);
        setGitActivities([]);
      }
    } else {
      setActivities([]);
      if (fileChanged) setGitActivities([]);
    }
  }, [selectedId, sessionTree]);

  // Reset scroll when filter changes
  useEffect(() => {
    setScrollOffset(0);
    setIsLive(true);
    setViewerCursorLine(0);
  }, [filterIndex]);

  // Load git commits for selected session: on selection + every 30s
  // Uses activitiesRef to avoid re-reading the JSONL file every tick
  useEffect(() => {
    if (!isWatchMode) return;
    const node = allFlatRef.current.find((s) => s.id === selectedId);
    if (!node?.projectPath) return;

    const load = () => {
      const acts = activitiesRef.current;
      const today = new Date();
      const todayMidnight = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
      );
      const startDate =
        acts.length > 0
          ? new Date(
              acts[0].timestamp.getFullYear(),
              acts[0].timestamp.getMonth(),
              acts[0].timestamp.getDate(),
            )
          : todayMidnight;
      const endDate =
        acts.length > 0
          ? new Date(
              acts[acts.length - 1].timestamp.getFullYear(),
              acts[acts.length - 1].timestamp.getMonth(),
              acts[acts.length - 1].timestamp.getDate(),
            )
          : todayMidnight;
      const commits = parseGitCommits(node.projectPath, startDate, endDate);
      setGitActivities(commits);
    };

    // Defer initial load to next tick so activitiesRef is populated
    const initial = setTimeout(load, 100);
    const timer = setInterval(load, 30_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [selectedId, isWatchMode]);

  const refresh = useCallback(() => {
    const freshConfig = loadGlobalConfig();
    const tree = discoverSessions(freshConfig);
    const updatedFlat = flattenSessions(tree, expandedIds);

    // If selected item disappeared (e.g. sub-agent went cold), fall back to
    // its parent session so navigation doesn't snap to index 0.
    const node = updatedFlat.find((s) => s.id === selectedId);
    if (!node) {
      const allSessions = tree.projects?.flatMap((p) => p.sessions) ?? [];
      const parentSession = allSessions.find((s) =>
        s.subAgents.some((sa) => sa.id === selectedId),
      );
      if (parentSession) setSelectedId(parentSession.id);
    }

    setSessionTree(tree);
    if (!node || !node.filePath) return;
    const newActivities = parseSessionHistory(node.filePath);
    const delta = newActivities.length - activitiesLengthRef.current;
    setActivities(newActivities);
    if (!isLive && delta > 0) {
      setScrollOffset((o) => o + delta);
      setNewCount((n) => n + delta);
    }
  }, [selectedId, isLive, expandedIds]);

  // Keep a stable ref so the watcher callback always calls the latest refresh
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // Auto-refresh in watch mode: fs.watch on macOS/Windows, polling fallback on Linux
  useEffect(() => {
    if (!isWatchMode) return;

    const projectsDir = getProjectsDir();
    const usePolling = process.platform === "linux" || !existsSync(projectsDir);

    if (usePolling) {
      const timer = setInterval(
        () => refreshRef.current(),
        config.refreshIntervalMs,
      );
      return () => clearInterval(timer);
    }

    let debounce: ReturnType<typeof setTimeout> | null = null;
    let watcher: FSWatcher | null = null;
    try {
      watcher = watch(projectsDir, { recursive: true }, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => refreshRef.current(), 150);
      });
    } catch {
      // If watch() fails for any reason, fall back to polling
      const timer = setInterval(
        () => refreshRef.current(),
        config.refreshIntervalMs,
      );
      return () => clearInterval(timer);
    }

    return () => {
      watcher?.close();
      if (debounce) clearTimeout(debounce);
    };
  }, [isWatchMode, config.refreshIntervalMs]);

  const filterPresets = config.filterPresets;
  const activePreset = useMemo(
    () => filterPresets[filterIndex % filterPresets.length] ?? [],
    [filterPresets, filterIndex],
  );
  const filterLabel = useMemo(
    () => (activePreset.length === 0 ? "all" : activePreset.join("+")),
    [activePreset],
  );

  const mergedActivities = useMemo(() => {
    const merged = [...activities, ...gitActivities].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
    if (activePreset.length === 0) return merged;
    return merged.filter(
      (a) =>
        activePreset.includes(a.type) ||
        (a.type === "tool" &&
          activePreset.some((p) => a.label.toLowerCase() === p)),
    );
  }, [activities, gitActivities, activePreset]);

  const selectedIndex = allFlat.findIndex((s) => s.id === selectedId);
  const height = (stdout?.rows ?? 41) - 1;
  const width = stdout?.columns ?? 80;
  const maxTreeRows = Math.floor(height * (1 - VIEWER_HEIGHT_FRACTION));
  const naturalTreeRows = allFlat.length;
  const treeRows = Math.max(1, Math.min(naturalTreeRows, maxTreeRows));
  // statusBar(1) + margin(1) + tree(treeRows+2) + margin(1) + viewer(viewerRows+2) = height
  const viewerRows = Math.max(5, height - 7 - treeRows);

  const saveLog = useCallback(() => {
    if (!activities.length || !selectedId) return;
    ensureLogDir(config.logDir);
    const date = new Date().toISOString().slice(0, 10);
    const filePath = join(
      config.logDir,
      `${date}-${selectedId.slice(0, 8)}.txt`,
    );
    const lines = activities.map(
      (a) => `[${a.timestamp.toISOString()}] ${a.icon} ${a.label} ${a.detail}`,
    );
    try {
      writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
    } catch {
      // silently fail — log dir may not be writable
    }
  }, [activities, selectedId, config.logDir]);

  const spinner = useSpinner(isWatchMode);
  const { handleInput, statusBarItems } = useHotkeys({
    focus,
    detailMode,
    helpMode,
    onHelp: () => setHelpMode((m) => !m),
    onSwitchFocus: () => setFocus((f) => (f === "tree" ? "viewer" : "tree")),
    onScrollUp: () => {
      if (focus === "tree") {
        if (selectedIndex === -1) return;
        const prev = Math.max(0, selectedIndex - 1);
        setSelectedId(allFlat[prev]?.id ?? selectedId);
      } else {
        if (viewerCursorLine > 0) {
          setViewerCursorLine((c) => c - 1);
        } else {
          // cursor at top — scroll viewport toward newer
          setScrollOffset((o) => {
            const newOffset = Math.max(0, o - 1);
            if (newOffset === 0) {
              setIsLive(true);
              setNewCount(0);
            }
            return newOffset;
          });
        }
      }
    },
    onScrollDown: () => {
      if (focus === "tree") {
        if (selectedIndex === -1) return;
        const next = Math.min(allFlat.length - 1, selectedIndex + 1);
        setSelectedId(allFlat[next]?.id ?? selectedId);
      } else {
        if (viewerCursorLine < viewerRows - 1) {
          setViewerCursorLine((c) => c + 1);
        } else {
          // cursor at bottom — scroll viewport toward older
          setIsLive(false);
          setScrollOffset((o) =>
            Math.min(o + 1, Math.max(0, activities.length - viewerRows)),
          );
        }
      }
    },
    onScrollPageUp: () => {
      if (focus === "tree") {
        const prev = Math.max(0, selectedIndex - 5);
        setSelectedId(allFlat[prev]?.id ?? selectedId);
      } else {
        setViewerCursorLine(0);
        setScrollOffset((o) => {
          const newOffset = Math.max(0, o - viewerRows);
          if (newOffset === 0) {
            setIsLive(true);
            setNewCount(0);
          }
          return newOffset;
        });
      }
    },
    onScrollPageDown: () => {
      if (focus === "tree") {
        const next = Math.min(allFlat.length - 1, selectedIndex + 5);
        setSelectedId(allFlat[next]?.id ?? selectedId);
      } else {
        setViewerCursorLine(0);
        setIsLive(false);
        setScrollOffset((o) =>
          Math.min(o + viewerRows, Math.max(0, activities.length - viewerRows)),
        );
      }
    },
    onScrollHalfPageUp: () => {
      if (focus === "tree") {
        const prev = Math.max(0, selectedIndex - Math.ceil(5 / 2));
        setSelectedId(allFlat[prev]?.id ?? selectedId);
      } else {
        setViewerCursorLine(0);
        setScrollOffset((o) => {
          const newOffset = Math.max(0, o - Math.floor(viewerRows / 2));
          if (newOffset === 0) {
            setIsLive(true);
            setNewCount(0);
          }
          return newOffset;
        });
      }
    },
    onScrollHalfPageDown: () => {
      if (focus === "tree") {
        const next = Math.min(
          allFlat.length - 1,
          selectedIndex + Math.ceil(5 / 2),
        );
        setSelectedId(allFlat[next]?.id ?? selectedId);
      } else {
        setViewerCursorLine(0);
        setIsLive(false);
        setScrollOffset((o) =>
          Math.min(
            o + Math.floor(viewerRows / 2),
            Math.max(0, activities.length - viewerRows),
          ),
        );
      }
    },
    onScrollTop: () => {
      // g = live (newest = visual top)
      setViewerCursorLine(0);
      setIsLive(true);
      setScrollOffset(0);
      setNewCount(0);
    },
    onScrollBottom: () => {
      // G = oldest (visual bottom)
      setViewerCursorLine(0);
      setIsLive(false);
      setScrollOffset(Math.max(0, mergedActivities.length - viewerRows));
    },
    onDetailClose: () => {
      setDetailMode(false);
    },
    onDetailScrollUp: () => {
      setDetailScrollOffset((o) => Math.max(0, o - 1));
    },
    onDetailScrollDown: () => {
      setDetailScrollOffset((o) => o + 1);
    },
    onEnter: () => {
      if (focus === "viewer") {
        const act = getSelectedActivity(
          mergedActivities,
          isLive,
          scrollOffset,
          viewerRows,
          viewerCursorLine,
        );
        if (act) {
          if (act.type === "commit") {
            const node = allFlatRef.current.find((s) => s.id === selectedId);
            const detail = node?.projectPath
              ? (getCommitDetail(node.projectPath, act.label) ?? act.detail)
              : act.detail;
            setDetailActivity({ ...act, detail });
          } else {
            setDetailActivity(act);
          }
          setDetailMode(true);
          setDetailScrollOffset(0);
        }
        return;
      }
      if (focus !== "tree" || !selectedId) return;

      // Project sentinel: __proj-{projectName}__
      if (selectedId.startsWith("__proj-") && selectedId.endsWith("__")) {
        const projectName = selectedId.slice(7, -2);
        const isCold = sessionTree.coldProjects.some(
          (p) => p.name === projectName,
        );
        const toggleKey = isCold
          ? `__expanded-${selectedId}`
          : `__collapsed-${selectedId}`;
        setExpandedIds((prev) => {
          const next = new Set(prev);
          if (next.has(toggleKey)) {
            next.delete(toggleKey);
          } else {
            next.add(toggleKey);
          }
          return next;
        });
        return;
      }

      if (selectedId === "__cold__") {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          if (next.has("__cold__")) {
            next.delete("__cold__");
          } else {
            next.add("__cold__");
          }
          return next;
        });
        return;
      }

      // Sub-agent summary sentinel: __sub-{parentId}__
      if (selectedId.startsWith("__sub-") && selectedId.endsWith("__")) {
        const parentId = selectedId.slice(6, -2);
        setExpandedIds((prev) => {
          const next = new Set(prev);
          if (next.has(parentId)) {
            next.delete(parentId);
            // Collapsing: move selection back to parent session
            setSelectedId(parentId);
          } else {
            next.add(parentId);
            // Expanding: move to first newly visible (cool/cold) sub-agent
            const allSessions2 =
              sessionTree.projects?.flatMap((p) => p.sessions) ?? [];
            const parent = allSessions2.find((s) => s.id === parentId);
            const firstNew = parent?.subAgents.find(
              (sa) => sa.status === "cool" || sa.status === "cold",
            );
            if (firstNew) setSelectedId(firstNew.id);
          }
          return next;
        });
        return;
      }

      // Parent session: toggle whole-session collapse (alive) or expand (cold)
      const allSessions3 = [
        ...sessionTree.projects.flatMap((p) => p.sessions),
        ...sessionTree.coldProjects.flatMap((p) => p.sessions),
      ];
      const selectedSessionObj = allSessions3.find((s) => s.id === selectedId);

      if (selectedSessionObj && selectedSessionObj.subAgents.length > 0) {
        const isCold = selectedSessionObj.status === "cold";
        const toggleKey = isCold
          ? `__expanded-session-${selectedId}`
          : `__collapsed-session-${selectedId}`;
        setExpandedIds((prev) => {
          const next = new Set(prev);
          if (next.has(toggleKey)) {
            next.delete(toggleKey);
            // Collapsing alive session: move selection to parent session
            if (!isCold) setSelectedId(selectedId);
          } else {
            next.add(toggleKey);
            // Expanding cold session: move to first sub-agent
            if (isCold) {
              const firstSub = selectedSessionObj.subAgents[0];
              if (firstSub) setSelectedId(firstSub.id);
            }
          }
          return next;
        });
        return;
      }
    },
    onHide: () => {
      if (focus !== "tree" || !selectedId) return;

      // Project sentinel: hide entire project
      if (selectedId.startsWith("__proj-") && selectedId.endsWith("__")) {
        const projectName = selectedId.slice(7, -2); // strip __proj- and trailing __
        hideProject(projectName);
        refresh();
        const nextId =
          allFlat[selectedIndex + 1]?.id ??
          allFlat[selectedIndex - 1]?.id ??
          null;
        setSelectedId(nextId);
        return;
      }

      if (selectedId === "__cold__") {
        const coldSessions =
          sessionTree.coldProjects?.flatMap((p) => p.sessions) ?? [];
        for (const s of coldSessions) hideSession(s.hideKey);
        // __cold__ and everything below it disappears — move up
        const nextId = allFlat[selectedIndex - 1]?.id ?? null;
        refresh();
        setSelectedId(nextId);
        return;
      }

      const allSessions4 =
        sessionTree.projects?.flatMap((p) => p.sessions) ?? [];
      const selectedSession = allSessions4.find((s) => s.id === selectedId);
      if (selectedSession) {
        hideSession(selectedSession.hideKey);
        const nextId =
          allFlat[selectedIndex + 1]?.id ??
          allFlat[selectedIndex - 1]?.id ??
          null;
        refresh();
        setSelectedId(nextId);
        return;
      }

      for (const s of allSessions4) {
        const selectedSubAgent = s.subAgents.find((sa) => sa.id === selectedId);
        if (selectedSubAgent) {
          hideSubAgent(selectedSubAgent.hideKey);
          const nextId =
            allFlat[selectedIndex + 1]?.id ??
            allFlat[selectedIndex - 1]?.id ??
            null;
          refresh();
          setSelectedId(nextId);
          return;
        }
      }
    },
    onSaveLog: saveLog,
    onRefresh: refresh,
    onQuit: exit,
    onFilter: () => setFilterIndex((i) => (i + 1) % filterPresets.length),
    filterLabel,
  });

  useInput((input, key) => handleInput(input, key), { isActive: isWatchMode });

  const rawSelected = allFlat.find((s) => s.id === selectedId);
  // For project sentinels, resolve to the project's hottest session so the
  // viewer title matches what's actually being displayed.
  const isProjectSentinel =
    !!selectedId &&
    selectedId.startsWith("__proj-") &&
    selectedId.endsWith("__");
  let selectedSession = rawSelected;
  if (isProjectSentinel && selectedId) {
    const projectName = selectedId.slice(7, -2);
    const project =
      sessionTree.projects.find((p) => p.name === projectName) ??
      sessionTree.coldProjects.find((p) => p.name === projectName);
    if (project && project.sessions.length > 0) {
      selectedSession = project.sessions[0];
    }
  }
  const isPlaceholderSelected =
    !selectedSession ||
    selectedId === "__cold__" ||
    (!!selectedId &&
      selectedId.startsWith("__sub-") &&
      selectedId.endsWith("__"));
  const sessionDisplayName =
    isPlaceholderSelected || !selectedSession
      ? "No session selected"
      : selectedSession.projectPath
        ? selectedSession.projectName || selectedSession.id.slice(0, 8)
        : (selectedSession.agentId ?? selectedSession.id.slice(0, 8));

  return (
    <Box flexDirection="column">
      {isWatchMode && (
        <Box marginBottom={1} justifyContent="space-between" width={width}>
          <Text dimColor>
            {spinner} AgentHUD v{getVersion()}
          </Text>
          <Text dimColor>{statusBarItems.join(" · ")}</Text>
        </Box>
      )}

      {helpMode ? (
        <HelpPanel width={width} height={height - 2} />
      ) : (
        <>
          {migrationWarning && (
            <Box marginBottom={1}>
              <Text color="yellow">
                Config moved to ~/.agenthud/config.yaml
              </Text>
            </Box>
          )}

          <SessionTreePanel
            projects={sessionTree.projects ?? []}
            coldProjects={sessionTree.coldProjects ?? []}
            selectedId={selectedId}
            hasFocus={focus === "tree"}
            width={width}
            maxRows={treeRows}
            expandedIds={expandedIds}
          />

          <Box marginTop={1}>
            {detailMode && detailActivity ? (
              <DetailViewPanel
                activity={detailActivity}
                sessionName={sessionDisplayName}
                scrollOffset={detailScrollOffset}
                visibleRows={viewerRows}
                width={width}
              />
            ) : (
              <ActivityViewerPanel
                activities={mergedActivities}
                sessionName={sessionDisplayName}
                scrollOffset={scrollOffset}
                isLive={isLive}
                newCount={newCount}
                visibleRows={viewerRows}
                width={width}
                cursorLine={viewerCursorLine}
                hasFocus={focus === "viewer"}
                spinner={spinner}
                filterLabel={filterLabel}
              />
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
