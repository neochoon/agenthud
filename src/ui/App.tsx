// src/ui/App.tsx
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "../cli.js";
import {
  ensureLogDir,
  hasProjectLevelConfig,
  loadGlobalConfig,
} from "../config/globalConfig.js";
import { discoverSessions } from "../data/sessions.js";
import { parseSessionHistory } from "../data/sessionHistory.js";
import type { ActivityEntry, SessionNode, SessionTree } from "../types/index.js";
import { ActivityViewerPanel } from "./ActivityViewerPanel.js";
import { SessionTreePanel } from "./SessionTreePanel.js";
import { useHotkeys } from "./hooks/useHotkeys.js";

const VIEWER_HEIGHT_FRACTION = 0.55;

function flattenSessions(tree: SessionTree): SessionNode[] {
  const result: SessionNode[] = [];
  for (const s of tree.sessions) {
    result.push(s);
    result.push(...s.subAgents);
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

  const allFlat = useMemo(() => flattenSessions(sessionTree), [sessionTree]);

  // Load activities whenever selected session changes
  useEffect(() => {
    const node = allFlat.find((s) => s.id === selectedId);
    if (node) {
      setActivities(parseSessionHistory(node.filePath));
      setScrollOffset(0);
      setIsLive(true);
    } else {
      setActivities([]);
    }
  }, [selectedId, allFlat]);

  const refresh = useCallback(() => {
    const tree = discoverSessions(config);
    setSessionTree(tree);
    const updatedFlat = flattenSessions(tree);
    const node = updatedFlat.find((s) => s.id === selectedId);
    if (node && isLive) {
      setActivities(parseSessionHistory(node.filePath));
    }
  }, [config, selectedId, isLive]);

  // Auto-refresh in watch mode
  useEffect(() => {
    if (!isWatchMode) return;
    const timer = setInterval(refresh, config.refreshIntervalMs);
    return () => clearInterval(timer);
  }, [isWatchMode, refresh, config.refreshIntervalMs]);

  const selectedIndex = allFlat.findIndex((s) => s.id === selectedId);
  const height = stdout?.rows ?? 40;
  const width = stdout?.columns ?? 80;
  const viewerRows = Math.max(5, Math.floor(height * VIEWER_HEIGHT_FRACTION) - 4);

  const saveLog = useCallback(() => {
    if (!activities.length || !selectedId) return;
    ensureLogDir(config.logDir);
    const date = new Date().toISOString().slice(0, 10);
    const filePath = join(config.logDir, `${date}-${selectedId.slice(0, 8)}.txt`);
    const lines = activities.map(
      (a) => `[${a.timestamp.toISOString()}] ${a.icon} ${a.label} ${a.detail}`,
    );
    try {
      writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
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
        setIsLive(false);
        setScrollOffset((o) => o + 1);
      }
    },
    onScrollDown: () => {
      if (focus === "tree") {
        const next = Math.min(allFlat.length - 1, selectedIndex + 1);
        setSelectedId(allFlat[next]?.id ?? selectedId);
      } else {
        setScrollOffset((o) => {
          const newOffset = Math.max(0, o - 1);
          if (newOffset === 0) setIsLive(true);
          return newOffset;
        });
      }
    },
    onScrollTop: () => {
      setIsLive(false);
      setScrollOffset(Math.max(0, activities.length - viewerRows));
    },
    onScrollBottom: () => {
      setIsLive(true);
      setScrollOffset(0);
    },
    onSaveLog: saveLog,
    onRefresh: refresh,
    onQuit: exit,
  });

  useInput(
    (input, key) => handleInput(input, key),
    { isActive: isWatchMode },
  );

  const selectedSession = allFlat.find((s) => s.id === selectedId);
  const sessionDisplayName =
    selectedSession?.projectName ||
    (selectedId ? `agent-${selectedId.slice(0, 6)}` : "No session selected");

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
        onSelect={(id) => {
          setSelectedId(id);
          setFocus("viewer");
        }}
        width={width}
      />

      <Box marginTop={1}>
        <ActivityViewerPanel
          activities={activities}
          sessionName={sessionDisplayName}
          hasFocus={focus === "viewer"}
          scrollOffset={scrollOffset}
          isLive={isLive}
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
