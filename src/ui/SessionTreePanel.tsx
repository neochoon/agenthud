/**
 * Top panel: renders the project tree — projects → sessions →
 * sub-agents — with status badges, elapsed time, model name, and
 * the active selection highlight.
 *
 * Design decisions:
 * - Cold projects collapse into a single
 *   `... N cold projects` sentinel at the bottom of the tree, not
 *   per-project. Enter on that sentinel expands the entire cold
 *   group at once. Reason: a single user usually has 10–30 cold
 *   projects scattered over time; per-row expansion turns the
 *   tree into mostly grayed noise.
 * - Sub-agents under cold sessions group under a
 *   `__sub-parent__` sentinel; Enter on the cold session expands
 *   them all (must agree with App's `appendSubAgentRows` rule —
 *   see App.tsx's gotcha).
 * - Right-edge column reserves 3 cells of padding so the
 *   project/session title doesn't run flush against the
 *   elapsed/model column. Improves readability at every width.
 *
 * Gotcha:
 * - Width-aware title truncation uses display *cells* (CJK-aware
 *   via `getDisplayWidth`), not JavaScript character count. A
 *   `.length`-based truncation would chop CJK strings at the
 *   wrong width and leave bare half-width remnants.
 */

import { homedir } from "node:os";
import { Box, Text } from "ink";
import type React from "react";
import type {
  ProjectNode,
  SessionNode,
  SessionStatus,
  TreeCensus,
} from "../types/index.js";
import {
  BOX,
  createBottomLine,
  createTitleLine,
  DEFAULT_PANEL_WIDTH,
  getDisplayWidth,
  getInnerWidth,
  truncateByWidth,
} from "./constants.js";

export interface SessionTreePanelProps {
  projects: ProjectNode[];
  coldProjects: ProjectNode[];
  selectedId: string | null;
  hasFocus: boolean;
  width?: number;
  maxRows?: number;
  expandedIds?: Set<string>;
  /**
   * When true the panel renders a `[LIVE …]` indicator (with spinner) in
   * its title bar — same affordance as the activity viewer. Set by App
   * while tracking mode is on so the user knows the tree is auto-following.
   */
  trackingOn?: boolean;
  /** One-character spinner frame shown next to LIVE when trackingOn. */
  spinner?: string;
  /**
   * When set, the title bar renders as `Projects [<scopeLabel>]` to signal
   * that the view is filtered to a single project (typically by --cwd).
   */
  scopeLabel?: string;
  /**
   * Tree-wide counts rendered inside the title bar — projects /
   * sessions / sub-agents totals with their visible-active subset,
   * plus hidden total + hidden active. When the panel is wide
   * enough the full long form is shown; when it isn't, the title
   * falls back to short form (e.g. `68s (5)`) and finally drops
   * segments from the right until only `Projects` is left. The
   * `(N active)` hidden alert is preserved as long as possible.
   */
  census?: TreeCensus;
}

/**
 * Compact relative-time label for the tree's right edge. Coarsens as the
 * elapsed time grows so cold sessions stop showing "27h35m" and become
 * "1d", "1w", "1mo", "1y". `now` is injectable so tests can pin time.
 */
export function formatElapsed(
  lastModifiedMs: number,
  now = Date.now(),
): string {
  const elapsed = Math.max(0, now - lastModifiedMs);
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years >= 1) return `${years}y`;
  if (months >= 1) return `${months}mo`;
  if (weeks >= 1) return `${weeks}w`;
  if (days >= 1) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  if (seconds > 0) return `${seconds}s`;
  return "<1s";
}

function getStatusColor(status: SessionStatus): string {
  switch (status) {
    case "hot":
      return "green";
    case "warm":
      return "yellow";
    case "cool":
      return "cyan";
    case "cold":
      return "gray";
  }
}

