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
    case "running":
      return "green";
    case "idle":
      return "yellow";
    case "done":
      return "gray";
    default:
      return "white";
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

  const leftSide = `${prefix}${name}${shortId} ${badge}`;
  const leftWidth = getDisplayWidth(leftSide);
  const rightWidth = getDisplayWidth(rightSide);
  const available = contentWidth - leftWidth - rightWidth;

  // Middle text: project path for parents, task description for sub-agents
  let middleText = "";
  if (available > 5) {
    const raw = isParent
      ? session.projectPath
        ? formatProjectPath(session.projectPath)
        : ""
      : (session.taskDescription ?? "");
    if (raw) {
      const truncated = truncatePath(raw, available - 2);
      if (truncated) middleText = `${truncated} `;
    }
  }

  const gapWidth = Math.max(1, available - getDisplayWidth(middleText));
  const gap = " ".repeat(gapWidth);

  const fullLine = leftSide + gap + middleText + rightSide;
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
        <Text>{gap}</Text>
        {middleText ? <Text dimColor>{middleText}</Text> : null}
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
  | { kind: "idle-summary"; count: number };

function flattenSessions(
  sessions: SessionNode[],
  expandedIds: Set<string>,
): FlatRow[] {
  const result: FlatRow[] = [];

  for (const session of sessions) {
    result.push({ kind: "session", session, prefix: "" });

    const running = session.subAgents.filter((s) => s.status === "running");
    const idle = session.subAgents.filter((s) => s.status === "idle");
    const isExpanded = expandedIds.has(session.id);

    if (isExpanded) {
      const all = [...running, ...idle];
      for (let i = 0; i < all.length; i++) {
        const isLast = i === all.length - 1;
        const treeChar = isLast ? "└─ " : "├─ ";
        result.push({
          kind: "session",
          session: all[i],
          prefix: `${treeChar}» `,
        });
      }
    } else {
      const hasIdleSummary = idle.length > 0;
      for (let i = 0; i < running.length; i++) {
        const isLast = i === running.length - 1 && !hasIdleSummary;
        const treeChar = isLast ? "└─ " : "├─ ";
        result.push({
          kind: "session",
          session: running[i],
          prefix: `${treeChar}» `,
        });
      }
      if (hasIdleSummary) {
        result.push({ kind: "idle-summary", count: idle.length });
      }
    }
  }

  return result;
}

function IdleSummaryRow({
  count,
  contentWidth,
}: {
  count: number;
  contentWidth: number;
}): React.ReactElement {
  const text = `└─ ... ${count} idle`;
  const padding = Math.max(0, contentWidth - getDisplayWidth(text) - 1);
  return (
    <Text>
      {BOX.v} <Text dimColor>{text}</Text>
      {" ".repeat(padding)}
      {BOX.v}
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
        ) : (
          <IdleSummaryRow
            key={`idle-${idx}`}
            count={row.count}
            contentWidth={contentWidth}
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
