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
  hideSession,
  hideSubAgent,
  loadGlobalConfig,
} from "../config/globalConfig.js";
import { parseSessionHistory } from "../data/sessionHistory.js";
import { discoverSessions, getProjectsDir } from "../data/sessions.js";
import type {
  ActivityEntry,
  SessionNode,
  SessionTree,
} from "../types/index.js";
import { ActivityViewerPanel } from "./ActivityViewerPanel.js";
import { DetailViewPanel } from "./DetailViewPanel.js";
import { useHotkeys } from "./hooks/useHotkeys.js";
import { SessionTreePanel } from "./SessionTreePanel.js";

const VIEWER_HEIGHT_FRACTION = 0.55;

function subSummarySentinel(parentId: string): SessionNode {
  return {
    id: `__sub-${parentId}__`,
    filePath: "",
    projectPath: "",
    projectName: "",
    lastModifiedMs: 0,
    status: "cold",
    modelName: null,
    subAgents: [],
  };
}

function appendSubAgentRows(
  result: SessionNode[],
  session: SessionNode,
  expandedIds: Set<string>,
): void {
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

  const visible = tree.sessions.filter((s) => s.status !== "cold");
  const cold = tree.sessions.filter((s) => s.status === "cold");

  for (const s of visible) {
    result.push(s);
    appendSubAgentRows(result, s, expandedIds);
  }

  if (cold.length > 0) {
    // Sentinel node — makes the cold summary row keyboard-navigable.
    result.push({
      id: "__cold__",
      filePath: "",
      projectPath: "",
      projectName: `${cold.length} cold`,
      lastModifiedMs: 0,
      status: "cold",
      modelName: null,
      subAgents: [],
    });
    if (expandedIds.has("__cold__")) {
      for (const s of cold) {
        result.push(s);
        appendSubAgentRows(result, s, expandedIds);
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
    const first = sessionTree.sessions[0];
    return first?.id ?? null;
  });
  const [focus, setFocus] = useState<"tree" | "viewer">("tree");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isLive, setIsLive] = useState(true);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [viewerCursorLine, setViewerCursorLine] = useState(0);
  const [detailMode, setDetailMode] = useState(false);
  const [detailActivity, setDetailActivity] = useState<ActivityEntry | null>(
    null,
  );
  const [detailScrollOffset, setDetailScrollOffset] = useState(0);

  const allFlat = useMemo(
    () => flattenSessions(sessionTree, expandedIds),
    [sessionTree, expandedIds],
  );

  const allFlatRef = useRef<SessionNode[]>(allFlat);
  useEffect(() => {
    allFlatRef.current = allFlat;
  }, [allFlat]);

  const activitiesLengthRef = useRef(0);
  useEffect(() => {
    activitiesLengthRef.current = activities.length;
  }, [activities.length]);

  // Load activities whenever selected session changes
  useEffect(() => {
    const node = allFlatRef.current.find((s) => s.id === selectedId);
    if (node?.filePath) {
      setActivities(parseSessionHistory(node.filePath));
      setScrollOffset(0);
      setIsLive(true);
      setNewCount(0);
      setViewerCursorLine(0);
    } else {
      setActivities([]);
    }
  }, [selectedId]);

  const refresh = useCallback(() => {
    const freshConfig = loadGlobalConfig();
    const tree = discoverSessions(freshConfig);
    setSessionTree(tree);
    const updatedFlat = flattenSessions(tree, expandedIds);
    const node = updatedFlat.find((s) => s.id === selectedId);
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

  const selectedIndex = allFlat.findIndex((s) => s.id === selectedId);
  const height = stdout?.rows ?? 40;
  const width = stdout?.columns ?? 80;
  const viewerRows = Math.max(
    5,
    Math.floor(height * VIEWER_HEIGHT_FRACTION) - 4,
  );
  // sessions(N+2) + margin(1) + viewer(viewerRows+2) + margin(1) + statusBar(1) = height
  const treeRows = Math.max(3, height - viewerRows - 7);

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

  const { handleInput, statusBarItems } = useHotkeys({
    focus,
    detailMode,
    onSwitchFocus: () => setFocus((f) => (f === "tree" ? "viewer" : "tree")),
    onScrollUp: () => {
      if (focus === "tree") {
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
      setViewerCursorLine(0);
      setIsLive(false);
      setScrollOffset(Math.max(0, activities.length - viewerRows));
    },
    onScrollBottom: () => {
      // G = jump to newest (live, scrollOffset 0)
      setViewerCursorLine(0);
      setIsLive(true);
      setScrollOffset(0);
      setNewCount(0);
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
          activities,
          isLive,
          scrollOffset,
          viewerRows,
          viewerCursorLine,
        );
        if (act) {
          setDetailActivity(act);
          setDetailMode(true);
          setDetailScrollOffset(0);
        }
        return;
      }
      if (focus !== "tree" || !selectedId) return;

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
          } else {
            next.add(parentId);
          }
          return next;
        });
        return;
      }

      const parentSession = sessionTree.sessions.find(
        (s) => s.id === selectedId,
      );
      if (
        !parentSession ||
        !parentSession.subAgents.some(
          (s) => s.status === "cool" || s.status === "cold",
        )
      )
        return;
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(selectedId)) {
          next.delete(selectedId);
        } else {
          next.add(selectedId);
        }
        return next;
      });
    },
    onHide: () => {
      if (focus !== "tree" || !selectedId) return;

      if (selectedId === "__cold__") {
        const coldSessions = sessionTree.sessions.filter(
          (s) => s.status === "cold",
        );
        for (const s of coldSessions) hideSession(s.id);
        // __cold__ and everything below it disappears — move up
        const nextId = allFlat[selectedIndex - 1]?.id ?? null;
        refresh();
        setSelectedId(nextId);
        return;
      }

      if (sessionTree.sessions.some((s) => s.id === selectedId)) {
        hideSession(selectedId);
        const nextId =
          allFlat[selectedIndex + 1]?.id ??
          allFlat[selectedIndex - 1]?.id ??
          null;
        refresh();
        setSelectedId(nextId);
        return;
      }

      for (const s of sessionTree.sessions) {
        if (s.subAgents.some((sa) => sa.id === selectedId)) {
          hideSubAgent(selectedId);
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
  });

  useInput((input, key) => handleInput(input, key), { isActive: isWatchMode });

  const selectedSession = allFlat.find((s) => s.id === selectedId);
  const isPlaceholderSelected =
    !selectedSession ||
    selectedId === "__cold__" ||
    (!!selectedId &&
      selectedId.startsWith("__sub-") &&
      selectedId.endsWith("__"));
  const sessionDisplayName = isPlaceholderSelected
    ? "No session selected"
    : selectedSession.projectPath
      ? selectedSession.projectName || selectedSession.id.slice(0, 8)
      : (selectedSession.agentId ?? selectedSession.id.slice(0, 8));

  return (
    <Box flexDirection="column">
      {migrationWarning && (
        <Box marginBottom={1}>
          <Text color="yellow">Config moved to ~/.agenthud/config.yaml</Text>
        </Box>
      )}

      <SessionTreePanel
        sessions={sessionTree.sessions}
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
            activities={activities}
            sessionName={sessionDisplayName}
            scrollOffset={scrollOffset}
            isLive={isLive}
            newCount={newCount}
            visibleRows={viewerRows}
            width={width}
            cursorLine={viewerCursorLine}
            hasFocus={focus === "viewer"}
          />
        )}
      </Box>

      {isWatchMode && (
        <Box marginTop={1} justifyContent="space-between" width={width}>
          <Text dimColor>{statusBarItems.join(" · ")}</Text>
          <Text dimColor>AgentHUD v{getVersion()}</Text>
        </Box>
      )}
    </Box>
  );
}
