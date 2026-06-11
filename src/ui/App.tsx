/**
 * Top-level Ink component. Owns the global state — sessions, selected
 * id, expand-state set, viewer scroll, focus, tracking — and wires the
 * background refresh: a ~2s poll plus a supplementary `fs.watch` on
 * the projects directory. Dispatches keystrokes to the right
 * sub-panel via `useHotkeys`.
 *
 * Design decisions:
 * - Inverse expansion. Hot/warm sessions and projects default to
 *   *expanded*; cold ones default to *collapsed*. Reason: on boot,
 *   the user almost always cares about today's hot work, not last
 *   month's cold tree. Enter toggles in either direction.
 * - Polling is primary; `fs.watch` is supplemental. macOS
 *   recursive `fs.watch` silently drops cross-project events, so
 *   the ~2s poll guarantees the tree converges within one
 *   interval even when the OS watcher missed an event.
 * - Tracking mode jumps only on *new* sub-agent ids (or when the
 *   current one cools). A naive "newest mtime" implementation
 *   loses every race to the already-busy sub-agent — the user
 *   selected it, it keeps writing fastest, tracking never
 *   advances. Snapshot the known-id set when tracking turns on,
 *   then chase additions to it.
 * - `appendSubAgentRows` is exported solely so the same expansion
 *   rule the renderer applies is pinned by unit test. Keeping the
 *   rule one-place-only (in the render code) makes drift between
 *   App's flattened nav list and SessionTreePanel's rendered list
 *   inevitable — and that drift is exactly what breaks j/k
 *   navigation silently.
 *
 * Gotcha:
 * - Cold-session sub-agent expansion uses its own flag
 *   (`__expanded-session-<id>`), separate from the global
 *   `expandedIds`. Both `appendSubAgentRows` here AND
 *   `SessionTreePanel:subAgentsFullyExpanded` must consult it or
 *   the renderer shows every sub-agent while App's nav list
 *   misses them (selectedIndex = -1, j/k go silent).
 */

// src/ui/App.tsx

import type { FSWatcher } from "node:fs";
import { existsSync, watch } from "node:fs";
import { basename } from "node:path";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "../cli.js";
import {
  hasProjectLevelConfig,
  hideProject,
  hideSession,
  hideSubAgent,
  unhideProject,
  unhideSession,
  unhideSubAgent,
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
  TreeCensus,
} from "../types/index.js";
import { ActivityViewerPanel } from "./ActivityViewerPanel.js";
import { getDisplayWidth } from "./constants.js";
import { DetailViewPanel } from "./DetailViewPanel.js";
import { HelpPanel } from "./HelpPanel.js";
import { useHotkeys } from "./hooks/useHotkeys.js";
import { useSpinner } from "./hooks/useSpinner.js";
import { useTick } from "./hooks/useTick.js";
import { SessionTreePanel } from "./SessionTreePanel.js";
import { adjustViewerCursorOnNewActivities } from "./viewerCursor.js";

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
    liveState: null,
  };
}

/**
 * Sentinel row for "N cold sessions" inside an active project.
 * Default collapsed: cold sessions are historical context, not
 * what the user is working on right now. Press Enter on the
 * sentinel to expand and reveal the individual cold sessions.
 */
function coldSessionsSummarySentinel(projectName: string): SessionNode {
  return {
    id: `__cold-sessions-${projectName}__`,
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
    liveState: null,
  };
}

/**
 * Append the sub-agent rows for `session` onto `result` per the same
 * expand-state rules the renderer uses. Exported for unit testing.
 *
 * Cold sessions hide their sub-agents by default and only show them
 * when the user explicitly expanded the session (Enter on the row,
 * which adds `__expanded-session-<id>` to expandedIds). When that flag
 * is present the entire sub-agent list is included — not just
 * hot/warm — to match the renderer.
 */
