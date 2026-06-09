/**
 * Bottom panel: render the activity feed for the selected session
 * as a tail-feed (newest at the bottom). Scrollable, filterable
 * via filter presets, with a "live" highlight band that sweeps
 * across the newest row while the session is mid-update.
 *
 * Design decisions:
 * - Tail-feed layout (v0.9.3 reversal). Newest entry sits at the
 *   bottom like `tail -f`, terminal logs, chat apps. Empty
 *   padding moved to the top. `g` jumps to the oldest (top), `G`
 *   to the live edge (bottom) — vim convention. PgUp/PgDn
 *   directions swap accordingly.
 * - "Live" row gets a spinner icon + flashlight highlight band
 *   that sweeps left → right across its label. Replaces the
 *   v0.9.3 standalone sliding-arrow row — the alive cue now
 *   lives on the actual row, freeing the breathing slot back as
 *   real activity space.
 * - Filter application is memoized on `(sessionId + visible
 *   activities window)` only, NOT on the spinner tick. Including
 *   the tick in the key trashes the memo every 100ms and recomputes
 *   the filter on every render — measurable scroll-position
 *   regression on long histories.
 *
 * Gotcha:
 * - Status-bar PAUSED indicator distinguishes `↑N` (scrolled up
 *   from live) from `+N↓` (new entries below current view) so the
 *   user always knows their position relative to live. A single
 *   "PAUSED" with no counter loses that signal.
 */

import { Box, Text } from "ink";
import type React from "react";
import { memo } from "react";
import type { ActivityEntry } from "../types/index.js";
import {
  BOX,
  createBottomLine,
  createTitleLine,
  getDisplayWidth,
  getInnerWidth,
} from "./constants.js";

export interface ActivityStyle {
  color?: string;
  dimColor: boolean;
}

/**
 * Map a normal-intensity color name to its high-intensity variant so the
 * "flashlight" sweep brightens the actual character color instead of
 * inverting the background. Colors with no defined bright variant fall
 * through unchanged.
 */
function brighten(color: string | undefined): string {
  switch (color) {
    case undefined:
    case "gray":
      return "white";
    case "white":
      return "whiteBright";
    case "green":
      return "greenBright";
    case "yellow":
      return "yellowBright";
    case "magenta":
      return "magentaBright";
    case "cyan":
      return "cyanBright";
    case "red":
      return "redBright";
    case "blue":
      return "blueBright";
    case "black":
      return "blackBright";
    default:
      return color;
  }
}

export function getActivityStyle(activity: ActivityEntry): ActivityStyle {
  if (activity.type === "user") {
    return { color: "white", dimColor: false };
  }
  if (activity.type === "response") {
    return { color: "green", dimColor: false };
  }
  if (activity.type === "thinking") {
    return { color: "magenta", dimColor: true };
  }
  if (activity.type === "commit") {
    return { color: "yellow", dimColor: false };
  }
  if (activity.type === "tool") {
    if (activity.label === "Bash") {
      return { color: "gray", dimColor: false };
    }
    return { dimColor: true };
  }
  return { dimColor: true };
}

export interface ActivityViewerPanelProps {
  activities: ActivityEntry[];
  sessionName: string;
  scrollOffset: number;
  isLive: boolean;
  newCount: number;
  visibleRows: number;
  /**
   * Spinner frame (one character) painted in place of the newest visible
   * activity's icon when set AND `isLive` is true AND the viewer has
   * content. Gives the live-edge row a moving glyph + bright text so the
   * "this row is alive" cue lands on the row itself, not on a separate
   * marker below. Pass null/undefined to disable the treatment.
   */
  liveSpinnerFrame?: string | null;
  /**
   * Monotonic counter (e.g. from `useTick`) that drives the moving
   * flashlight sweep across the live row's label. Each tick advances the
   * highlight window by one cell. When omitted, no sweep effect.
   */
  liveTick?: number | null;
  width: number;
  cursorLine: number;
  hasFocus: boolean;
  spinner?: string;
  filterLabel?: string;
}