export function getBadge(session: SessionNode): {
  text: string;
  color: string;
} {
  if (session.liveState === "working")
    return { text: "[working]", color: "green" };
  if (session.liveState === "waiting")
    return { text: "[waiting]", color: "magenta" };
  return { text: `[${session.status}]`, color: getStatusColor(session.status) };
}

interface SessionRowProps {
  session: SessionNode;
  isSelected: boolean;
  hasFocus: boolean;
  prefix: string;
  contentWidth: number;
}

function formatProjectPath(projectPath: string): string {
  const home = homedir();
  const raw = projectPath.startsWith(home)
    ? `~${projectPath.slice(home.length)}`
    : projectPath;
  return raw;
}

function truncatePath(path: string, maxWidth: number): string {
  if (getDisplayWidth(path) <= maxWidth) return path;
  if (maxWidth < 4) return "";
  return `...${path.slice(-(maxWidth - 3))}`;
}

function SessionRow({
  session,
  isSelected,
  hasFocus,
  prefix,
  contentWidth,
}: SessionRowProps): React.ReactElement {
  const isParent = prefix === "    ";
  const { text: badge, color: badgeColor } = getBadge(session);
  const elapsed = formatElapsed(session.lastModifiedMs);
  const model = session.modelName ?? "";
  const isNonInteractive = session.nonInteractive;

  // Name: parent uses short ID (project name is shown on the project header), sub-agent uses agentId or short ID
  const rawName = isParent
    ? isNonInteractive
      ? `(#${session.id.slice(0, 4)})`
      : `#${session.id.slice(0, 4)}`
    : (session.agentId ?? session.id.slice(0, 8));

  // Short ID is now the name itself for parent sessions; no separate suffix needed
  const shortIdDisplay = "";

  const rightParts: string[] = [elapsed];
  if (model) rightParts.push(model);
  const rightSide = rightParts.join(" ");

  // `⊘ ` marker (2 cells) precedes the badge for hidden items so
  // they're recognizable at a glance when `showHidden` is on.
  const hiddenMarker = session.hidden ? "⊘ " : "";
  const leftCoreBase = `${prefix}${rawName}${shortIdDisplay} ${hiddenMarker}${badge}`;
  const leftCoreWidth = getDisplayWidth(leftCoreBase);
  const rightWidth = getDisplayWidth(rightSide);

  // Reserve a small fixed gap on the right so the title doesn't run flush
  // against the elapsed/model column — improves scan-ability across a row.
  const RIGHT_GAP = 3;
  // Middle text sits right after badge; reserve 1 space prefix + RIGHT_GAP.
  const middleAvailable =
    contentWidth - leftCoreWidth - 1 - rightWidth - RIGHT_GAP;

  // Middle text: first user prompt for parents, task description for sub-agents.
  // Use width-aware truncation that keeps the beginning and appends "…" so the
  // most informative part of a long prompt / description stays visible.
  let middleText = "";
  if (middleAvailable > 1) {
    const raw = isParent
      ? (session.firstUserPrompt ?? "")
      : (session.taskDescription ?? "");
    if (raw) {
      // Collapse internal newlines/tabs so the title is single-line.
      const flat = raw.replace(/[\r\n\t]+/g, " ").trim();
      const truncated = truncateByWidth(flat, middleAvailable);
      if (truncated) middleText = truncated;
    }
  }

  const middleSection = middleText ? ` ${middleText}` : "";
  const gapWidth = Math.max(
    RIGHT_GAP,
    contentWidth - leftCoreWidth - getDisplayWidth(middleSection) - rightWidth,
  );
  const gap = " ".repeat(gapWidth);

  const fullLine = leftCoreBase + middleSection + gap + rightSide;
  const linePadding = Math.max(0, contentWidth - getDisplayWidth(fullLine));

  const focused = isSelected && hasFocus;
  const muted = isSelected && !hasFocus;
  const showBg = focused || muted;
  const shouldDim = isNonInteractive || muted || !!session.hidden;

  return (
    <Text>
      {BOX.v}{" "}
      <Text
        backgroundColor={showBg ? "blue" : undefined}
        bold={focused}
        dimColor={shouldDim && !focused}
      >
        <Text dimColor={shouldDim && !focused}>{prefix}</Text>
        <Text bold={!shouldDim}>{rawName}</Text>
        {shortIdDisplay ? <Text dimColor>{shortIdDisplay}</Text> : null}
        <Text> </Text>
        {session.hidden ? <Text dimColor>{"⊘ "}</Text> : null}
        <Text color={badgeColor}>{badge}</Text>
        {middleText ? <Text dimColor>{middleSection}</Text> : null}
        <Text>{gap}</Text>
        <Text dimColor>{elapsed}</Text>
        {model ? <Text dimColor>{` ${model}`}</Text> : null}
      </Text>
      {" ".repeat(linePadding)}
      {BOX.v}
    </Text>
  );
}

