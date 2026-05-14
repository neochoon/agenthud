import { homedir } from "node:os";
import { Box, Text } from "ink";
import type React from "react";
import type { SessionNode, SessionStatus } from "../types/index.js";
import {
  BOX,
  createBottomLine,
  createTitleLine,
  DEFAULT_PANEL_WIDTH,
  getDisplayWidth,
  getInnerWidth,
} from "./constants.js";

interface SessionTreePanelProps {
  sessions: SessionNode[];
  selectedId: string | null;
  hasFocus: boolean;
  width?: number;
  maxRows?: number;
  expandedIds?: Set<string>;
}

function formatElapsed(lastModifiedMs: number): string {
  const elapsed = Date.now() - lastModifiedMs;
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h${minutes % 60}m`;
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
  const isParent = prefix === "";
  const statusColor = getStatusColor(session.status);
  const badge = `[${session.status}]`;
  const elapsed = formatElapsed(session.lastModifiedMs);
  const model = session.modelName ?? "";

  // Name: parent uses projectName, sub-agent uses agentId
  const name = isParent
    ? session.projectName || session.id.slice(0, 8)
    : (session.agentId ?? session.id.slice(0, 8));

  // Short ID suffix for parent sessions only (to distinguish same-named sessions)
  const shortId =
    isParent && session.projectName ? ` #${session.id.slice(0, 4)}` : "";

  const rightParts: string[] = [elapsed];
  if (model) rightParts.push(model);
  const rightSide = rightParts.join(" ");

  const leftCore = `${prefix}${name}${shortId} ${badge}`;
  const leftCoreWidth = getDisplayWidth(leftCore);
  const rightWidth = getDisplayWidth(rightSide);

  // Middle text sits right after badge; reserve 1 space prefix + 1 min gap
  const middleAvailable = contentWidth - leftCoreWidth - 1 - rightWidth - 1;

  // Middle text: project path for parents, task description for sub-agents
  let middleText = "";
  if (middleAvailable > 3) {
    const raw = isParent
      ? session.projectPath
        ? formatProjectPath(session.projectPath)
        : ""
      : (session.taskDescription ?? "");
    if (raw) {
      const truncated = truncatePath(raw, middleAvailable);
      if (truncated) middleText = truncated;
    }
  }

  const middleSection = middleText ? ` ${middleText}` : "";
  const gapWidth = Math.max(
    1,
    contentWidth - leftCoreWidth - getDisplayWidth(middleSection) - rightWidth,
  );
  const gap = " ".repeat(gapWidth);

  const fullLine = leftCore + middleSection + gap + rightSide;
  const linePadding = Math.max(0, contentWidth - getDisplayWidth(fullLine));

  const highlight = isSelected && hasFocus;

  return (
    <Text>
      {BOX.v}{" "}
      <Text backgroundColor={highlight ? "blue" : undefined} bold={highlight}>
        <Text>{prefix}</Text>
        <Text bold>{name}</Text>
        {shortId ? <Text dimColor>{shortId}</Text> : null}
        <Text> </Text>
        <Text color={statusColor}>{badge}</Text>
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
  | { kind: "session"; session: SessionNode; prefix: string }
  | { kind: "subagent-summary"; coolCount: number; coldCount: number }
  | { kind: "cold-sessions-summary"; count: number };

function appendSessionRows(
  result: FlatRow[],
  session: SessionNode,
  expandedIds: Set<string>,
): void {
  const isExpanded = expandedIds.has(session.id);
  const hotWarm = session.subAgents.filter(
    (s) => s.status === "hot" || s.status === "warm",
  );
  const cool = session.subAgents.filter((s) => s.status === "cool");
  const cold = session.subAgents.filter((s) => s.status === "cold");

  if (isExpanded) {
    const all = [...hotWarm, ...cool, ...cold];
    for (let i = 0; i < all.length; i++) {
      const isLast = i === all.length - 1;
      result.push({
        kind: "session",
        session: all[i],
        prefix: `${isLast ? "└─ " : "├─ "}» `,
      });
    }
  } else {
    const hasSummary = cool.length > 0 || cold.length > 0;
    for (let i = 0; i < hotWarm.length; i++) {
      const isLast = i === hotWarm.length - 1 && !hasSummary;
      result.push({
        kind: "session",
        session: hotWarm[i],
        prefix: `${isLast ? "└─ " : "├─ "}» `,
      });
    }
    if (hasSummary) {
      result.push({
        kind: "subagent-summary",
        coolCount: cool.length,
        coldCount: cold.length,
      });
    }
  }
}

function flattenSessions(
  sessions: SessionNode[],
  expandedIds: Set<string>,
): FlatRow[] {
  const result: FlatRow[] = [];

  const visibleSessions = sessions.filter((s) => s.status !== "cold");
  const coldSessions = sessions.filter((s) => s.status === "cold");

  for (const session of visibleSessions) {
    result.push({ kind: "session", session, prefix: "" });
    appendSessionRows(result, session, expandedIds);
  }

  if (coldSessions.length > 0) {
    result.push({ kind: "cold-sessions-summary", count: coldSessions.length });

    if (expandedIds.has("__cold__")) {
      for (const session of coldSessions) {
        result.push({ kind: "session", session, prefix: "" });
        appendSessionRows(result, session, expandedIds);
      }
    }
  }

  return result;
}

function SubagentSummaryRow({
  coolCount,
  coldCount,
  contentWidth,
}: {
  coolCount: number;
  coldCount: number;
  contentWidth: number;
}): React.ReactElement {
  const parts: string[] = [];
  if (coolCount > 0) parts.push(`${coolCount} cool`);
  if (coldCount > 0) parts.push(`${coldCount} cold`);
  const text = `└─ ... ${parts.join("  ")}`;
  const padding = Math.max(0, contentWidth - getDisplayWidth(text) - 1);
  return (
    <Text>
      {BOX.v} <Text dimColor>{text}</Text>
      {" ".repeat(padding)}
      {BOX.v}
    </Text>
  );
}

function ColdSessionsSummaryRow({
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
  const hint = isSelected && hasFocus ? " ↵ " : "";
  const hintWidth = getDisplayWidth(hint);
  const dashCount = Math.max(
    0,
    innerWidth - 1 - getDisplayWidth(label) - hintWidth,
  );
  const dashes = BOX.h.repeat(dashCount);
  const highlight = isSelected && hasFocus;
  return (
    <Text>
      <Text
        backgroundColor={highlight ? "blue" : undefined}
        bold={highlight}
        dimColor={!highlight}
      >
        {BOX.ml}
        {BOX.h}
        {label}
        {dashes}
        {hint}
        {BOX.mr}
      </Text>
    </Text>
  );
}

export function SessionTreePanel({
  sessions,
  selectedId,
  hasFocus,
  width = DEFAULT_PANEL_WIDTH,
  maxRows,
  expandedIds = new Set(),
}: SessionTreePanelProps): React.ReactElement {
  const innerWidth = getInnerWidth(width);
  const contentWidth = innerWidth - 1; // account for space after │

  const titleLine = createTitleLine("Sessions", "", width);
  const bottomLine = createBottomLine(width);

  if (sessions.length === 0) {
    const emptyText = "No Claude sessions";
    const emptyPadding = Math.max(0, contentWidth - emptyText.length);
    return (
      <Box flexDirection="column" width={width}>
        <Text>{titleLine}</Text>
        <Text>
          {BOX.v} <Text dimColor>{emptyText}</Text>
          {" ".repeat(emptyPadding)}
          {BOX.v}
        </Text>
        <Text>{bottomLine}</Text>
      </Box>
    );
  }

  const flatRows = flattenSessions(sessions, expandedIds);

  // Truncate to maxRows, reserving 1 row for the overflow indicator
  const limit =
    maxRows !== undefined && flatRows.length > maxRows
      ? maxRows - 1
      : flatRows.length;
  const displayRows = flatRows.slice(0, limit);
  const hiddenCount = flatRows.length - displayRows.length;

  return (
    <Box flexDirection="column" width={width}>
      <Text>{titleLine}</Text>
      {displayRows.map((row, idx) =>
        row.kind === "session" ? (
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
          />
        ) : (
          <ColdSessionsSummaryRow
            key="cold-summary"
            count={row.count}
            isSelected={selectedId === "__cold__"}
            hasFocus={hasFocus}
            width={width}
          />
        ),
      )}
      {hiddenCount > 0 && (
        <Text>
          {BOX.v} <Text dimColor>{`... ${hiddenCount} more`}</Text>
          {" ".repeat(
            Math.max(0, contentWidth - `... ${hiddenCount} more`.length - 1),
          )}
          {BOX.v}
        </Text>
      )}
      <Text>{bottomLine}</Text>
    </Box>
  );
}