function formatActivityTime(date: Date, now: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const time = `${hours}:${minutes}:${seconds}`;

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return time;

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day} ${time}`;
}

function flattenForOneLine(detail: string): string {
  return detail.replace(/[\r\n\t]+/g, " ").trim();
}

function truncateDetail(detail: string, maxWidth: number): string {
  const flat = flattenForOneLine(detail);
  if (getDisplayWidth(flat) <= maxWidth) return flat;
  let truncated = "";
  let width = 0;
  for (const char of flat) {
    const charWidth = getDisplayWidth(char);
    if (width + charWidth > maxWidth - 1) break;
    truncated += char;
    width += charWidth;
  }
  return `${truncated}…`;
}

interface ActivityRowProps {
  activity: ActivityEntry;
  timestamp: string;
  width: number;
  contentWidth: number;
  isCursor: boolean;
  isLiveRow: boolean;
  /** Set on the live row only; undefined elsewhere so memo equality holds. */
  liveSpinnerFrame?: string;
  /** Set on the live row only; undefined elsewhere so memo equality holds. */
  liveTick?: number;
}

/**
 * One row of the activity viewer. Wrapped in React.memo so non-live rows
 * skip re-render on every spinner / flashlight tick — only the live row
 * (whose liveSpinnerFrame/liveTick props actually change) re-runs.
 */
const ActivityRow = memo(function ActivityRow({
  activity,
  timestamp,
  width,
  contentWidth,
  isCursor,
  isLiveRow,
  liveSpinnerFrame,
  liveTick,
}: ActivityRowProps): React.ReactElement {
  const style = getActivityStyle(activity);
  const timestampWidth = timestamp.length;
  const icon = isLiveRow && liveSpinnerFrame ? liveSpinnerFrame : activity.icon;
  const iconWidth = getDisplayWidth(icon);
  const label = activity.label;
  const detail = activity.detail;
  const count = activity.count;

  const countSuffix = count && count > 1 ? ` (×${count})` : "";
  const countSuffixWidth = countSuffix.length;

  const prefixWidth = 2 + timestampWidth + iconWidth + 1;
  const labelPart = detail ? `${label}: ` : label;
  const labelWidth = labelPart.length;
  const detailMaxWidth =
    width -
    2 -
    timestampWidth -
    iconWidth -
    1 -
    labelWidth -
    countSuffixWidth -
    1;

  let labelContent: string;
  if (detail) {
    const truncated = truncateDetail(detail, Math.max(0, detailMaxWidth));
    labelContent = `${labelPart}${truncated}${countSuffix}`;
  } else {
    labelContent = label + countSuffix;
  }

  const usedWidth =
    1 + 1 + timestampWidth + iconWidth + 1 + getDisplayWidth(labelContent) + 1;
  const padding = Math.max(0, width - usedWidth);

  // Live-row flashlight: split the label into pre/lit/post so the lit
  // segment can render in the brightened variant of style.color.
  const SWEEP_WIDTH = 10;
  let labelNode: React.ReactNode = labelContent;
  if (
    isLiveRow &&
    !isCursor &&
    liveTick != null &&
    labelContent.length > 0
  ) {
    const period = labelContent.length + SWEEP_WIDTH;
    const offset = (liveTick % period) - SWEEP_WIDTH; // -W .. len-1
    const litStart = Math.max(0, offset);
    const litEnd = Math.min(labelContent.length, offset + SWEEP_WIDTH);
    if (litEnd > litStart) {
      const pre = labelContent.slice(0, litStart);
      const lit = labelContent.slice(litStart, litEnd);
      const post = labelContent.slice(litEnd);
      labelNode = (
        <>
          {pre}
          <Text color={brighten(style.color)} bold>
            {lit}
          </Text>
          {post}
        </>
      );
    }
  }

  return (
    <Text>
      {BOX.v}{" "}
      <Text backgroundColor={isCursor ? "blue" : undefined}>
        <Text dimColor={!isCursor && !isLiveRow}>{timestamp}</Text>
        <Text color="cyan" bold={isLiveRow}>
          {icon}
        </Text>{" "}
        <Text
          color={isCursor ? undefined : style.color}
          dimColor={!isCursor && !isLiveRow && style.dimColor}
        >
          {labelNode}
        </Text>
        {" ".repeat(padding)}
      </Text>
      {BOX.v}
    </Text>
  );
});

export function ActivityViewerPanel({
  activities,
  sessionName,
  scrollOffset,
  isLive,
  newCount,
  visibleRows,
  liveSpinnerFrame = null,
  liveTick = null,
  width,
  cursorLine,
  hasFocus,
  spinner = "",
  filterLabel,
}: ActivityViewerPanelProps): React.ReactElement {
  const innerWidth = getInnerWidth(width);
  const contentWidth = innerWidth - 1;

  const filterSuffix =
    filterLabel && filterLabel !== "all" ? ` · ${filterLabel}` : "";
  let titleSuffix: string;
  if (isLive) {
    titleSuffix = `[LIVE ${spinner || "▼"}${filterSuffix}]`;
  } else {
    // ↑N = scrolled N entries up from the live edge.
    // +N↓ = N new entries arrived below the current view.
    const badge = newCount > 0 ? ` +${newCount}↓` : "";
    titleSuffix = `[PAUSED ↑${scrollOffset}${badge}${filterSuffix}]`;
  }

  // Take a chronological slice (oldest -> newest within the slice). The slice
  // ends `scrollOffset` entries from the newest; live = scrollOffset 0.
  let visibleActivities: ActivityEntry[];
  if (activities.length === 0) {
    visibleActivities = [];
  } else if (isLive) {
    visibleActivities = activities.slice(-visibleRows);
  } else {
    const end = Math.max(0, activities.length - scrollOffset);
    const start = Math.max(0, end - visibleRows);
    visibleActivities = activities.slice(start, end);
  }

  const now = new Date();
  const lines: React.ReactElement[] = [];

  if (visibleActivities.length === 0) {
    const emptyText = "No activity yet";
    const emptyPadding = Math.max(0, contentWidth - emptyText.length - 1);
    lines.push(
      <Text key="empty">
        {BOX.v} <Text dimColor>{emptyText}</Text>
        {" ".repeat(emptyPadding)}
        {BOX.v}
      </Text>,
    );
  } else {
    // cursorLine = "entries back from newest visible" (0 = newest = bottom row).
    // The cursor highlights the activity that's `cursorLine` steps from the
    // newest, capped at the number of currently visible activities.
    const effectiveCursor = Math.min(cursorLine, visibleActivities.length - 1);
    const cursorIndexInSlice = visibleActivities.length - 1 - effectiveCursor;
    // The newest visible activity sits at the last index; in LIVE mode with
    // a spinner frame supplied, this row gets the "alive" treatment.
    const liveRowIndex = visibleActivities.length - 1;
    const liveTreatment = isLive && !!liveSpinnerFrame;
    for (let i = 0; i < visibleActivities.length; i++) {
      const activity = visibleActivities[i];
      const isCursor = hasFocus && i === cursorIndexInSlice;
      const isLiveRow = liveTreatment && i === liveRowIndex;
      const timestamp = `[${formatActivityTime(activity.timestamp, now)}] `;
      lines.push(
        <ActivityRow
          key={`activity-${i}`}
          activity={activity}
          timestamp={timestamp}
          width={width}
          contentWidth={contentWidth}
          isCursor={isCursor}
          isLiveRow={isLiveRow}
          // Spinner / tick only flow to the live row so non-live rows keep
          // identical prop refs across ticks and React.memo skips them.
          liveSpinnerFrame={
            isLiveRow ? (liveSpinnerFrame ?? undefined) : undefined
          }
          liveTick={isLiveRow ? (liveTick ?? undefined) : undefined}
        />,
      );
    }
  }

  // Bottom-aligned: pad at the TOP so newest sits on the last content row.
  // The live-edge cue now lives ON the newest activity row (spinner + bold)
  // rather than in a separate slot below.
  const emptyRow = `${BOX.v}${" ".repeat(contentWidth + 1)}${BOX.v}`;
  const padCount = Math.max(0, visibleRows - lines.length);
  const padded: React.ReactElement[] = [];
  for (let i = 0; i < padCount; i++) {
    padded.push(<Text key={`pad-${i}`}>{emptyRow}</Text>);
  }
  const finalLines = [...padded, ...lines];

  return (
    <Box flexDirection="column" width={width}>
      <Text color={isLive ? undefined : "yellow"}>
        {createTitleLine(sessionName, titleSuffix, width)}
      </Text>
      {finalLines}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