type FlatRow =
  | { kind: "project"; project: ProjectNode; sentinelId: string }
  | { kind: "session"; session: SessionNode; prefix: string }
  | {
      kind: "subagent-summary";
      parentId: string;
      coolCount: number;
      coldCount: number;
    }
  | { kind: "cold-projects-summary"; count: number };

function appendSessionRows(
  result: FlatRow[],
  session: SessionNode,
  expandedIds: Set<string>,
): void {
  const isCold = session.status === "cold";

  // Session-level collapse/expand state
  const sessionCollapsedKey = `__collapsed-session-${session.id}`;
  const sessionExpandedKey = `__expanded-session-${session.id}`;
  const sessionHidden = isCold
    ? !expandedIds.has(sessionExpandedKey) // cold default: hidden
    : expandedIds.has(sessionCollapsedKey); // alive default: visible

  if (sessionHidden) return;

  // Sub-agent display: existing summary-row logic.
  // A cold session that was explicitly expanded also shows all sub-agents inline.
  const subAgentsFullyExpanded =
    expandedIds.has(session.id) ||
    (isCold && expandedIds.has(sessionExpandedKey));
  const hotWarm = session.subAgents.filter(
    (s) => s.status === "hot" || s.status === "warm",
  );
  const cool = session.subAgents.filter((s) => s.status === "cool");
  const cold = session.subAgents.filter((s) => s.status === "cold");

  if (subAgentsFullyExpanded) {
    const all = [...hotWarm, ...cool, ...cold];
    for (let i = 0; i < all.length; i++) {
      const isLast = i === all.length - 1;
      result.push({
        kind: "session",
        session: all[i],
        prefix: `        ${isLast ? "└─ " : "├─ "}» `,
      });
    }
  } else {
    const hasSummary = cool.length > 0 || cold.length > 0;
    for (let i = 0; i < hotWarm.length; i++) {
      const isLast = i === hotWarm.length - 1 && !hasSummary;
      result.push({
        kind: "session",
        session: hotWarm[i],
        prefix: `        ${isLast ? "└─ " : "├─ "}» `,
      });
    }
    if (hasSummary) {
      result.push({
        kind: "subagent-summary",
        parentId: session.id,
        coolCount: cool.length,
        coldCount: cold.length,
      });
    }
  }
}

function flattenSessions(
  projects: ProjectNode[],
  coldProjects: ProjectNode[],
  expandedIds: Set<string>,
): FlatRow[] {
  const result: FlatRow[] = [];

  for (const project of projects) {
    const sentinelId = `__proj-${project.name}__`;
    result.push({ kind: "project", project, sentinelId });
    // Projects default EXPANDED. Collapse only when explicitly collapsed.
    const collapsed = expandedIds.has(`__collapsed-${sentinelId}`);
    if (!collapsed) {
      for (const session of project.sessions) {
        result.push({ kind: "session", session, prefix: "    " });
        appendSessionRows(result, session, expandedIds);
      }
    }
  }

  if (coldProjects.length > 0) {
    result.push({ kind: "cold-projects-summary", count: coldProjects.length });
    if (expandedIds.has("__cold__")) {
      for (const project of coldProjects) {
        const sentinelId = `__proj-${project.name}__`;
        result.push({ kind: "project", project, sentinelId });
        // Cold projects default COLLAPSED — show sessions only when explicitly expanded
        const expanded = expandedIds.has(`__expanded-${sentinelId}`);
        if (expanded) {
          for (const session of project.sessions) {
            result.push({ kind: "session", session, prefix: "    " });
            appendSessionRows(result, session, expandedIds);
          }
        }
      }
    }
  }

  return result;
}

