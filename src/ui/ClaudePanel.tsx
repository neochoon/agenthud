import { Box, Text } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import type {
  ActivityEntry,
  ClaudeData,
  ClaudeSessionStatus,
  TodoItem,
} from "../types/index.js";
import {
  BOX,
  createBottomLine,
  createSeparatorLine,
  createTitleLine,
  DEFAULT_PANEL_WIDTH,
  getDisplayWidth,
  getInnerWidth,
} from "./constants.js";

export interface ActivityStyle {
  color?: string;
  dimColor: boolean;
}

export function getActivityStyle(activity: ActivityEntry): ActivityStyle {
  // User input - bright white
  if (activity.type === "user") {
    return { color: "white", dimColor: false };
  }

  // Claude's response - green
  if (activity.type === "response") {
    return { color: "green", dimColor: false };
  }

  // Tool types
  if (activity.type === "tool") {
    // Bash commands - gray (secondary but visible)
    if (activity.label === "Bash") {
      return { color: "gray", dimColor: false };
    }

    // All other tools (Edit, Read, Write, Grep, Glob, TodoWrite, etc.) - dim
    return { dimColor: true };
  }

  // Default fallback - dim
  return { dimColor: true };
}

interface ClaudePanelProps {
  data: ClaudeData;
  countdown?: number | null;
  width?: number;
  isRunning?: boolean;
  justRefreshed?: boolean;
}

function formatCountdown(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const padded = String(seconds).padStart(2, " ");
  return `↻ ${padded}s`;
}

function formatTokenCount(tokens: number): string {
  if (tokens <= 0) return "";
  if (tokens < 1000) return `${tokens} tokens`;
  if (tokens < 1000000) return `${Math.round(tokens / 1000)}K tokens`;
  return `${(tokens / 1000000).toFixed(1)}M tokens`;
}

function formatSessionTime(startTime: Date | null): string {
  if (!startTime) return "";

  // Start time (HH:MM)
  const startHours = String(startTime.getHours()).padStart(2, "0");
  const startMinutes = String(startTime.getMinutes()).padStart(2, "0");
  const startStr = `${startHours}:${startMinutes}`;

  // Elapsed time
  const elapsed = Date.now() - startTime.getTime();
  const elapsedMinutes = Math.floor(elapsed / 60000);
  const hours = Math.floor(elapsedMinutes / 60);
  const remainingMinutes = elapsedMinutes % 60;

  let elapsedStr: string;
  if (hours >= 10) {
    elapsedStr = `${hours}h`;
  } else if (hours > 0) {
    elapsedStr = `${hours}h ${remainingMinutes}m`;
  } else if (elapsedMinutes > 0) {
    elapsedStr = `${elapsedMinutes}m`;
  } else {
    elapsedStr = "<1m";
  }

  return `${startStr} (${elapsedStr})`;
}

function getStatusIcon(status: ClaudeSessionStatus): string {
  switch (status) {
    case "running":
      return "🔄";
    case "completed":
      return "✅";
    case "idle":
      return "⏳";
    default:
      return "";
  }
}

function formatActivityTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

interface ActivityParts {
  timestamp: string; // "[HH:MM:SS] "
  icon: string; // ">" or "$" etc.
  labelContent: string; // "label: detail" or "label"
  displayWidth: number;
}

