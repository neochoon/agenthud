import { homedir } from "node:os";
import { Box, Text } from "ink";
import type React from "react";
import type {
  ProjectNode,
  SessionNode,
  SessionStatus,
} from "../types/index.js";
import {
  BOX,
  createBottomLine,
  createTitleLine,
  DEFAULT_PANEL_WIDTH,
  getDisplayWidth,
  getInnerWidth,
} from "./constants.js";

export interface SessionTreePanelProps {
  projects: ProjectNode[];
  coldProjects: ProjectNode[];
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
  const isParent = prefix === "    ";
  const statusColor = getStatusColor(session.status);
  const badge = `[${session.status}]`;
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

  const leftCoreBase = `${prefix}${rawName}${shortIdDisplay} ${badge}`;
  const leftCoreWidth = getDisplayWidth(leftCoreBase);
  const rightWidth = getDisplayWidth(rightSide);

  // Middle text sits right after badge; reserve 1 space prefix + 1 min gap
  const middleAvailable = contentWidth - leftCoreWidth - 1 - rightWidth - 1;

  // Middle text: first user prompt for parents, task description for sub-agents
  let middleText = "";
  if (middleAvailable > 3) {
    const raw = isParent
      ? (session.firstUserPrompt ?? "")
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

  const fullLine = leftCoreBase + middleSection + gap + rightSide;
  const linePadding = Math.max(0, contentWidth - getDisplayWidth(fullLine));

  const highlight = isSelected && hasFocus;
  const shouldDim = isNonInteractive;

  return (
    <Text>
      {BOX.v}{" "}
      <Text
        backgroundColor={highlight ? "blue" : undefined}
        bold={highlight}
        dimColor={shouldDim && !highlight}
      >
        <Text dimColor={shouldDim && !highlight}>{prefix}</Text>
        <Text bold={!shouldDim}>{rawName}</Text>
        {shortIdDisplay ? <Text dimColor>{shortIdDisplay}</Text> : null}
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
        const collapsed = expandedIds.has(`__collapsed-${sentinelId}`);
        if (!collapsed) {
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
  const nameText = `> ${project.name}`;
  const pathText = project.projectPath
    ? formatProjectPath(project.projectPath)
    : "";
  const nameWidth = getDisplayWidth(nameText);
  const pathWidth = pathText ? getDisplayWidth(pathText) : 0;
  // 2 spaces between name and path
  const gapWidth = pathText ? 2 : 0;
  const totalWidth = nameWidth + gapWidth + pathWidth;
  const padding = Math.max(0, contentWidth - totalWidth);
  const highlight = isSelected && hasFocus;
  return (
    <Text>
      {BOX.v}{" "}
      <Text backgroundColor={highlight ? "blue" : undefined} bold={!highlight}>
        {nameText}
        {pathText ? (
          <>
            {"  "}
            <Text dimColor>{pathText}</Text>
          </>
        ) : null}
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
  const active = isSelected && hasFocus;
  return (
    <Text>
      {BOX.v}{" "}
      <Text dimColor={!active} inverse={active}>
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
  const highlight = isSelected && hasFocus;
  return (
    <Text
      backgroundColor={highlight ? "blue" : undefined}
      bold={highlight}
      dimColor={!highlight}
    >
      {line}
    </Text>
  );
}

export function SessionTreePanel({
  projects,
  coldProjects,
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

  const totalProjectCount = projects.length + coldProjects.length;

  if (totalProjectCount === 0) {
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
      <Text>{titleLine}</Text>
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