function ProjectRow({
  project,
  isSelected,
  hasFocus,
  contentWidth,
}: {
  project: ProjectNode;
  isSelected: boolean;
  hasFocus: boolean;
  contentWidth: number;
}): React.ReactElement {
  const nameText = `> ${project.hidden ? "⊘ " : ""}${project.name}`;
  const pathText = project.projectPath
    ? formatProjectPath(project.projectPath)
    : "";
  // Project "elapsed" = how long since any of its sessions last moved.
  // Use the max mtime so a fresh non-interactive session can still mark
  // the project as recent, even when the sort puts it after an older
  // interactive one.
  const latestMtime = project.sessions.reduce(
    (acc, s) => Math.max(acc, s.lastModifiedMs),
    0,
  );
  const elapsed = latestMtime > 0 ? formatElapsed(latestMtime) : "";

  const nameWidth = getDisplayWidth(nameText);
  const pathWidth = pathText ? getDisplayWidth(pathText) : 0;
  const elapsedWidth = elapsed ? getDisplayWidth(elapsed) : 0;
  // 2 spaces between name and path; gap pushes elapsed to the right edge.
  const middleGap = pathText ? 2 : 0;
  const leftWidth = nameWidth + middleGap + pathWidth;
  // Min right gap mirrors SessionRow so the layout's right column has the
  // same breathing room across the tree.
  const PROJECT_RIGHT_GAP = 3;
  const rightGap = Math.max(
    PROJECT_RIGHT_GAP,
    contentWidth - leftWidth - elapsedWidth,
  );
  const totalWidth = leftWidth + rightGap + elapsedWidth;
  const padding = Math.max(0, contentWidth - totalWidth);
  const focused = isSelected && hasFocus;
  const muted = isSelected && !hasFocus;
  const showBg = focused || muted;
  const dim = muted || !!project.hidden;
  return (
    <Text>
      {BOX.v}{" "}
      <Text
        backgroundColor={showBg ? "blue" : undefined}
        bold={!showBg && !project.hidden}
        dimColor={dim}
      >
        {nameText}
        {pathText ? (
          <>
            {"  "}
            <Text dimColor>{pathText}</Text>
          </>
        ) : null}
        {" ".repeat(rightGap)}
        {elapsed ? <Text dimColor>{elapsed}</Text> : null}
        {" ".repeat(padding)}
      </Text>
      {BOX.v}
    </Text>
  );
}

function SubagentSummaryRow({
  coolCount,
  coldCount,
  contentWidth,
  isSelected,
  hasFocus,
}: {
  coolCount: number;
  coldCount: number;
  contentWidth: number;
  isSelected: boolean;
  hasFocus: boolean;
}): React.ReactElement {
  const parts: string[] = [];
  if (coolCount > 0) parts.push(`${coolCount} cool`);
  if (coldCount > 0) parts.push(`${coldCount} cold`);
  const hint = " +";
  const text = `        └─ ... ${parts.join("  ")}`;
  const padding = Math.max(
    0,
    contentWidth - getDisplayWidth(text) - getDisplayWidth(hint),
  );
  const focused = isSelected && hasFocus;
  const muted = isSelected && !hasFocus;
  return (
    <Text>
      {BOX.v}{" "}
      <Text dimColor={!focused} inverse={focused || muted}>
        {text}
        {" ".repeat(padding)}
        {hint}
      </Text>
      {BOX.v}
    </Text>
  );
}

