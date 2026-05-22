// src/ui/App.tsx

import type { FSWatcher } from "node:fs";
import { existsSync, watch } from "node:fs";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "../cli.js";
import {
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
import { getDisplayWidth } from "./constants.js";
import { DetailViewPanel } from "./DetailViewPanel.js";
import { HelpPanel } from "./HelpPanel.js";
import { useHotkeys } from "./hooks/useHotkeys.js";
import { useTick } from "./hooks/useTick.js";
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
  // Chronological slice (newest is the LAST entry). Mirror the panel: the
  // cursor is "entries back from the newest", so look up from the tail.
  let visible: ActivityEntry[];
  if (live) {
    visible = acts.slice(-rows);
  } else {
    const end = Math.max(0, acts.length - scrollOff);
    const start = Math.max(0, end - rows);
    visible = acts.slice(start, end);
  }
  const effectiveCursor = Math.min(cursorLine, visible.length - 1);
  return visible[visible.length - 1 - effectiveCursor] ?? null;
}

type LiveCandidate = { id: string; mtime: number; isNew: boolean };

/**
 * For tracking mode: pick the next jump target.
 *
 * 1. If any *new* hot/warm sub-agent (id not in `seen`) exists, jump to
 *    the newest of those — this is the "B just started" case.
 * 2. Else if no new sub-agent but a new parent session appeared, jump
 *    to the newest of those.
 * 3. Else if the currently selected id is still hot/warm, stay put —
 *    avoids the oscillation between two equally-active sub-agents.
 * 4. Else (current target died) jump to the newest live thing,
 *    sub-agent preferred over parent.
 *
 * Also returns the full set of ids observed in this tree so the caller
 * can update its "seen" snapshot.
 */
function pickTrackingTarget(
  tree: SessionTree,
  selectedId: string | null,
  seen: Set<string>,
): { target: string | null; ids: Set<string> } {
  const ids = new Set<string>();
  const liveSubs: LiveCandidate[] = [];
  const liveParents: LiveCandidate[] = [];

  for (const p of tree.projects) {
    for (const s of p.sessions) {
      ids.add(s.id);
      if (s.status === "hot" || s.status === "warm") {
        liveParents.push({
          id: s.id,
          mtime: s.lastModifiedMs,
          isNew: !seen.has(s.id),
        });
      }
      for (const sa of s.subAgents) {
        ids.add(sa.id);
        if (sa.status === "hot" || sa.status === "warm") {
          liveSubs.push({
            id: sa.id,
            mtime: sa.lastModifiedMs,
            isNew: !seen.has(sa.id),
          });
        }
      }
    }
  }

  const newest = (xs: LiveCandidate[]): string | null =>
    xs.length === 0
      ? null
      : xs.reduce((a, b) => (a.mtime > b.mtime ? a : b)).id;

  // 1. New live sub-agent wins.
  const newSubTarget = newest(liveSubs.filter((s) => s.isNew));
  if (newSubTarget) return { target: newSubTarget, ids };
  // 2. New live parent session.
  const newParentTarget = newest(liveParents.filter((p) => p.isNew));
  if (newParentTarget) return { target: newParentTarget, ids };

  // 3. Current selection still live → stay put.
  const currentIsLive =
    selectedId != null &&
    (liveSubs.some((s) => s.id === selectedId) ||
      liveParents.some((p) => p.id === selectedId));
  if (currentIsLive) return { target: null, ids };

  // 4. Current died (or never had one). Pick newest live thing,
  //    sub-agents preferred over parents.
  return {
    target: newest(liveSubs) ?? newest(liveParents),
    ids,
  };
}