function formatActivityParts(
  activity: ActivityEntry,
  maxWidth: number,
): ActivityParts {
  const time = formatActivityTime(activity.timestamp);
  const icon = activity.icon;
  const label = activity.label;
  const detail = activity.detail;
  const count = activity.count;

  // Count suffix for aggregated activities (e.g., " (×3)")
  const countSuffix = count && count > 1 ? ` (×${count})` : "";
  const countSuffixWidth = countSuffix.length;

  // Skip label for User and Response - they're already distinguished by color
  const skipLabel = label === "User" || label === "Response";

  // Fixed parts: "[HH:MM:SS] " = 12 chars, icon = varies, " " = 1
  const timestamp = `[${time}] `;
  const timestampWidth = timestamp.length; // 12
  const iconWidth = getDisplayWidth(icon); // Use actual icon width

  if (skipLabel && detail) {
    // For User/Response: just show detail without label
    const prefixWidth = timestampWidth + iconWidth + 1; // timestamp + icon + space
    const availableWidth = maxWidth - prefixWidth - countSuffixWidth;
    let truncatedDetail = detail;
    let detailDisplayWidth = getDisplayWidth(detail);

    if (detailDisplayWidth > availableWidth) {
      truncatedDetail = "";
      let currentWidth = 0;
      for (const char of detail) {
        const charWidth = getDisplayWidth(char);
        if (currentWidth + charWidth > availableWidth - 3) {
          truncatedDetail += "...";
          currentWidth += 3;
          break;
        }
        truncatedDetail += char;
        currentWidth += charWidth;
      }
      detailDisplayWidth = currentWidth;
    }

    return {
      timestamp,
      icon,
      labelContent: truncatedDetail + countSuffix,
      displayWidth: prefixWidth + detailDisplayWidth + countSuffixWidth,
    };
  }

  const labelWidth = label.length;
  const separatorWidth = detail ? 2 : 0; // ": " if there's detail

  const contentPrefixWidth = iconWidth + 1 + labelWidth + separatorWidth;
  const totalPrefixWidth = timestampWidth + contentPrefixWidth;

  if (detail) {
    const availableWidth = maxWidth - totalPrefixWidth - countSuffixWidth;
    let truncatedDetail = detail;
    let detailDisplayWidth = getDisplayWidth(detail);

    // Truncate if needed, accounting for wide characters
    if (detailDisplayWidth > availableWidth) {
      truncatedDetail = "";
      let currentWidth = 0;
      for (const char of detail) {
        const charWidth = getDisplayWidth(char);
        if (currentWidth + charWidth > availableWidth - 3) {
          truncatedDetail += "...";
          currentWidth += 3;
          break;
        }
        truncatedDetail += char;
        currentWidth += charWidth;
      }
      detailDisplayWidth = currentWidth;
    }

    const labelContent = `${label}: ${truncatedDetail}${countSuffix}`;
    const displayWidth =
      totalPrefixWidth + detailDisplayWidth + countSuffixWidth;
    return { timestamp, icon, labelContent, displayWidth };
  }

  const labelContent = label + countSuffix;
  const displayWidth = totalPrefixWidth + countSuffixWidth;
  return { timestamp, icon, labelContent, displayWidth };
}

// Todo status icons
const TODO_ICONS = {
  completed: "✓",
  in_progress_left: "◐",
  in_progress_right: "◑",
  pending: "○",
} as const;

interface TodoSectionProps {
  todos: TodoItem[];
  width: number;
}

function TodoSection({ todos, width }: TodoSectionProps): React.ReactElement {
  const [tick, setTick] = useState(false);
  const innerWidth = getInnerWidth(width);
  const contentWidth = innerWidth - 1;

  // Animate in_progress icon
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => !t), 500);
    return () => clearInterval(timer);
  }, []);

  const completedCount = todos.filter((t) => t.status === "completed").length;
  const totalCount = todos.length;
  const headerTitle = `Todo (${completedCount}/${totalCount})`;

  const inProgressIcon = tick
    ? TODO_ICONS.in_progress_left
    : TODO_ICONS.in_progress_right;

  return (
    <>
      <Text>{createSeparatorLine(headerTitle, width)}</Text>
      {todos.map((todo, i) => {
        let icon: string;
        let iconColor: string | undefined;

        switch (todo.status) {
          case "completed":
            icon = TODO_ICONS.completed;
            iconColor = "green";
            break;
          case "in_progress":
            icon = inProgressIcon;
            iconColor = "yellow";
            break;
          default:
            icon = TODO_ICONS.pending;
            iconColor = undefined;
        }

        // Use activeForm for in_progress, content for others
        const text =
          todo.status === "in_progress" ? todo.activeForm : todo.content;
        const maxTextWidth = contentWidth - 3; // icon + space + border
        let displayText = text;
        if (getDisplayWidth(text) > maxTextWidth) {
          displayText = "";
          let currentWidth = 0;
          for (const char of text) {
            const charWidth = getDisplayWidth(char);
            if (currentWidth + charWidth > maxTextWidth - 3) {
              displayText += "...";
              currentWidth += 3;
              break;
            }
            displayText += char;
            currentWidth += charWidth;
          }
        }

        const padding = Math.max(
          0,
          contentWidth -
            getDisplayWidth(icon) -
            1 -
            getDisplayWidth(displayText),
        );

        return (
          <Text key={`todo-${i}`}>
            {BOX.v} <Text color={iconColor}>{icon}</Text>{" "}
            <Text dimColor={todo.status === "completed"}>{displayText}</Text>
            {" ".repeat(padding)}
            {BOX.v}
          </Text>
        );
      })}
    </>
  );
}