function ColdProjectsSummaryRow({
  count,
  isSelected,
  hasFocus,
  width,
}: {
  count: number;
  isSelected: boolean;
  hasFocus: boolean;
  width: number;
}): React.ReactElement {
  const innerWidth = getInnerWidth(width);
  const label = ` ${count} cold `;
  const hint = isSelected && hasFocus ? " + " : "";
  const hintWidth = getDisplayWidth(hint);
  const labelWidth = getDisplayWidth(label);
  const dashCount = Math.max(0, innerWidth - 1 - labelWidth - hintWidth);
  const dashes = BOX.h.repeat(dashCount);
  const line = `${BOX.ml}${BOX.h}${label}${dashes}${hint}${BOX.mr}`;
  const focused = isSelected && hasFocus;
  const muted = isSelected && !hasFocus;
  return (
    <Text
      backgroundColor={focused || muted ? "blue" : undefined}
      bold={focused}
      dimColor={!focused}
    >
      {line}
    </Text>
  );
}

interface TitleSegment {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
}

function activeParen(count: number, short: boolean): TitleSegment[] {
  if (count === 0) return [];
  return [
    { text: " (", dim: true },
    {
      text: short ? `${count}` : `${count} active`,
      color: "green",
      bold: true,
    },
    { text: ")", dim: true },
  ];
}

function hiddenSeg(
  hidden: { total: number; active: number },
  short: boolean,
): TitleSegment[] {
  if (hidden.total === 0) return [];
  const segs: TitleSegment[] = [
    { text: ` · ⊘ ${hidden.total}`, dim: true },
  ];
  if (!short) segs.push({ text: " hidden", dim: true });
  if (hidden.active > 0) {
    segs.push({ text: " (", dim: true });
    segs.push({
      text: short ? `${hidden.active}` : `${hidden.active} active`,
      color: "yellow",
      bold: true,
    });
    segs.push({ text: ")", dim: true });
  }
  return segs;
}

/**
 * Build the styled segment list for the Projects panel title under
 * a target available width. Produces a list of candidates from
 * "full long form" down to "just the label", each progressively
 * shorter, and returns the first one that fits. The hidden alert
 * (`(N active)` on the hidden segment) is preserved longest because
 * it's the most actionable signal.
 *
 * Style rule: only the **active counts** are bold + colored (green
 * for visible, yellow for hidden alert). Everything else — label,
 * totals, parens, separators, the `⊘` glyph, the word "hidden" —
 * stays plain dim. This is what makes the actionable numbers pop
 * visually; mixing bold into the non-alert parts blurs the signal
 * and makes the dim parens look comparatively bright.
 */