/** Walk a tree and collect every session + sub-agent id. */
function collectAllIds(tree: SessionTree): Set<string> {
  const ids = new Set<string>();
  for (const p of tree.projects) {
    for (const s of p.sessions) {
      ids.add(s.id);
      for (const sa of s.subAgents) ids.add(sa.id);
    }
  }
  return ids;
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
  const [helpScroll, setHelpScroll] = useState(0);
  const helpTotalLinesRef = useRef(0);
  // Tracking mode: when on, the tree selection follows the newest live
  // sub-agent (or session, if no hot/warm sub-agent exists) across the
  // whole tree. Any explicit navigation key turns it off again.
  const [tracking, setTracking] = useState(false);
  // Snapshot of all session/sub-agent ids observed since tracking was
  // enabled. Used by pickTrackingTarget to distinguish "brand new" from
  // "already existed when we started watching" so we don't oscillate
  // between two equally-active sub-agents.
  const seenIdsRef = useRef<Set<string>>(new Set());

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

    // Tracking mode: pick the next jump target with the new-id-aware
    // algorithm so we don't oscillate between two equally-active sub-agents.
    let nextSelected: string | null = selectedId;
    if (tracking) {
      const { target, ids } = pickTrackingTarget(
        tree,
        selectedId,
        seenIdsRef.current,
      );
      if (target && target !== selectedId) {
        setSelectedId(target);
        nextSelected = target;
      }
      // Update the seen snapshot every refresh so the next round can
      // distinguish "new since last tick" from "existed already".
      seenIdsRef.current = ids;
    }

    // If selected item disappeared (e.g. sub-agent went cold), fall back to
    // its parent session so navigation doesn't snap to index 0.
    const node = updatedFlat.find((s) => s.id === nextSelected);
    if (!node) {
      const allSessions = tree.projects?.flatMap((p) => p.sessions) ?? [];
      const parentSession = allSessions.find((s) =>
        s.subAgents.some((sa) => sa.id === nextSelected),
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
  }, [selectedId, isLive, expandedIds, tracking]);

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

  // Tracking adds a 1-second polling timer on top of fs.watch. On macOS
  // recursive fs.watch can quietly drop events for files inside other
  // project directories — the polling guarantees the auto-follow finds
  // the new live target within a second regardless of how the OS event
  // delivery behaves.
  useEffect(() => {
    if (!isWatchMode || !tracking) return;
    const timer = setInterval(() => refreshRef.current(), 1000);
    return () => clearInterval(timer);
  }, [isWatchMode, tracking]);

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

  // Spinner and flashlight tick on the same cadence (150ms) so the entire
  // App re-renders ~6.7 times per second instead of 10 — measurably less
  // work for the terminal to repaint, and the two animations end up in
  // sync (a single React render advances both).
  const spinner = useSpinner(isWatchMode, 150);
  // Tick drives the moving-flashlight sweep on the live row. Gated tightly
  // — only ticks when the viewer is actually showing live activity AND the
  // user isn't in help / detail overlay. Without this gate the 100ms-per-
  // tick App re-render runs even when the sweep isn't visible, and the
  // accumulated work makes the sweep itself feel choppy.
  const tickActive =
    isWatchMode && isLive && !helpMode && !detailMode && activities.length > 0;
  const liveTick = useTick(tickActive, 150);
  const helpViewportRows = Math.max(1, height - 3); // status bar + indicator
  const helpScrollStep = (delta: number) => {
    const max = Math.max(0, helpTotalLinesRef.current - helpViewportRows);
    setHelpScroll((s) => Math.max(0, Math.min(max, s + delta)));
  };

  // Tracking turns off any time the user takes manual control of the
  // tree selection — j/k, PgUp/PgDn, h, Enter into a row, etc. Wrapping
  // the disable in a small helper makes the intent obvious at the call site.
  const stopTracking = () => {
    if (tracking) setTracking(false);
  };

  const { handleInput, statusBarItems } = useHotkeys({
    focus,
    detailMode,
    helpMode,
    onHelp: () => {
      setHelpScroll(0);
      setHelpMode((m) => !m);
    },
    onHelpScroll: helpScrollStep,
    onHelpScrollToTop: () => setHelpScroll(0),
    onToggleTracking: () => {
      setTracking((on) => {
        const next = !on;
        if (next) {
          // Seed the "seen" snapshot with everything currently in the tree
          // so the next refresh only treats genuinely-new sessions/sub-agents
          // as triggers. Then snap to the current newest live target so the
          // user sees tracking take effect immediately.
          seenIdsRef.current = collectAllIds(sessionTree);
          const { target } = pickTrackingTarget(
            sessionTree,
            selectedId,
            seenIdsRef.current,
          );
          if (target) setSelectedId(target);
        }
        return next;
      });
    },
    trackingOn: tracking,
    onSwitchFocus: () => setFocus((f) => (f === "tree" ? "viewer" : "tree")),
    // cursorLine = "entries back from the newest" (0 = newest = bottom row).
    // Up arrow moves visually upward = older direction = cursorLine++.
    // Down arrow moves visually downward = newer direction = cursorLine--.
    onScrollUp: () => {
      if (focus === "tree") {
        stopTracking();
        if (selectedIndex === -1) return;
        const prev = Math.max(0, selectedIndex - 1);
        setSelectedId(allFlat[prev]?.id ?? selectedId);
      } else {
        if (viewerCursorLine < viewerRows - 1) {
          setViewerCursorLine((c) => c + 1);
        } else {
          // cursor at top of viewport — scroll viewport toward older
          setIsLive(false);
          setScrollOffset((o) =>
            Math.min(o + 1, Math.max(0, activities.length - viewerRows)),
          );
        }
      }
    },
    onScrollDown: () => {
      if (focus === "tree") {
        stopTracking();
        if (selectedIndex === -1) return;
        const next = Math.min(allFlat.length - 1, selectedIndex + 1);
        setSelectedId(allFlat[next]?.id ?? selectedId);
      } else {
        if (viewerCursorLine > 0) {
          setViewerCursorLine((c) => c - 1);
        } else {
          // cursor at bottom (newest visible) — scroll viewport toward newer
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
    // PgUp/PgDn semantics flip to match the bottom-feed layout:
    // PgUp = visually up = older direction = scrollOffset++
    // PgDn = visually down = newer direction = scrollOffset--
    onScrollPageUp: () => {
      if (focus === "tree") {
        stopTracking();
        const prev = Math.max(0, selectedIndex - 5);
        setSelectedId(allFlat[prev]?.id ?? selectedId);
      } else {
        setViewerCursorLine(0);
        setIsLive(false);
        setScrollOffset((o) =>
          Math.min(o + viewerRows, Math.max(0, activities.length - viewerRows)),
        );
      }
    },
    onScrollPageDown: () => {
      if (focus === "tree") {
        stopTracking();
        const next = Math.min(allFlat.length - 1, selectedIndex + 5);
        setSelectedId(allFlat[next]?.id ?? selectedId);
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
    onScrollHalfPageUp: () => {
      if (focus === "tree") {
        stopTracking();
        const prev = Math.max(0, selectedIndex - Math.ceil(5 / 2));
        setSelectedId(allFlat[prev]?.id ?? selectedId);
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
    onScrollHalfPageDown: () => {
      if (focus === "tree") {
        stopTracking();
        const next = Math.min(
          allFlat.length - 1,
          selectedIndex + Math.ceil(5 / 2),
        );
        setSelectedId(allFlat[next]?.id ?? selectedId);
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
    onScrollTop: () => {
      // g = top of viewport = oldest visible; cursor lands on the top row
      // (which is the oldest visible — `viewerRows - 1` entries back from
      // the newest in the slice).
      setViewerCursorLine(Math.max(0, viewerRows - 1));
      setIsLive(false);
      setScrollOffset(Math.max(0, mergedActivities.length - viewerRows));
    },
    onScrollBottom: () => {
      // G = bottom of viewport = newest = live; cursor on the live edge.
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
      // Any explicit Enter in the tree is a deliberate action; stop tracking
      // so the user's chosen target doesn't get overwritten by the next refresh.
      stopTracking();

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
          // Going TO collapsed state for an alive session = adding toggleKey;
          // for a cold session = removing toggleKey. In either case we also
          // reset the per-session "show cool/cold sub-agents" flag so the
          // next re-expansion returns to the default (hot/warm visible, the
          // rest grouped under the sub-summary sentinel).
          if (isCold) {
            if (next.has(toggleKey)) {
              // currently expanded (cold case) → collapsing
              next.delete(toggleKey);
              next.delete(selectedId); // reset cold sub-agent expansion
            } else {
              next.add(toggleKey);
              const firstSub = selectedSessionObj.subAgents[0];
              if (firstSub) setSelectedId(firstSub.id);
            }
          } else {
            if (next.has(toggleKey)) {
              // currently collapsed (alive case) → expanding
              next.delete(toggleKey);
            } else {
              // currently expanded → collapsing
              next.add(toggleKey);
              next.delete(selectedId); // reset cold sub-agent expansion
              setSelectedId(selectedId);
            }
          }
          return next;
        });
        return;
      }
    },
    onHide: () => {
      if (focus !== "tree" || !selectedId) return;
      stopTracking();

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

  const MIN_WIDTH = 80;
  const MIN_HEIGHT = 20;
  if (isWatchMode && (width < MIN_WIDTH || height + 1 < MIN_HEIGHT)) {
    return (
      <Box flexDirection="column" width={width}>
        <Text bold>AgentHUD needs a larger terminal.</Text>
        <Text dimColor>{`Minimum: ${MIN_WIDTH} cols × ${MIN_HEIGHT} rows`}</Text>
        <Text dimColor>{`Current: ${width} cols × ${height + 1} rows`}</Text>
        <Text> </Text>
        <Text dimColor>
          Resize the window and AgentHUD will redraw automatically.
        </Text>
        <Text dimColor>Press q to quit.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {isWatchMode &&
        (() => {
          const branding = `${spinner} AgentHUD v${getVersion()}`;
          const sep = " · ";
          // Trim shortcut items from the FRONT until they fit. Items at the
          // end (?: help, q: quit) are kept as long as possible.
          let items = statusBarItems;
          let shortcuts = items.join(sep);
          let showBranding = true;
          const fits = () =>
            (showBranding ? getDisplayWidth(branding) + 1 : 0) +
              getDisplayWidth(shortcuts) <=
            width;
          if (!fits()) showBranding = false;
          while (!fits() && items.length > 1) {
            items = items.slice(1);
            shortcuts = items.join(sep);
          }
          return (
            <Box marginBottom={1} justifyContent="space-between" width={width}>
              <Text dimColor>{showBranding ? branding : ""}</Text>
              <Text dimColor>{shortcuts}</Text>
            </Box>
          );
        })()}

      {helpMode ? (
        <HelpPanel
          width={width}
          height={height - 2}
          scrollOffset={helpScroll}
          onTotalLinesChange={(n) => {
            helpTotalLinesRef.current = n;
          }}
        />
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
            trackingOn={tracking}
            spinner={spinner}
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
                liveSpinnerFrame={spinner}
                liveTick={liveTick}
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
