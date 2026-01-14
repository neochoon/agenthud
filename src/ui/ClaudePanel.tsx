import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { ClaudeData, ClaudeSessionStatus, ActivityEntry, TodoItem } from "../types/index.js";
import {
  DEFAULT_PANEL_WIDTH,
  BOX,
  createTitleLine,
  createBottomLine,
  createSeparatorLine,
  getInnerWidth,
  getDisplayWidth,
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

function formatElapsedTime(startTime: Date | null): string {
  if (!startTime) return "";
  const elapsed = Date.now() - startTime.getTime();
  const minutes = Math.floor(elapsed / 60000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return "<1m";
}

function getStatusIcon(status: ClaudeSessionStatus): string {
  switch (status) {
    case "running":
      return "🔄";
    case "completed":
      return "✅";
    case "idle":
      return "⏳";
    case "none":
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
  timestamp: string;  // "[HH:MM:SS] "
  icon: string;       // ">" or "$" etc.
  labelContent: string; // "label: detail" or "label"
  displayWidth: number;
}

function formatActivityParts(activity: ActivityEntry, maxWidth: number): ActivityParts {
  const time = formatActivityTime(activity.timestamp);
  const icon = activity.icon;
  const label = activity.label;
  const detail = activity.detail;

  // Fixed parts: "[HH:MM:SS] " = 12 chars, icon = varies, " " = 1, label, ": " = 2
  const timestamp = `[${time}] `;
  const timestampWidth = timestamp.length; // 12
  const iconWidth = getDisplayWidth(icon); // Use actual icon width
  const labelWidth = label.length;
  const separatorWidth = detail ? 2 : 0; // ": " if there's detail

  const contentPrefixWidth = iconWidth + 1 + labelWidth + separatorWidth;
  const totalPrefixWidth = timestampWidth + contentPrefixWidth;

  if (detail) {
    const availableWidth = maxWidth - totalPrefixWidth;
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

    const labelContent = `${label}: ${truncatedDetail}`;
    const displayWidth = totalPrefixWidth + detailDisplayWidth;
    return { timestamp, icon, labelContent, displayWidth };
  }

  const labelContent = label;
  const displayWidth = totalPrefixWidth;
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

  const inProgressIcon = tick ? TODO_ICONS.in_progress_left : TODO_ICONS.in_progress_right;

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
        const text = todo.status === "in_progress" ? todo.activeForm : todo.content;
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

        const padding = Math.max(0, contentWidth - getDisplayWidth(icon) - 1 - getDisplayWidth(displayText));

        return (
          <Text key={`todo-${i}`}>
            {BOX.v}{" "}
            <Text color={iconColor}>{icon}</Text>
            {" "}
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
  const statusIcon = getStatusIcon(state.status);
  const elapsedTime = formatElapsedTime(state.sessionStartTime);

  // Build title suffix with elapsed time and countdown
  const titleSuffix = elapsedTime
    ? countdownSuffix
      ? `${elapsedTime} · ${countdownSuffix}`
      : elapsedTime
    : countdownSuffix;

  // Error state
  if (data.error) {
    const errorPadding = Math.max(0, contentWidth - data.error.length);
    return (
      <Box flexDirection="column" width={width}>
        <Text>{createTitleLine("Claude", titleSuffix, width)}</Text>
        <Text>
          {BOX.v}{" "}
          <Text color="red">{data.error}</Text>
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
          {BOX.v}{" "}
          <Text dimColor>{noSessionText}</Text>
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
          {BOX.v}{" "}
          <Text dimColor>{noActiveText}</Text>
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
    const { timestamp, icon, labelContent, displayWidth } = formatActivityParts(activity, contentWidth);
    const padding = Math.max(0, contentWidth - displayWidth);
    const style = getActivityStyle(activity);

    // Clear to end of line to prevent ghost text from terminal width mismatch
    const clearEOL = "\x1b[K";

    lines.push(
      <Text key={`activity-${i}`}>
        {BOX.v}{" "}
        <Text dimColor>{timestamp}</Text>
        <Text color="cyan">{icon}</Text>
        {" "}
        <Text color={style.color} dimColor={style.dimColor}>{labelContent}</Text>
        {" ".repeat(padding)}
        {BOX.v}{clearEOL}
      </Text>
    );
  }

  // Add token count if available
  if (state.tokenCount > 0) {
    const tokenText = `${state.tokenCount.toLocaleString()} tokens`;
    const tokenPadding = Math.max(0, contentWidth - tokenText.length);
    lines.push(
      <Text key="tokens">
        {BOX.v}{" "}
        <Text dimColor>{tokenText}</Text>
        {" ".repeat(tokenPadding)}
        {BOX.v}
      </Text>
    );
  }

  // Check if todos exist and determine display mode
  const hasTodos = state.todos && state.todos.length > 0;
  const allCompleted = hasTodos && state.todos!.every((t) => t.status === "completed");

  // If all todos completed, add summary line to activities
  if (hasTodos && allCompleted) {
    const todos = state.todos!;
    const lastCompleted = todos[todos.length - 1];
    const summaryText = `Todo: ${lastCompleted.content} (${todos.length}/${todos.length} done)`;
    const summaryIcon = "✓";
    const summaryPrefix = `${summaryIcon} `;
    const maxSummaryWidth = contentWidth - getDisplayWidth(summaryPrefix);

    let displaySummary = summaryText;
    if (getDisplayWidth(summaryText) > maxSummaryWidth) {
      displaySummary = "";
      let currentWidth = 0;
      for (const char of summaryText) {
        const charWidth = getDisplayWidth(char);
        if (currentWidth + charWidth > maxSummaryWidth - 3) {
          displaySummary += "...";
          break;
        }
        displaySummary += char;
        currentWidth += charWidth;
      }
    }

    const summaryPadding = Math.max(0, contentWidth - getDisplayWidth(summaryPrefix) - getDisplayWidth(displaySummary));
    lines.push(
      <Text key="todo-summary">
        {BOX.v}{" "}
        <Text color="green">{summaryIcon}</Text>
        {" "}
        <Text color="green">{displaySummary}</Text>
        {" ".repeat(summaryPadding)}
        {BOX.v}
      </Text>
    );
  }

  // Show TodoSection only if todos exist and not all completed
  const showTodoSection = hasTodos && !allCompleted;

  return (
    <Box flexDirection="column" width={width}>
      <Text>{createTitleLine("Claude", titleSuffix, width)}</Text>
      {lines}
      {showTodoSection && (
        <TodoSection todos={state.todos!} width={width} />
      )}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