export function buildTitleSegments(
  label: string,
  census: TreeCensus | undefined,
  availableWidth: number,
): TitleSegment[] {
  const labelSeg: TitleSegment = { text: label, dim: true };
  if (!census) return [labelSeg];

  const widthOf = (segs: TitleSegment[]) =>
    segs.reduce((w, s) => w + getDisplayWidth(s.text), 0);

  const c = census;

  // From most to least verbose. First candidate that fits wins.
  // First segment drops the word "projects" because the panel label
  // already says "Projects" — `Projects 12 (3 active)` reads
  // naturally as "12 projects, 3 active". Sessions and sub-agents
  // keep their words since the label doesn't disambiguate them.
  const candidates: TitleSegment[][] = [
    // L0: full long form
    [
      labelSeg,
      { text: ` ${c.projects.total}`, dim: true },
      ...activeParen(c.projects.active, false),
      { text: ` · ${c.sessions.total} sessions`, dim: true },
      ...activeParen(c.sessions.active, false),
      { text: ` · ${c.subAgents.total} sub-agents`, dim: true },
      ...activeParen(c.subAgents.active, false),
      ...hiddenSeg(c.hidden, false),
    ],
    // L1: short form everywhere (s, a abbreviations; no "active" word)
    [
      labelSeg,
      { text: ` ${c.projects.total}`, dim: true },
      ...activeParen(c.projects.active, true),
      { text: ` · ${c.sessions.total}s`, dim: true },
      ...activeParen(c.sessions.active, true),
      { text: ` · ${c.subAgents.total}a`, dim: true },
      ...activeParen(c.subAgents.active, true),
      ...hiddenSeg(c.hidden, true),
    ],
    // L2: drop sub-agents
    [
      labelSeg,
      { text: ` ${c.projects.total}`, dim: true },
      ...activeParen(c.projects.active, true),
      { text: ` · ${c.sessions.total}s`, dim: true },
      ...activeParen(c.sessions.active, true),
      ...hiddenSeg(c.hidden, true),
    ],
    // L3: drop sessions
    [
      labelSeg,
      { text: ` ${c.projects.total}`, dim: true },
      ...activeParen(c.projects.active, true),
      ...hiddenSeg(c.hidden, true),
    ],
    // L4: drop project active counter
    [
      labelSeg,
      { text: ` ${c.projects.total}`, dim: true },
      ...hiddenSeg(c.hidden, true),
    ],
    // L5: drop project total
    [labelSeg, ...hiddenSeg(c.hidden, true)],
    // L6: just the label
    [labelSeg],
  ];

  for (const cand of candidates) {
    if (widthOf(cand) <= availableWidth) return cand;
  }
  return candidates[candidates.length - 1];
}

