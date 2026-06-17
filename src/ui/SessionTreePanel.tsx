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

/**
 * "Alive" = at least one session OR one sub-agent on the project is
 * hot or warm. Drives ProjectRow's name styling — alive projects
 * read as bold-white, inert ones (everything cool/cold) render dim
 * so the eye lands on the rows that actually have running activity.
 * Sub-agents count because a hot sub-agent under a cool parent still
 * makes the project genuinely alive — it's where the work is.
 */
export function isProjectAlive(project: ProjectNode): boolean {
  const isActive = (status: SessionStatus): boolean =>
    status === "hot" || status === "warm";
  for (const s of project.sessions) {
    if (isActive(s.status)) return true;
    for (const sa of s.subAgents) {
      if (isActive(sa.status)) return true;
    }
  }
  return false;
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

  // Name: parent uses a short 4-char ID (project name is shown on the
  // project header); sub-agent uses its agentId truncated to 6 chars so it
  // no longer prints the long hex string Claude writes verbatim.
  const rawName = isParent
    ? isNonInteractive
      ? `(#${session.id.slice(0, 4)})`
      : `#${session.id.slice(0, 4)}`
    : (session.agentId ?? session.id).slice(0, 6);

  // Short ID is now the name itself for parent sessions; no separate suffix needed
  const shortIdDisplay = "";

  // Provider tag (top-level sessions only — sub-agents inherit their
  // parent's provider visually). Subtle dim-colored label sandwiched
  // between elapsed and model so users can tell at a glance which
  // CLI created the session. Claude rows get a gold tint (Anthropic
  // brand), Kiro rows magenta.
  const providerTag = isParent && session.provider ? session.provider : "";
  // Provider tint: Claude gold, both Kiro surfaces magenta (the
  // label text `kiro` vs `kiro-ide` carries the distinction), Codex
  // cyan. The colored label is dim, so it reads as quiet metadata.
  const providerColor = session.provider?.startsWith("kiro")
    ? "magenta"
    : session.provider === "claude"
      ? "yellow"
      : session.provider === "codex"
        ? "cyan"
        : undefined;

  // Context-window usage gauge. Shown on BOTH top-level sessions and
  // sub-agents (they have independent contexts). Color encodes
  // headroom: < 60% green (plenty), 60-85% yellow (watch), > 85%
  // red (compact imminent). Plain dim when undefined.
  const ctxPercent = session.contextUsage?.percent;
  const ctxTag = ctxPercent !== undefined ? `${ctxPercent}%` : "";
  const ctxColor: "green" | "yellow" | "red" | undefined =
    ctxPercent === undefined
      ? undefined
      : ctxPercent >= 85
        ? "red"
        : ctxPercent >= 60
          ? "yellow"
          : "green";

  const rightParts: string[] = [elapsed];
  if (ctxTag) rightParts.push(ctxTag);
  if (providerTag) rightParts.push(providerTag);
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
  // Dim everything that isn't "active" so the bold-bright rows match
  // the active count (hot + warm). cool/cold are recent-but-idle —
  // cool stays expanded and visible (unlike collapsed cold) but
  // renders dim, so it no longer reads as live when it isn't counted
  // as active. Also dims non-interactive / hidden / muted rows.
  const isIdle = session.status === "cool" || session.status === "cold";
  const shouldDim = isNonInteractive || muted || !!session.hidden || isIdle;

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
        {ctxTag ? <Text color={ctxColor}>{` ${ctxTag}`}</Text> : null}
        {providerTag ? (
          <Text color={providerColor} dimColor>
            {` ${providerTag}`}
          </Text>
        ) : null}
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
  | { kind: "cold-projects-summary"; count: number }
  | { kind: "cold-sessions-summary"; projectName: string; count: number };

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
      // Cold sessions under an ACTIVE project get collapsed under
      // a `... N cold` sentinel by default — same pattern as
      // cold-projects and cold-sub-agents. Active sessions
      // (non-cold) always show.
      const activeSessions = project.sessions.filter(
        (s) => s.status !== "cold",
      );
      const coldSessions = project.sessions.filter((s) => s.status === "cold");
      for (const session of activeSessions) {
        result.push({ kind: "session", session, prefix: "    " });
        appendSessionRows(result, session, expandedIds);
      }
      if (coldSessions.length > 0) {
        const coldKey = `__cold-sessions-${project.name}__`;
        result.push({
          kind: "cold-sessions-summary",
          projectName: project.name,
          count: coldSessions.length,
        });
        if (expandedIds.has(coldKey)) {
          for (const session of coldSessions) {
            result.push({ kind: "session", session, prefix: "    " });
            appendSessionRows(result, session, expandedIds);
          }
        }
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

/** A flattened row for a session RUNNING right now: a top-level session
 * that is working or waiting, or a sub-agent that is working (sub-agents
 * never surface "waiting" — `detectLiveState` in sessionLiveness.ts forces
 * a sub-agent's state to working|null). Pins key on liveState, NOT the
 * 30-min hot window, so finished-but-recent sub-agents don't flood the
 * band. `isParent` mirrors SessionRow's own `prefix === "    "` test. */
function isLiveSessionRow(
  row: FlatRow,
): row is Extract<FlatRow, { kind: "session" }> {
  if (row.kind !== "session") return false;
  const isParent = row.prefix === "    ";
  const ls = row.session.liveState;
  return isParent ? ls === "working" || ls === "waiting" : ls === "working";
}

function ProjectRow({
  project,
  isSelected,
  hasFocus,
  contentWidth,
  census,
}: {
  project: ProjectNode;
  isSelected: boolean;
  hasFocus: boolean;
  contentWidth: number;
  census?: TreeCensus;
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

  // Per-project counts rendered between path and elapsed. Two forms,
  // both with green `(N)` active-subset parens (hot+warm) matching
  // the panel-title census style: long ("5 sessions (2) · 142
  // sub-agents (3)") when wide enough, short ("5s (2) · 142a (3)")
  // when narrow, dropped entirely when nothing fits. The active
  // parens are omitted when the count is zero.
  //
  // Counts come from the SAME walk that produced the panel-title
  // census — `census.perProject` keyed by projectPath — so the row
  // and the title bar can never disagree. When census isn't
  // supplied (tests that render SessionTreePanel directly) we fall
  // back to counting the displayed tree inline.
  const isActive = (status: SessionStatus) =>
    status === "hot" || status === "warm";
  const entry = census?.perProject.get(project.projectPath);
  const sessionCount = entry ? entry.sessions.total : project.sessions.length;
  const activeSessionCount = entry
    ? entry.sessions.active
    : project.sessions.filter((s) => isActive(s.status)).length;
  const subAgentCount = entry
    ? entry.subAgents.total
    : project.sessions.reduce((n, s) => n + s.subAgents.length, 0);
  const activeSubAgentCount = entry
    ? entry.subAgents.active
    : project.sessions.reduce(
        (n, s) => n + s.subAgents.filter((sa) => isActive(sa.status)).length,
        0,
      );

  const buildCountsSegments = (short: boolean): TitleSegment[] => [
    {
      text: short ? `${sessionCount}s` : `${sessionCount} sessions`,
      dim: true,
    },
    ...activeParen(activeSessionCount, "green", { bold: false }),
    {
      text: short ? ` · ${subAgentCount}a` : ` · ${subAgentCount} sub-agents`,
      dim: true,
    },
    ...activeParen(activeSubAgentCount, "green", { bold: false }),
  ];
  const longSegs = buildCountsSegments(false);
  const shortSegs = buildCountsSegments(true);
  const segWidth = (segs: TitleSegment[]) =>
    segs.reduce((n, s) => n + getDisplayWidth(s.text), 0);

  const nameWidth = getDisplayWidth(nameText);
  const pathWidth = pathText ? getDisplayWidth(pathText) : 0;
  const elapsedWidth = elapsed ? getDisplayWidth(elapsed) : 0;
  const middleGap = pathText ? 2 : 0;
  const leftWidth = nameWidth + middleGap + pathWidth;
  const PROJECT_RIGHT_GAP = 3;
  const COUNTS_GAP = 2;

  const fitsCounts = (segs: TitleSegment[]) =>
    leftWidth +
      COUNTS_GAP +
      segWidth(segs) +
      PROJECT_RIGHT_GAP +
      elapsedWidth <=
    contentWidth;
  const countsSegs: TitleSegment[] | null = fitsCounts(longSegs)
    ? longSegs
    : fitsCounts(shortSegs)
      ? shortSegs
      : null;
  const countsWidth = countsSegs ? COUNTS_GAP + segWidth(countsSegs) : 0;

  const rightGap = Math.max(
    PROJECT_RIGHT_GAP,
    contentWidth - leftWidth - countsWidth - elapsedWidth,
  );
  const totalWidth = leftWidth + countsWidth + rightGap + elapsedWidth;
  const padding = Math.max(0, contentWidth - totalWidth);
  const focused = isSelected && hasFocus;
  const muted = isSelected && !hasFocus;
  const showBg = focused || muted;
  // Bold + bright name only when the project has live activity.
  // Cool/cold-only projects render dim so the eye lands on rows
  // where there's actually work in flight.
  const alive = isProjectAlive(project);
  const dim = muted || !!project.hidden || !alive;
  return (
    <Text>
      {BOX.v}{" "}
      <Text
        backgroundColor={showBg ? "blue" : undefined}
        bold={!showBg && !project.hidden && alive}
        dimColor={dim}
      >
        {nameText}
        {pathText ? (
          <>
            {"  "}
            <Text dimColor>{pathText}</Text>
          </>
        ) : null}
        {countsSegs ? (
          <>
            {" ".repeat(COUNTS_GAP)}
            {countsSegs.map((seg, i) => (
              <Text
                key={`pcnt-${i}`}
                color={seg.color}
                dimColor={seg.dim}
                bold={seg.bold}
              >
                {seg.text}
              </Text>
            ))}
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
  const baseText = `        └─ ... ${parts.join("  ")}`;
  const hint = " +";
  // Width-check the hint before appending so narrow terminals don't
  // overflow. Only the focused row offers the expand affordance, so
  // unfocused rows pad to width with spaces only.
  const focused = isSelected && hasFocus;
  const muted = isSelected && !hasFocus;
  const showHint =
    focused &&
    getDisplayWidth(baseText) + getDisplayWidth(hint) <= contentWidth;
  const text = showHint ? `${baseText}${hint}` : baseText;
  const padding = Math.max(0, contentWidth - getDisplayWidth(text));
  return (
    <Text>
      {BOX.v}{" "}
      <Text dimColor={!focused} inverse={focused || muted}>
        {text}
        {" ".repeat(padding)}
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

/**
 * "... N cold" row inserted under an active project to collapse
 * its cold-status sessions. Indented to match session row depth so
 * the visual hierarchy reads as "this is part of the project
 * above, but folded down to save vertical space". Press Enter to
 * expand into individual cold session rows.
 */
function ColdSessionsSummaryRow({
  count,
  isSelected,
  hasFocus,
  contentWidth,
}: {
  count: number;
  projectName: string;
  isSelected: boolean;
  hasFocus: boolean;
  contentWidth: number;
}): React.ReactElement {
  const prefix = "    ";
  const baseLabel = `... ${count} cold`;
  const hint = " +";
  const baseText = `${prefix}${baseLabel}`;
  // Width-check the hint before appending so a very narrow terminal
  // doesn't get an overflowing row. Same pattern as
  // ColdProjectsSummaryRow.
  const showHint =
    isSelected &&
    hasFocus &&
    getDisplayWidth(baseText) + getDisplayWidth(hint) <= contentWidth;
  const text = showHint ? `${baseText}${hint}` : baseText;
  const padding = Math.max(0, contentWidth - getDisplayWidth(text));
  const focused = isSelected && hasFocus;
  const muted = isSelected && !hasFocus;
  return (
    <Text>
      {BOX.v}{" "}
      <Text
        backgroundColor={focused || muted ? "blue" : undefined}
        bold={focused}
        dimColor={!focused}
      >
        {text}
      </Text>
      {" ".repeat(padding)}
      {BOX.v}
    </Text>
  );
}

/**
 * Ink supports any color string, but the panel title + census line
 * only ever paints "green" (visible active) or "yellow" (hidden
 * active alert). Constraining the union catches typos
 * (`"greem"`, `"yello"`) at compile time — `color: string` would
 * accept them and silently render invisible text at runtime.
 */
type TitleSegmentColor = "green" | "yellow";

interface TitleSegment {
  text: string;
  color?: TitleSegmentColor;
  dim?: boolean;
  bold?: boolean;
}

// Active count rendered as a colored number inside dim parens —
// e.g. ` (3)` where the `3` is bold-green for visible-active and
// bold-yellow for hidden-active. The number alone carries the
// signal; we used to spell out " active" but the color is already
// the active indicator, and dropping the word saves width.
//
// `opts.bold` defaults to true (panel-title census use case — full
// loudness so the tree-wide active number is unmissable) and
// `opts.dim` defaults to false. ProjectRow passes
// `{ bold: false }` so per-project active counts render as
// non-bold green — a softer mid-tone that reads as "yes there's
// life here" without competing with the row's own [hot]/[warm]
// status badge.
function activeParen(
  count: number,
  color: TitleSegmentColor,
  opts: { bold?: boolean; dim?: boolean } = {},
): TitleSegment[] {
  if (count === 0) return [];
  const { bold = true, dim = false } = opts;
  return [
    { text: " (", dim: true },
    { text: `${count}`, color, bold, dim },
    { text: ")", dim: true },
  ];
}

function hiddenSeg(
  hidden: { total: number; active: number },
  short: boolean,
): TitleSegment[] {
  if (hidden.total === 0) return [];
  const segs: TitleSegment[] = [{ text: ` · ⊘ ${hidden.total}`, dim: true }];
  if (!short) segs.push({ text: " hidden", dim: true });
  if (hidden.active > 0) {
    segs.push(...activeParen(hidden.active, "yellow"));
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

  // Declarative table of fallback levels. Each row describes which
  // counters to show (and the noun suffix per level), whether to
  // include the project active count, and how the hidden segment
  // formats. Picking the first level whose rendered width fits the
  // available space gives us a graceful long → short → drop chain
  // without seven near-identical array literals.
  interface CensusLevel {
    projectsSuffix?: string; // undefined → drop projects entirely
    sessionsSuffix?: string;
    subAgentsSuffix?: string;
    showProjectActive?: boolean; // default true
    hiddenShort?: boolean; // default false (long "hidden" word)
    omitHidden?: boolean; // default false
  }

  const LEVELS: CensusLevel[] = [
    // L0: full long form
    {
      projectsSuffix: " projects",
      sessionsSuffix: " sessions",
      subAgentsSuffix: " sub-agents",
    },
    // L1: short form (single-letter abbreviations)
    {
      projectsSuffix: "p",
      sessionsSuffix: "s",
      subAgentsSuffix: "a",
      hiddenShort: true,
    },
    // L2: drop sub-agents
    { projectsSuffix: "p", sessionsSuffix: "s", hiddenShort: true },
    // L3: drop sessions
    { projectsSuffix: "p", hiddenShort: true },
    // L4: drop project active counter
    { projectsSuffix: "p", showProjectActive: false, hiddenShort: true },
    // L5: just hidden alert
    { hiddenShort: true },
    // L6: just the label
    { hiddenShort: true, omitHidden: true },
  ];

  const buildLevel = (level: CensusLevel): TitleSegment[] => {
    const segs: TitleSegment[] = [labelSeg];
    if (level.projectsSuffix !== undefined) {
      segs.push({
        text: ` ${c.projects.total}${level.projectsSuffix}`,
        dim: true,
      });
      if (level.showProjectActive !== false) {
        segs.push(...activeParen(c.projects.active, "green"));
      }
    }
    if (level.sessionsSuffix !== undefined) {
      segs.push({
        text: ` · ${c.sessions.total}${level.sessionsSuffix}`,
        dim: true,
      });
      segs.push(...activeParen(c.sessions.active, "green"));
    }
    if (level.subAgentsSuffix !== undefined) {
      segs.push({
        text: ` · ${c.subAgents.total}${level.subAgentsSuffix}`,
        dim: true,
      });
      segs.push(...activeParen(c.subAgents.active, "green"));
    }
    if (!level.omitHidden) {
      segs.push(...hiddenSeg(c.hidden, level.hiddenShort ?? false));
    }
    return segs;
  };

  const candidates = LEVELS.map(buildLevel);
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
  const titleText = scopeLabel ? `Projects [${scopeLabel}]` : "Projects";
  const titleLine = createTitleLine(titleText, titleSuffix, width);
  const bottomLine = createBottomLine(width);

  // Census row: rendered as the first content row inside the panel
  // when `census` is provided. Styled distinctly from session rows
  // (no selection background, no bold) so it reads as
  // panel-meta-info rather than another selectable entry. The same
  // long/short/drop logic from `buildTitleSegments` is reused (with
  // an empty label, which we strip from the rendered output).
  const censusSegments = census
    ? (() => {
        const segs = buildTitleSegments("", census, contentWidth);
        const withoutLabel = segs[0]?.text === "" ? segs.slice(1) : segs;
        return withoutLabel.map((seg, i) =>
          i === 0 ? { ...seg, text: seg.text.replace(/^ /, "") } : seg,
        );
      })()
    : null;
  const censusWidth = censusSegments
    ? censusSegments.reduce((w, s) => w + getDisplayWidth(s.text), 0)
    : 0;
  const censusPadding = censusSegments
    ? Math.max(0, contentWidth - censusWidth)
    : 0;
  const renderCensusRow = () =>
    censusSegments ? (
      <Text>
        {BOX.v}{" "}
        {censusSegments.map((seg, i) => (
          <Text
            key={`census-${i}`}
            color={seg.color}
            dimColor={seg.dim}
            bold={seg.bold}
          >
            {seg.text}
          </Text>
        ))}
        {" ".repeat(censusPadding)}
        {BOX.v}
      </Text>
    ) : null;

  const totalProjectCount = projects.length + coldProjects.length;

  if (totalProjectCount === 0) {
    const emptyText = "No Claude sessions";
    const emptyPadding = Math.max(0, contentWidth - emptyText.length);
    return (
      <Box flexDirection="column" width={width}>
        <Text>{titleLine}</Text>
        {renderCensusRow()}
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

  // Census takes one row inside the panel content area when present, so
  // the effective row budget shrinks by 1 in that case.
  const censusRowCost = censusSegments ? 1 : 0;
  const effectiveMaxRows =
    maxRows !== undefined ? Math.max(1, maxRows - censusRowCost) : undefined;
  const needsOverflow =
    effectiveMaxRows !== undefined && totalRows > effectiveMaxRows;
  const visibleCount = needsOverflow ? effectiveMaxRows - 1 : totalRows;

  // Pinned "live" band: when the tree overflows, sessions that are running
  // RIGHT NOW (working/waiting) must never scroll out of view — that's the
  // point of a live monitor. Pin them above the scrollable tree, capped to
  // half the budget so a burst of concurrent sub-agents can't eat the
  // panel; the overflow collapses to a "+N more working" line. Pinned rows
  // are removed from the tree below so a live row never renders twice.
  const liveRows = needsOverflow ? flatRows.filter(isLiveSessionRow) : [];
  const bandCap = Math.max(1, Math.floor(visibleCount / 2));
  let pinnedRows: Extract<FlatRow, { kind: "session" }>[];
  let pinnedOverflow: number;
  if (liveRows.length <= bandCap) {
    pinnedRows = liveRows;
    pinnedOverflow = 0;
  } else if (bandCap === 1) {
    // No room for both a row and a summary — always show at least one live
    // row (the band's whole purpose), and drop the count.
    pinnedRows = liveRows.slice(0, 1);
    pinnedOverflow = 0;
  } else {
    // Reserve one slot for the "+N more working" summary line.
    pinnedRows = liveRows.slice(0, bandCap - 1);
    pinnedOverflow = liveRows.length - pinnedRows.length;
  }
  const bandHeight = pinnedRows.length + (pinnedOverflow > 0 ? 1 : 0);

  // The scrollable tree excludes pinned rows (no double render).
  const pinnedIds = new Set(pinnedRows.map((r) => r.session.id));
  const treeRows =
    bandHeight > 0
      ? flatRows.filter(
          (r) => !(r.kind === "session" && pinnedIds.has(r.session.id)),
        )
      : flatRows;
  const treeTotal = treeRows.length;

  // Index of the selected row within the (de-pinned) tree. A selected row
  // that is itself pinned won't be found here — it's shown in the band.
  const selectedFlatIndex = treeRows.findIndex((row) => {
    if (row.kind === "project") return selectedId === row.sentinelId;
    if (row.kind === "session") return row.session.id === selectedId;
    if (row.kind === "subagent-summary")
      return selectedId === `__sub-${row.parentId}__`;
    if (row.kind === "cold-projects-summary") return selectedId === "__cold__";
    if (row.kind === "cold-sessions-summary")
      return selectedId === `__cold-sessions-${row.projectName}__`;
    return false;
  });

  // Compute scrollTop so the selected tree row stays visible.
  const treeVisibleCount = Math.max(1, visibleCount - bandHeight);
  let scrollTop = 0;
  if (treeTotal > treeVisibleCount && selectedFlatIndex >= 0) {
    scrollTop = Math.max(0, selectedFlatIndex - treeVisibleCount + 1);
    scrollTop = Math.min(scrollTop, Math.max(0, treeTotal - treeVisibleCount));
  }

  const displayRows = treeRows.slice(scrollTop, scrollTop + treeVisibleCount);
  const hiddenBelow = treeTotal - (scrollTop + displayRows.length);

  const overflowLabel = `▸ +${pinnedOverflow} more working`;

  return (
    <Box flexDirection="column" width={width}>
      <Text>{titleLine}</Text>
      {renderCensusRow()}
      {pinnedRows.map((row, idx) => (
        <SessionRow
          key={`pin-${row.session.id}-${idx}`}
          session={row.session}
          isSelected={row.session.id === selectedId}
          hasFocus={hasFocus}
          prefix={row.prefix}
          contentWidth={contentWidth}
        />
      ))}
      {pinnedOverflow > 0 && (
        <Text>
          {BOX.v} <Text color="green">{overflowLabel}</Text>
          {" ".repeat(Math.max(0, contentWidth - overflowLabel.length - 1))}
          {BOX.v}
        </Text>
      )}
      {displayRows.map((row, idx) =>
        row.kind === "project" ? (
          <ProjectRow
            key={`project-${row.project.name}-${idx}`}
            project={row.project}
            isSelected={selectedId === row.sentinelId}
            hasFocus={hasFocus}
            contentWidth={contentWidth}
            census={census}
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
        ) : row.kind === "cold-projects-summary" ? (
          <ColdProjectsSummaryRow
            key="cold-summary"
            count={row.count}
            isSelected={selectedId === "__cold__"}
            hasFocus={hasFocus}
            width={width}
          />
        ) : (
          <ColdSessionsSummaryRow
            key={`cold-sessions-${row.projectName}`}
            count={row.count}
            projectName={row.projectName}
            isSelected={selectedId === `__cold-sessions-${row.projectName}__`}
            hasFocus={hasFocus}
            contentWidth={contentWidth}
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