export function ClaudePanel({
  data,
  countdown,
  width = DEFAULT_PANEL_WIDTH,
  isRunning = false,
  justRefreshed = false,
}: ClaudePanelProps): React.ReactElement {
  const countdownSuffix = isRunning ? "running..." : formatCountdown(countdown);
  const innerWidth = getInnerWidth(width);
  const contentWidth = innerWidth - 1; // Account for " " after │ (│ is counted in innerWidth)

  const { state } = data;
  const _statusIcon = getStatusIcon(state.status);
  const sessionTime = formatSessionTime(state.sessionStartTime);
  const tokenDisplay = formatTokenCount(state.tokenCount);

  // Build title suffix with tokens, elapsed time, and countdown
  // Order: 50K tokens · 30m · ↻ 10s
  const titleParts: string[] = [];
  if (tokenDisplay) titleParts.push(tokenDisplay);
  if (sessionTime) titleParts.push(sessionTime);
  if (countdownSuffix) titleParts.push(countdownSuffix);
  const titleSuffix = titleParts.join(" · ");

  // Error state
  if (data.error) {
    const errorPadding = Math.max(0, contentWidth - data.error.length);
    return (
      <Box flexDirection="column" width={width}>
        <Text>{createTitleLine("Claude", titleSuffix, width)}</Text>
        <Text>
          {BOX.v} <Text color="red">{data.error}</Text>
          {" ".repeat(errorPadding)}
          {BOX.v}
        </Text>
        <Text>{createBottomLine(width)}</Text>
      </Box>
    );
  }

  // No Claude session (never used Claude in this project)
  if (!data.hasSession) {
    const noSessionText = "No Claude session";
    const noSessionPadding = Math.max(0, contentWidth - noSessionText.length);
    return (
      <Box flexDirection="column" width={width}>
        <Text>{createTitleLine("Claude", countdownSuffix, width)}</Text>
        <Text>
          {BOX.v} <Text dimColor>{noSessionText}</Text>
          {" ".repeat(noSessionPadding)}
          {BOX.v}
        </Text>
        <Text>{createBottomLine(width)}</Text>
      </Box>
    );
  }

  // No active session (session exists but inactive for 5+ minutes)
  if (state.status === "none" || state.activities.length === 0) {
    const noActiveText = "No active session";
    const noActivePadding = Math.max(0, contentWidth - noActiveText.length);
    return (
      <Box flexDirection="column" width={width}>
        <Text>{createTitleLine("Claude", titleSuffix, width)}</Text>
        <Text>
          {BOX.v} <Text dimColor>{noActiveText}</Text>
          {" ".repeat(noActivePadding)}
          {BOX.v}
        </Text>
        <Text>{createBottomLine(width)}</Text>
      </Box>
    );
  }

  // Active session - build activity log lines
  const lines: React.ReactElement[] = [];

  for (let i = 0; i < state.activities.length; i++) {
    const activity = state.activities[i];
    const { timestamp, icon, labelContent, displayWidth } = formatActivityParts(
      activity,
      contentWidth,
    );
    const padding = Math.max(0, contentWidth - displayWidth);
    const style = getActivityStyle(activity);

    // Clear to end of line to prevent ghost text from terminal width mismatch
    const clearEOL = "\x1b[K";

    lines.push(
      <Text key={`activity-${i}`}>
        {BOX.v} <Text dimColor>{timestamp}</Text>
        <Text color="cyan">{icon}</Text>{" "}
        <Text color={style.color} dimColor={style.dimColor}>
          {labelContent}
        </Text>
        {" ".repeat(padding)}
        {BOX.v}
        {clearEOL}
      </Text>,
    );
  }

  // Check if todos exist and determine display mode
  const hasTodos = state.todos && state.todos.length > 0;
  const allCompleted =
    hasTodos && state.todos?.every((t) => t.status === "completed");

  // If all todos completed, add summary line to activities
  if (hasTodos && allCompleted) {
    const todos = state.todos!;
    const summaryText = `Todo (${todos.length}/${todos.length} done)`;
    const summaryIcon = "✓";
    const timestamp = formatActivityTime(new Date());
    const timestampStr = `[${timestamp}] `;

    // Calculate widths: timestamp + icon + space + text
    const timestampWidth = timestampStr.length; // 12
    const iconWidth = getDisplayWidth(summaryIcon);
    const prefixWidth = timestampWidth + iconWidth + 1; // timestamp + icon + space
    const maxTextWidth = contentWidth - prefixWidth;

    let displaySummary = summaryText;
    if (getDisplayWidth(summaryText) > maxTextWidth) {
      displaySummary = "";
      let currentWidth = 0;
      for (const char of summaryText) {
        const charWidth = getDisplayWidth(char);
        if (currentWidth + charWidth > maxTextWidth - 3) {
          displaySummary += "...";
          break;
        }
        displaySummary += char;
        currentWidth += charWidth;
      }
    }

    const summaryPadding = Math.max(
      0,
      contentWidth - prefixWidth - getDisplayWidth(displaySummary),
    );
    lines.push(
      <Text key="todo-summary">
        {BOX.v} <Text dimColor>{timestampStr}</Text>
        <Text color="green">{summaryIcon}</Text>{" "}
        <Text color="green">{displaySummary}</Text>
        {" ".repeat(summaryPadding)}
        {BOX.v}
      </Text>,
    );
  }

  // Show TodoSection only if todos exist and not all completed
  const showTodoSection = hasTodos && !allCompleted;

  return (
    <Box flexDirection="column" width={width}>
      <Text>{createTitleLine("Claude", titleSuffix, width)}</Text>
      {lines}
      {showTodoSection && <TodoSection todos={state.todos!} width={width} />}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