export function SessionTreePanel({
  projects,
  coldProjects,
  selectedId,
  hasFocus,
  width = DEFAULT_PANEL_WIDTH,
  maxRows,
  expandedIds = new Set(),
  trackingOn = false,
  spinner = "",
  scopeLabel,
  census,
}: SessionTreePanelProps): React.ReactElement {
  const innerWidth = getInnerWidth(width);
  const contentWidth = innerWidth - 1; // account for space after │

  // Same affordance the activity viewer uses for LIVE: when tracking is on
  // the tree's title shows `[LIVE ⠧]` so the user knows the selection is
  // moving on its own.
  const titleSuffix = trackingOn ? `[LIVE ${spinner || "▼"}]` : "";
  const titleLabel = scopeLabel ? `Projects [${scopeLabel}]` : "Projects";

  // Title structure (no suffix): `┌─ <segments> <dashes>┐`
  //   Overhead = 1 (┌) + 1 (─) + 1 ( ) + 1 ( ) + 1 (┐) = 5 chars
  // With suffix:                 `┌─ <segments> <dashes> <suffix> ─┐`
  //   Overhead = 5 + 1 ( ) + suffixLen + 1 ( ) + 1 (─) = 8 + suffixLen
  const suffixLen = titleSuffix ? getDisplayWidth(titleSuffix) : 0;
  const overhead = titleSuffix ? 8 + suffixLen : 5;
  const titleAvailable = Math.max(0, width - overhead);
  const titleSegments = buildTitleSegments(
    titleLabel,
    census,
    titleAvailable,
  );
  const titleContentWidth = titleSegments.reduce(
    (w, s) => w + getDisplayWidth(s.text),
    0,
  );
  const titleDashCount = Math.max(0, titleAvailable - titleContentWidth);
  const bottomLine = createBottomLine(width);

  const totalProjectCount = projects.length + coldProjects.length;

  if (totalProjectCount === 0) {
    const emptyText = "No Claude sessions";
    const emptyPadding = Math.max(0, contentWidth - emptyText.length);
    return (
      <Box flexDirection="column" width={width}>
        <Text>
          {`${BOX.tl}${BOX.h} `}
          {titleSegments.map((seg, i) => (
            <Text
              key={`title-${i}`}
              color={seg.color}
              dimColor={seg.dim}
              bold={seg.bold}
            >
              {seg.text}
            </Text>
          ))}
          <Text>{` ${BOX.h.repeat(titleDashCount)}`}</Text>
          {titleSuffix ? <Text>{` ${titleSuffix} `}</Text> : null}
          {BOX.tr}
        </Text>
        <Text>
          {BOX.v} <Text dimColor>{emptyText}</Text>
          {" ".repeat(emptyPadding)}
          {BOX.v}
        </Text>
        <Text>{bottomLine}</Text>
      </Box>
    );
  }

  const flatRows = flattenSessions(projects, coldProjects, expandedIds);
  const totalRows = flatRows.length;

  // Find the index of the currently selected row
  const selectedFlatIndex = flatRows.findIndex((row) => {
    if (row.kind === "project") return selectedId === row.sentinelId;
    if (row.kind === "session") return row.session.id === selectedId;
    if (row.kind === "subagent-summary")
      return selectedId === `__sub-${row.parentId}__`;
    if (row.kind === "cold-projects-summary") return selectedId === "__cold__";
    return false;
  });

  // Compute scrollTop so the selected row stays visible
  const needsOverflow = maxRows !== undefined && totalRows > maxRows;
  const visibleCount = needsOverflow ? maxRows - 1 : totalRows;
  let scrollTop = 0;
  if (needsOverflow && selectedFlatIndex >= 0) {
    scrollTop = Math.max(0, selectedFlatIndex - visibleCount + 1);
    scrollTop = Math.min(scrollTop, Math.max(0, totalRows - visibleCount));
  }

  const displayRows = flatRows.slice(scrollTop, scrollTop + visibleCount);
  const hiddenBelow = totalRows - (scrollTop + displayRows.length);

  return (
    <Box flexDirection="column" width={width}>
      <Text>
        {`${BOX.tl}${BOX.h} `}
        {titleSegments.map((seg, i) => (
          <Text
            key={`title-${i}`}
            color={seg.color}
            dimColor={seg.dim}
            bold={seg.bold}
          >
            {seg.text}
          </Text>
        ))}
        <Text>{` ${BOX.h.repeat(titleDashCount)}`}</Text>
        {titleSuffix ? <Text>{` ${titleSuffix} `}</Text> : null}
        {BOX.tr}
      </Text>
      {displayRows.map((row, idx) =>
        row.kind === "project" ? (
          <ProjectRow
            key={`project-${row.project.name}-${idx}`}
            project={row.project}
            isSelected={selectedId === row.sentinelId}
            hasFocus={hasFocus}
            contentWidth={contentWidth}
          />
        ) : row.kind === "session" ? (
          <SessionRow
            key={`${row.session.id}-${idx}`}
            session={row.session}
            isSelected={row.session.id === selectedId}
            hasFocus={hasFocus}
            prefix={row.prefix}
            contentWidth={contentWidth}
          />
        ) : row.kind === "subagent-summary" ? (
          <SubagentSummaryRow
            key={`subagent-summary-${idx}`}
            coolCount={row.coolCount}
            coldCount={row.coldCount}
            contentWidth={contentWidth}
            isSelected={selectedId === `__sub-${row.parentId}__`}
            hasFocus={hasFocus}
          />
        ) : (
          <ColdProjectsSummaryRow
            key="cold-summary"
            count={row.count}
            isSelected={selectedId === "__cold__"}
            hasFocus={hasFocus}
            width={width}
          />
        ),
      )}
      {hiddenBelow > 0 && (
        <Text>
          {BOX.v} <Text dimColor>{`... ${hiddenBelow} more`}</Text>
          {" ".repeat(
            Math.max(0, contentWidth - `... ${hiddenBelow} more`.length - 1),
          )}
          {BOX.v}
        </Text>
      )}
      <Text>{bottomLine}</Text>
    </Box>
  );
}