export function appendSubAgentRows(
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

  // Match SessionTreePanel's "subAgentsFullyExpanded" rule. A cold
  // session expanded via Enter writes `__expanded-session-<id>` to
  // expandedIds — that should produce the full sub-agent list here
  // too, otherwise the renderer shows every sub-agent but App's
  // allFlat misses them and j/k go silent (selectedIndex = -1).
  const subAgentsFullyExpanded =
    expandedIds.has(session.id) ||
    (isCold && expandedIds.has(sessionExpandedKey));

  if (subAgentsFullyExpanded) {
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

/**
 * Strip hidden items out of a `SessionTree` for the default render
 * path (when `showHidden` is off). Hidden items are KEPT in the
 * source tree from `discoverSessions` — this function produces the
 * "as visible to the user" view that the panel and the flatten/nav
 * list both consume. Pressing `a` toggles which side is shown.
 *
 * Cheap shallow copy — the nested arrays are filtered + spread but
 * leaf SessionNodes are reused by reference (immutable from our
 * perspective).
 */
export function filterTreeByHidden(tree: SessionTree): SessionTree {
  const visibleSession = (s: SessionNode): SessionNode => ({
    ...s,
    subAgents: s.subAgents.filter((sa) => !sa.hidden),
  });
  const visibleProject = (p: ProjectNode): ProjectNode => ({
    ...p,
    sessions: p.sessions.filter((s) => !s.hidden).map(visibleSession),
  });
  return {
    ...tree,
    projects: tree.projects.filter((p) => !p.hidden).map(visibleProject),
    coldProjects: tree.coldProjects
      .filter((p) => !p.hidden)
      .map(visibleProject),
  };
}

/**
 * Walk the full session tree and tally per-level totals + active
 * counts (hot/warm) plus a hidden subset. Drives the Projects-panel
 * title census line ("12 projects (3 active) · 68 sessions
 * (5 active) · 142 sub-agents (2 active) · ⊘ 14 hidden (1 active)").
 *
 * Counting rules:
 * - **Totals** include hidden items so the user sees their actual
 *   inventory regardless of `showHidden`.
 * - **Active counts** are *visible* only. A hidden hot session is
 *   not counted toward `sessions.active` — it belongs in the
 *   `hidden.active` bucket so the actionable signals stay
 *   separate.
 * - **Project active** = visible project with at least one visible
 *   hot/warm session.
 * - **Hidden** = any item (session or sub-agent) marked hidden, or
 *   any item under a hidden project.
 */
export function computeCensus(tree: SessionTree): TreeCensus {
  let projectsTotal = 0;
  let projectsActive = 0;
  let sessionsTotal = 0;
  let sessionsActive = 0;
  let subAgentsTotal = 0;
  let subAgentsActive = 0;
  let hiddenTotal = 0;
  let hiddenActive = 0;

  const isActive = (n: SessionNode) =>
    n.status === "hot" || n.status === "warm";

  for (const p of [...tree.projects, ...tree.coldProjects]) {
    projectsTotal++;
    let projectHasVisibleActive = false;
    for (const s of p.sessions) {
      sessionsTotal++;
      const sessionVisible = !s.hidden && !p.hidden;
      if (sessionVisible) {
        if (isActive(s)) {
          sessionsActive++;
          projectHasVisibleActive = true;
        }
      } else {
        hiddenTotal++;
        if (isActive(s)) hiddenActive++;
      }
      for (const sa of s.subAgents) {
        subAgentsTotal++;
        const saVisible = !sa.hidden && !s.hidden && !p.hidden;
        if (saVisible) {
          if (isActive(sa)) subAgentsActive++;
        } else {
          hiddenTotal++;
          if (isActive(sa)) hiddenActive++;
        }
      }
    }
    if (projectHasVisibleActive) projectsActive++;
  }

  return {
    projects: { total: projectsTotal, active: projectsActive },
    sessions: { total: sessionsTotal, active: sessionsActive },
    subAgents: { total: subAgentsTotal, active: subAgentsActive },
    hidden: { total: hiddenTotal, active: hiddenActive },
  };
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
      liveState: null,
    });

    const shouldShowSessions = isCold
      ? expandedIds.has(`__expanded-${sentinelId}`)
      : !expandedIds.has(`__collapsed-${sentinelId}`);

    if (shouldShowSessions) {
      // Active sessions are always shown. Cold sessions under an
      // ACTIVE project (isCold=false) get collapsed under a
      // `... N cold` sentinel by default — same pattern as
      // cold-projects-summary and cold-sub-agents-summary. When
      // the whole project is cold (isCold=true) the user has
      // already opted in to expanding it, so show everything.
      if (isCold) {
        for (const session of project.sessions) {
          result.push(session);
          appendSubAgentRows(result, session, expandedIds);
        }
      } else {
        const activeSessions = project.sessions.filter(
          (s) => s.status !== "cold",
        );
        const coldSessions = project.sessions.filter(
          (s) => s.status === "cold",
        );
        for (const session of activeSessions) {
          result.push(session);
          appendSubAgentRows(result, session, expandedIds);
        }
        if (coldSessions.length > 0) {
          const coldKey = `__cold-sessions-${project.name}__`;
          result.push(coldSessionsSummarySentinel(project.name));
          if (expandedIds.has(coldKey)) {
            for (const session of coldSessions) {
              result.push(session);
              appendSubAgentRows(result, session, expandedIds);
            }
          }
        }
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
      liveState: null,
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

/**
 * Pick the initial selection for the tree. Prefers the first live
 * project; falls back to the cold-group sentinel when only cold
 * projects exist so j/k aren't silent no-ops at boot (selectedIndex
 * would be -1 against an empty hot list and the navigation handlers
 * short-circuit on that).
 */
/**
 * Pick the selection target for "jump up one level" (left arrow / `h`)
 * given the current selected id.
 *
 * - Sub-agent row → the parent session it belongs to.
 * - Sub-summary sentinel (`__sub-<sid>__`) → that session.
 * - Plain session row → the project sentinel that contains it.
 * - Project sentinel / cold-projects sentinel → the previous flat row
 *   (acts like an up-arrow at the top level so users can still climb
 *   out of the project group they're sitting in).
 */
export function findParentTarget(
  currentId: string,
  tree: SessionTree,
  flat: SessionNode[],
): string | null {
  // sub-summary sentinel → parent session id encoded in the sentinel
  if (currentId.startsWith("__sub-") && currentId.endsWith("__")) {
    return currentId.slice("__sub-".length, -"__".length);
  }

  const allProjects = [...tree.projects, ...tree.coldProjects];
  const allSessions = allProjects.flatMap((p) => p.sessions);

  // sub-agent → containing session
  for (const session of allSessions) {
    if (session.subAgents.some((sa) => sa.id === currentId)) {
      return session.id;
    }
  }

  // session → project sentinel
  for (const project of allProjects) {
    if (project.sessions.some((s) => s.id === currentId)) {
      return `__proj-${project.name}__`;
    }
  }

  // project sentinel / cold-projects sentinel / unknown row →
  // previous row in the flat list. Falls back to current when already
  // at the top so the cursor doesn't jump to a phantom id.
  const idx = flat.findIndex((row) => row.id === currentId);
  if (idx <= 0) return currentId;
  return flat[idx - 1]?.id ?? currentId;
}

export function initialSelectedId(tree: SessionTree): string | null {
  const firstProject = tree.projects[0];
  if (firstProject) return `__proj-${firstProject.name}__`;
  if (tree.coldProjects.length > 0) return "__cold__";
  return null;
}

/**
 * Auto-expand the cold group when there are no live projects so the
 * user lands on a visible list of projects instead of a single
 * "N cold" summary row.
 */
export function initialExpandedIds(tree: SessionTree): Set<string> {
  if (tree.projects.length === 0 && tree.coldProjects.length > 0) {
    return new Set(["__cold__"]);
  }
  return new Set();
}

export function App({
  mode,
  scopeToProject,
}: {
  mode: "watch" | "once";
  scopeToProject?: string;
}): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const isWatchMode = mode === "watch";

  const config = useMemo(() => loadGlobalConfig(), []);
  const migrationWarning = useMemo(() => hasProjectLevelConfig(), []);

  const discoverOptions = useMemo(
    () => (scopeToProject ? { scopeToProject } : undefined),
    [scopeToProject],
  );

  const [sessionTree, setSessionTree] = useState<SessionTree>(() =>
    discoverSessions(config, discoverOptions),
  );
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    initialSelectedId(sessionTree),
  );
  const [focus, setFocus] = useState<"tree" | "viewer">("tree");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isLive, setIsLive] = useState(true);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [gitActivities, setGitActivities] = useState<ActivityEntry[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    initialExpandedIds(sessionTree),
  );
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

  // Show-hidden toggle (`a` key). When OFF (default), hidden items
  // are filtered out by `filterTreeByHidden` before render. When ON,
  // hidden items appear dimmed with a `⊘` marker and `H` on them
  // unhides instead of hiding. The full source tree from
  // `discoverSessions` always carries hidden items + their `hidden`
  // marks so toggling can flip the view instantly without a refetch.
  const [showHidden, setShowHidden] = useState(false);

  // Tree as the renderer sees it. Defaults to the hidden-stripped
  // view; flips to the full source tree when `showHidden` is on.
  const displayTree = useMemo(
    () => (showHidden ? sessionTree : filterTreeByHidden(sessionTree)),
    [sessionTree, showHidden],
  );

  // Per-level census of the FULL source tree (counts hidden items).
  // Rendered inside the Projects panel title bar.
  const census = useMemo(() => computeCensus(sessionTree), [sessionTree]);

  const allFlat = useMemo(
    () => flattenSessions(displayTree, expandedIds),
    [displayTree, expandedIds],
  );

  const allFlatRef = useRef<SessionNode[]>(allFlat);
  useEffect(() => {
    allFlatRef.current = allFlat;
  }, [allFlat]);

  const activitiesRef = useRef<ActivityEntry[]>(activities);
  useEffect(() => {
    activitiesRef.current = activities;
  }, [activities]);

  // Snapshot of the previous merged-activity count, used by the
  // cursor-anchor effect below. Refs (not state) because the value
  // changes per render but never needs to trigger one.
  const prevMergedCountRef = useRef(0);

  // Snapshot of the previous merged-activity count specifically for
  // the PAUSED-mode scrollOffset/newCount bump. Separate from
  // `prevMergedCountRef` because the cursor-anchor effect and the
  // paused-bump effect process the same delta from different angles
  // and at different times — sharing one ref creates a missed-update
  // race when both fire in the same render cycle.
  const prevPausedCountRef = useRef(0);

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
    const tree = discoverSessions(freshConfig, discoverOptions);
    // Tracking and flatten work on the *visible* slice so an
    // auto-jump doesn't land on a hidden hot session the user can't
    // see. The full tree (with hidden items) is still stored via
    // `setSessionTree` so `showHidden` can flip the view instantly.
    const trackingTree = showHidden ? tree : filterTreeByHidden(tree);
    const updatedFlat = flattenSessions(trackingTree, expandedIds);

    // Tracking mode: pick the next jump target with the new-id-aware
    // algorithm so we don't oscillate between two equally-active sub-agents.
    let nextSelected: string | null = selectedId;
    if (tracking) {
      const { target, ids } = pickTrackingTarget(
        trackingTree,
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
    setActivities(newActivities);
    // The PAUSED-mode delta bump for scrollOffset / newCount lives
    // in a centralized useEffect below — see `prevPausedCountRef`.
    // Keeping it out of here ensures the bump fires regardless of
    // which path updates activities (refresh or the redundant
    // useEffect 488 reparse on every sessionTree change).
  }, [selectedId, expandedIds, tracking, discoverOptions, showHidden]);

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

  // Keep the viewer cursor anchored to its activity when new entries
  // arrive in LIVE mode. Without this, the visible window auto-scrolls
  // to show new content but cursorLine stays at the same screen row —
  // the highlighted activity silently slides forward. When the cursor
  // would scroll off the top, the helper switches to PAUSED so the
  // view freezes on the same snapshot and the cursor's activity stays
  // put. Math is in viewerCursor.ts; this effect just feeds it the
  // current snapshot and applies the resulting state changes.
  //
  // State updates intentionally live at the top of the effect body
  // (not inside `setViewerCursorLine`'s functional updater) — mixing
  // side-effect setStates inside an updater can fire twice in Strict
  // Mode and double-count the auto-pause scroll/badge delta.
  useEffect(() => {
    const prev = prevMergedCountRef.current;
    prevMergedCountRef.current = mergedActivities.length;
    const result = adjustViewerCursorOnNewActivities({
      prevCursorLine: viewerCursorLine,
      prevActivityCount: prev,
      newActivityCount: mergedActivities.length,
      isLive,
      viewerRows,
    });
    if (result.cursorLine !== viewerCursorLine) {
      setViewerCursorLine(result.cursorLine);
    }
    if (result.autoPause) {
      setIsLive(false);
      setScrollOffset((o) => o + result.scrollDelta);
      setNewCount((n) => n + result.scrollDelta);
    }
  }, [mergedActivities.length, isLive, viewerRows, viewerCursorLine]);

  // While PAUSED, keep the view frozen on its current snapshot as new
  // entries arrive — bump `scrollOffset` and `newCount` by the delta
  // so (a) `activities.slice(end - rows, end)` keeps showing the same
  // window, and (b) the `+N↓` badge reflects how many new entries the
  // user has yet to catch up to.
  //
  // This used to live inline in `refresh` as the
  // `if (!isLive && delta > 0)` block, but that missed updates from
  // useEffect 488's "redundant" re-parse of the JSONL on every
  // sessionTree change. Hoisting it here means any source that grows
  // mergedActivities triggers the bump correctly.
  //
  // Coordination with the auto-PAUSE useEffect above:
  // - On the LIVE→PAUSED transition, auto-PAUSE bumps by the overflow
  //   amount and `prevPausedCountRef` was 0 (or the merged count
  //   before the transition). This effect runs in the SAME render
  //   with isLive still true (state hasn't propagated yet), so the
  //   `!isLive` guard skips the duplicate bump.
  // - On the next render with isLive=false, prev === current →
  //   delta=0, no bump. Auto-PAUSE noOps (cursor already at max).
  // - From then on, only this effect bumps as new entries arrive.
  useEffect(() => {
    const prev = prevPausedCountRef.current;
    prevPausedCountRef.current = mergedActivities.length;
    if (!isLive && mergedActivities.length > prev) {
      const delta = mergedActivities.length - prev;
      setScrollOffset((o) => o + delta);
      setNewCount((n) => n + delta);
    }
  }, [mergedActivities.length, isLive]);

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
          seenIdsRef.current = collectAllIds(displayTree);
          const { target } = pickTrackingTarget(
            displayTree,
            selectedId,
            seenIdsRef.current,
          );
          if (target) setSelectedId(target);
        }
        return next;
      });
    },
    trackingOn: tracking,
    onJumpToParent: () => {
      if (focus !== "tree") return;
      stopTracking();
      if (!selectedId) return;
      const target = findParentTarget(selectedId, displayTree, allFlat);
      if (target && target !== selectedId) setSelectedId(target);
    },
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
          // cursor at top of viewport — scroll viewport toward older.
          // Clamp against the merged length so git-merged entries at the
          // head of the stream stay reachable (the viewer renders
          // mergedActivities, not raw activities).
          setIsLive(false);
          setScrollOffset((o) =>
            Math.min(
              o + 1,
              Math.max(0, mergedActivities.length - viewerRows),
            ),
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
          Math.min(
            o + viewerRows,
            Math.max(0, mergedActivities.length - viewerRows),
          ),
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
            Math.max(0, mergedActivities.length - viewerRows),
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
    onDetailScrollHalfPageUp: () => {
      const step = Math.max(1, Math.floor(viewerRows / 2));
      setDetailScrollOffset((o) => Math.max(0, o - step));
    },
    onDetailScrollHalfPageDown: () => {
      // DetailViewPanel clamps the upper bound, so overshooting is safe.
      const step = Math.max(1, Math.floor(viewerRows / 2));
      setDetailScrollOffset((o) => o + step);
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
        const isCold = displayTree.coldProjects.some(
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

      // Cold-sessions summary sentinel: __cold-sessions-{projectName}__
      // Expand → reveal the individual cold sessions inline; collapse
      // → fold them back under the summary.
      if (
        selectedId.startsWith("__cold-sessions-") &&
        selectedId.endsWith("__")
      ) {
        setExpandedIds((prev) => {
          const next = new Set(prev);
          if (next.has(selectedId)) next.delete(selectedId);
          else next.add(selectedId);
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
              displayTree.projects?.flatMap((p) => p.sessions) ?? [];
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
        ...displayTree.projects.flatMap((p) => p.sessions),
        ...displayTree.coldProjects.flatMap((p) => p.sessions),
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

      // `H` toggles hidden state of the selected item: hide if
      // currently visible, unhide if currently hidden (only
      // reachable when `showHidden` is on). The full
      // `sessionTree` is consulted for lookups because the
      // displayed tree might have stripped the very item we want
      // to unhide.
      const nextAfterHide = () =>
        allFlat[selectedIndex + 1]?.id ??
        allFlat[selectedIndex - 1]?.id ??
        null;

      // Project sentinel
      if (selectedId.startsWith("__proj-") && selectedId.endsWith("__")) {
        const projectName = selectedId.slice(7, -2);
        const proj =
          sessionTree.projects.find((p) => p.name === projectName) ??
          sessionTree.coldProjects.find((p) => p.name === projectName);
        if (proj?.hidden) {
          unhideProject(projectName);
          refresh();
          // Selection stays — the project just becomes un-dimmed.
          return;
        }
        hideProject(projectName);
        refresh();
        setSelectedId(nextAfterHide());
        return;
      }

      if (selectedId === "__cold__") {
        // Mass-hide the cold group as a convenience (no toggle on
        // the cold sentinel — to unhide cold sessions, expand
        // them with `a` and toggle each one individually).
        const coldSessions =
          sessionTree.coldProjects?.flatMap((p) => p.sessions) ?? [];
        for (const s of coldSessions) hideSession(s.hideKey);
        const nextId = allFlat[selectedIndex - 1]?.id ?? null;
        refresh();
        setSelectedId(nextId);
        return;
      }

      // Sessions across active + cold (lookup in the FULL tree so
      // hidden items selected via show-hidden are findable).
      const allSessionsFull = [
        ...sessionTree.projects.flatMap((p) => p.sessions),
        ...sessionTree.coldProjects.flatMap((p) => p.sessions),
      ];
      const selectedSession = allSessionsFull.find(
        (s) => s.id === selectedId,
      );
      if (selectedSession) {
        if (selectedSession.hidden) {
          unhideSession(selectedSession.hideKey);
          refresh();
          return;
        }
        hideSession(selectedSession.hideKey);
        refresh();
        setSelectedId(nextAfterHide());
        return;
      }

      // Sub-agents
      for (const s of allSessionsFull) {
        const sa = s.subAgents.find((x) => x.id === selectedId);
        if (sa) {
          if (sa.hidden) {
            unhideSubAgent(sa.hideKey);
            refresh();
            return;
          }
          hideSubAgent(sa.hideKey);
          refresh();
          setSelectedId(nextAfterHide());
          return;
        }
      }
    },
    onToggleShowHidden: () => setShowHidden((on) => !on),
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
      displayTree.projects.find((p) => p.name === projectName) ??
      displayTree.coldProjects.find((p) => p.name === projectName);
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
        <Text
          dimColor
        >{`Minimum: ${MIN_WIDTH} cols × ${MIN_HEIGHT} rows`}</Text>
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
          // Top row: branding + spinner on the left, keybindings
          // on the right. Census moved into the Projects panel as
          // a non-selectable first content row.
          const branding = `${spinner} AgentHUD v${getVersion()}`;
          const sep = " · ";
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
            projects={displayTree.projects ?? []}
            coldProjects={displayTree.coldProjects ?? []}
            selectedId={selectedId}
            hasFocus={focus === "tree"}
            width={width}
            maxRows={treeRows}
            expandedIds={expandedIds}
            trackingOn={tracking}
            spinner={spinner}
            scopeLabel={scopeToProject ? basename(scopeToProject) : undefined}
            census={isWatchMode ? census : undefined}
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
