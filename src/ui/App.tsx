// src/ui/App.tsx
import { writeFileSync } from "node:fs";
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
import { discoverSessions } from "../data/sessions.js";
import type {
  ActivityEntry,
  SessionNode,
  SessionTree,
} from "../types/index.js";
import { ActivityViewerPanel } from "./ActivityViewerPanel.js";
import { useHotkeys } from "./hooks/useHotkeys.js";
import { SessionTreePanel } from "./SessionTreePanel.js";

const VIEWER_HEIGHT_FRACTION = 0.55;

function flattenSessions(
  tree: SessionTree,
  expandedIds: Set<string>,
): SessionNode[] {
  const result: SessionNode[] = [];

  const visible = tree.sessions.filter((s) => s.status !== "cold");
  const cold = tree.sessions.filter((s) => s.status === "cold");

  for (const s of visible) {
    result.push(s);
    if (expandedIds.has(s.id)) {
      result.push(...s.subAgents);
    } else {
      result.push(
        ...s.subAgents.filter(
          (sub) => sub.status === "hot" || sub.status === "warm",
        ),
      );
    }
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
        if (expandedIds.has(s.id)) {
          result.push(...s.subAgents);
        } else {
          result.push(
            ...s.subAgents.filter(
              (sub) => sub.status === "hot" || sub.status === "warm",
            ),
          );
        }
      }
    }
  }

  return result;
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
    if (node && node.filePath) {
      setActivities(parseSessionHistory(node.filePath));
      setScrollOffset(0);
      setIsLive(true);
      setNewCount(0);
    } else {
      setActivities([]);
    }
  }, [selectedId]);

  const refresh = useCallback(() => {
    const tree = discoverSessions(config);
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
  }, [config, selectedId, isLive, expandedIds]);

  // Auto-refresh in watch mode
  useEffect(() => {
    if (!isWatchMode) return;
    const timer = setInterval(refresh, config.refreshIntervalMs);
    return () => clearInterval(timer);
  }, [isWatchMode, refresh, config.refreshIntervalMs]);

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
    onSwitchFocus: () => setFocus((f) => (f === "tree" ? "viewer" : "tree")),
    onScrollUp: () => {
      if (focus === "tree") {
        const prev = Math.max(0, selectedIndex - 1);
        setSelectedId(allFlat[prev]?.id ?? selectedId);
      } else {
        // ↑ = toward newer (decrease offset, newest is at top)
        setScrollOffset((o) => {
          const newOffset = Math.max(0, o - 1);
          if (newOffset === 0) {
            setIsLive(true);
            setNewCount(0);
          }
          return newOffset;
        });
      }
    },
    onScrollDown: () => {
      if (focus === "tree") {
        const next = Math.min(allFlat.length - 1, selectedIndex + 1);
        setSelectedId(allFlat[next]?.id ?? selectedId);
      } else {
        // ↓ = toward older (increase offset, newest is at top)
        setIsLive(false);
        setScrollOffset((o) =>
          Math.min(o + 1, Math.max(0, activities.length - viewerRows)),
        );
      }
    },
    onScrollPageUp: () => {
      if (focus === "tree") {
        const prev = Math.max(0, selectedIndex - 5);
        setSelectedId(allFlat[prev]?.id ?? selectedId);
      } else {
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
        setIsLive(false);
        setScrollOffset((o) =>
          Math.min(o + viewerRows, Math.max(0, activities.length - viewerRows)),
        );
      }
    },
    onScrollTop: () => {
      setIsLive(false);
      setScrollOffset(Math.max(0, activities.length - viewerRows));
    },
    onScrollBottom: () => {
      // G = jump to newest (live, scrollOffset 0)
      setIsLive(true);
      setScrollOffset(0);
      setNewCount(0);
    },
    onEnter: () => {
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
        refresh();
        return;
      }

      if (sessionTree.sessions.some((s) => s.id === selectedId)) {
        hideSession(selectedId);
        refresh();
        return;
      }

      for (const s of sessionTree.sessions) {
        if (s.subAgents.some((sa) => sa.id === selectedId)) {
          hideSubAgent(selectedId);
          refresh();
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
  const sessionDisplayName =
    !selectedSession || selectedId === "__cold__"
      ? "No session selected"
      : selectedSession.projectName ||
        `agent-${selectedSession.id.slice(0, 6)}`;

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
        <ActivityViewerPanel
          activities={activities}
          sessionName={sessionDisplayName}
          scrollOffset={scrollOffset}
          isLive={isLive}
          newCount={newCount}
          visibleRows={viewerRows}
          width={width}
        />
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
