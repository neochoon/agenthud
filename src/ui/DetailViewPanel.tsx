/**
 * Full-screen detail overlay for one activity entry. Renders the
 * multi-line body — diff for Edit, written content for Write,
 * line-numbered content for Read, subagent response for Task, full
 * `git show --stat --patch` for commits — with syntax-aware
 * coloring (green/red/cyan for diffs, cyan for fenced code blocks,
 * plain for prose).
 *
 * Design decisions:
 * - Coloring routes through `lineColoring.classifyDiffLines` and
 *   `classifyCodeFences`, not language-specific syntax
 *   highlighters. Goal is structural cues (added vs removed,
 *   prose vs code), not real syntax highlighting — keeps the
 *   dependency surface tiny and the renderer fast.
 * - Scroll-only overlay: `↑/↓/j/k` to scroll, `Esc/q/↵` to close.
 *   No find/search/copy — Ink's text rendering would have to
 *   reimplement them and they're easily available outside the
 *   TUI.
 *
 * Gotcha:
 * - Indentation and whitespace inside code and diff bodies must
 *   be preserved verbatim. Ink's `<Text>` is rendered with no
 *   `wrap` so the trailing spaces on patch hunk context lines
 *   stay intact (v0.11.0 fix — earlier versions flattened lines
 *   and broke hunk alignment in the renderer).
 */

import { Box, Text } from "ink";
import type React from "react";
import type { ActivityEntry } from "../types/index.js";
import { getActivityStyle } from "./ActivityViewerPanel.js";
import {
  BOX,
  createBottomLine,
  getDisplayWidth,
  getInnerWidth,
} from "./constants.js";
import {
  classifyCodeFences,
  classifyDiffLines,
  getLineStyle,
  type LineCategory,
} from "./lineColoring.js";
import { matchRanges } from "./search/matcher.js";

export function wrapText(text: string, maxWidth: number): string[] {
  if (!text) return ["(empty)"];
  const result: string[] = [];
  for (const rawLine of text.split("\n")) {
    if (!rawLine) {
      result.push("");
      continue;
    }
    const words = rawLine.split(" ");
    let current = "";
    for (const word of words) {
      if (!current) {
        current = word;
      } else if (getDisplayWidth(`${current} ${word}`) <= maxWidth) {
        current += ` ${word}`;
      } else {
        result.push(current);
        current = word;
      }
    }
    if (current) result.push(current);
  }
  return result.length > 0 ? result : ["(empty)"];
}

/**
 * Wrap each source line and propagate its line category to every wrapped
 * piece. Classification happens on raw source lines (before wrapping) so
 * fence/diff heuristics see the original prefixes intact.
 */
// Split a leading "NN: " line-number gutter from the rest of a row so the
// gutter can be rendered dim. Returns null when there is no leading gutter
// (e.g. a hard-wrapped continuation chunk). Only the leading number matches,
// so number-like content after the gutter is left untouched.
export function splitLineNumberGutter(text: string): [string, string] | null {
  const m = text.match(/^(\s*\d+: )(.*)$/);
  return m ? [m[1], m[2]] : null;
}

// Hard-wrap a line into chunks no wider than maxWidth display columns,
// preserving every character (including leading/internal whitespace). Used for
// code and diff bodies where indentation is meaningful.
function hardWrapByWidth(line: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [line];
  const out: string[] = [];
  let cur = "";
  let curW = 0;
  for (const ch of line) {
    const w = getDisplayWidth(ch);
    if (curW + w > maxWidth && cur !== "") {
      out.push(cur);
      cur = ch;
      curW = w;
    } else {
      cur += ch;
      curW += w;
    }
  }
  if (cur !== "") out.push(cur);
  return out.length > 0 ? out : [line];
}

export function wrapClassified(
  text: string,
  maxWidth: number,
  classifier: (lines: string[]) => LineCategory[],
  preserveWhitespace = false,
): Array<{ text: string; category: LineCategory }> {
  if (!text) return [{ text: "(empty)", category: "prose" }];
  const sourceLines = text.split("\n");
  const categories = classifier(sourceLines);
  const out: Array<{ text: string; category: LineCategory }> = [];
  for (let i = 0; i < sourceLines.length; i++) {
    const line = sourceLines[i];
    const cat = categories[i] ?? "prose";
    if (!line) {
      out.push({ text: "", category: cat });
      continue;
    }
    if (preserveWhitespace) {
      for (const chunk of hardWrapByWidth(line, maxWidth)) {
        out.push({ text: chunk, category: cat });
      }
      continue;
    }
    const words = line.split(" ");
    let current = "";
    for (const word of words) {
      if (!current) {
        current = word;
      } else if (getDisplayWidth(`${current} ${word}`) <= maxWidth) {
        current += ` ${word}`;
      } else {
        out.push({ text: current, category: cat });
        current = word;
      }
    }
    if (current) out.push({ text: current, category: cat });
  }
  return out.length > 0 ? out : [{ text: "(empty)", category: "prose" }];
}

export interface DetailViewPanelProps {
  activity: ActivityEntry;
  sessionName: string;
  width: number;
  visibleRows: number;
  scrollOffset: number;
  /** Non-empty string activates in-line match highlighting. */
  searchQuery?: string;
  /** Index into the raw source lines that is the active (current) match.
   * The panel scrolls to keep this line in the visible window. */
  activeMatchLine?: number | null;
}

/** Render a line with matched substrings highlighted via inverse video.
 * The active match line uses a yellow background; other matched lines use
 * inverse. Falls through to a plain `<Text>` when no ranges match. */
function renderHighlightedLine(
  text: string,
  query: string,
  isActiveLine: boolean,
  lineColor: string | undefined,
  lineDimColor: boolean | undefined,
): React.ReactElement {
  const ranges = matchRanges(text, query);
  if (ranges.length === 0) {
    return (
      <Text color={lineColor} dimColor={lineDimColor}>
        {text}
      </Text>
    );
  }
  const parts: React.ReactElement[] = [];
  let cursor = 0;
  for (let r = 0; r < ranges.length; r++) {
    const { start, end } = ranges[r];
    if (cursor < start) {
      parts.push(
        <Text key={`pre-${r}`} color={lineColor} dimColor={lineDimColor}>
          {text.slice(cursor, start)}
        </Text>,
      );
    }
    parts.push(
      isActiveLine ? (
        <Text key={`match-${r}`} backgroundColor="yellow" color="black">
          {text.slice(start, end)}
        </Text>
      ) : (
        <Text key={`match-${r}`} inverse>
          {text.slice(start, end)}
        </Text>
      ),
    );
    cursor = end;
  }
  if (cursor < text.length) {
    parts.push(
      <Text key="tail" color={lineColor} dimColor={lineDimColor}>
        {text.slice(cursor)}
      </Text>,
    );
  }
  return <>{parts}</>;
}

export function DetailViewPanel({
  activity,
  width,
  visibleRows,
  scrollOffset,
  searchQuery = "",
  activeMatchLine = null,
}: DetailViewPanelProps): React.ReactElement {
  const innerWidth = getInnerWidth(width);
  const contentWidth = innerWidth - 1;

  const body = activity.detailBody ?? activity.detail;
  const classifier =
    activity.detailKind === "diff"
      ? classifyDiffLines
      : activity.detailKind === "code"
        ? classifyCodeFences
        : activity.type === "commit"
          ? classifyDiffLines
          : classifyCodeFences;
  const preserveWhitespace =
    activity.detailKind === "diff" ||
    activity.detailKind === "code" ||
    activity.type === "commit";

  // Build wrapped lines annotated with the source line index so we can
  // scroll the active match into view without a second scroll system.
  const sourceLines = (body ?? "").split("\n");
  const categories = classifier(sourceLines);
  const allLines: Array<{
    text: string;
    category: LineCategory;
    sourceLineIdx: number;
  }> = [];
  if (!body) {
    allLines.push({ text: "(empty)", category: "prose", sourceLineIdx: 0 });
  } else {
    for (let si = 0; si < sourceLines.length; si++) {
      const line = sourceLines[si];
      const cat = categories[si] ?? "prose";
      if (!line) {
        allLines.push({ text: "", category: cat, sourceLineIdx: si });
        continue;
      }
      if (preserveWhitespace) {
        for (const chunk of hardWrapByWidth(line, contentWidth)) {
          allLines.push({ text: chunk, category: cat, sourceLineIdx: si });
        }
      } else {
        const words = line.split(" ");
        let current = "";
        for (const word of words) {
          if (!current) {
            current = word;
          } else if (getDisplayWidth(`${current} ${word}`) <= contentWidth) {
            current += ` ${word}`;
          } else {
            allLines.push({ text: current, category: cat, sourceLineIdx: si });
            current = word;
          }
        }
        if (current)
          allLines.push({ text: current, category: cat, sourceLineIdx: si });
      }
    }
    if (allLines.length === 0)
      allLines.push({ text: "(empty)", category: "prose", sourceLineIdx: 0 });
  }

  const totalLines = allLines.length;

  // If there is an active match, find the first rendered line for that source
  // line and snap the scroll offset so it appears in the visible window.
  let effectiveOffset = Math.min(
    scrollOffset,
    Math.max(0, totalLines - visibleRows),
  );
  if (activeMatchLine !== null && activeMatchLine !== undefined) {
    const renderedIdx = allLines.findIndex(
      (l) => l.sourceLineIdx === activeMatchLine,
    );
    if (renderedIdx !== -1) {
      // Scroll up if active match is above the window.
      if (renderedIdx < effectiveOffset) effectiveOffset = renderedIdx;
      // Scroll down if active match is below the window.
      if (renderedIdx >= effectiveOffset + visibleRows)
        effectiveOffset = Math.min(
          renderedIdx,
          Math.max(0, totalLines - visibleRows),
        );
    }
  }

  const clampedOffset = effectiveOffset;
  const visibleSlice = allLines.slice(
    clampedOffset,
    clampedOffset + visibleRows,
  );

  const style = getActivityStyle(activity);
  const scrollSuffix =
    totalLines > visibleRows
      ? `[${clampedOffset + 1}-${Math.min(clampedOffset + visibleRows, totalLines)}/${totalLines}]`
      : "";

  const iconWidth = getDisplayWidth(activity.icon);
  const labelWidth = activity.label.length;
  const scrollPart = scrollSuffix ? ` ${scrollSuffix} ${BOX.h}` : "";
  const scrollPartWidth = scrollSuffix ? getDisplayWidth(scrollPart) : 0;
  const dashCount = Math.max(
    0,
    width - 3 - iconWidth - 1 - labelWidth - 1 - scrollPartWidth - 1,
  );
  const dashes = BOX.h.repeat(dashCount);
  const titleRight = `${dashes}${scrollPart}${BOX.tr}`;

  const contentRows: React.ReactElement[] = [];
  for (let i = 0; i < visibleRows; i++) {
    const entry = visibleSlice[i] ?? {
      text: "",
      category: "prose" as const,
      sourceLineIdx: -1,
    };
    const padding = Math.max(0, contentWidth - getDisplayWidth(entry.text));
    const lineStyle = getLineStyle(entry.category);
    const gutterSplit = activity.detailNumbered
      ? splitLineNumberGutter(entry.text)
      : null;
    const isActiveLine =
      searchQuery !== "" &&
      activeMatchLine !== null &&
      activeMatchLine !== undefined &&
      entry.sourceLineIdx === activeMatchLine;
    contentRows.push(
      <Text key={i}>
        {BOX.v}{" "}
        {gutterSplit ? (
          <>
            <Text dimColor>{gutterSplit[0]}</Text>
            {searchQuery ? (
              renderHighlightedLine(
                gutterSplit[1],
                searchQuery,
                isActiveLine,
                lineStyle.color,
                lineStyle.dimColor,
              )
            ) : (
              <Text color={lineStyle.color} dimColor={lineStyle.dimColor}>
                {gutterSplit[1]}
              </Text>
            )}
          </>
        ) : searchQuery ? (
          renderHighlightedLine(
            entry.text,
            searchQuery,
            isActiveLine,
            lineStyle.color,
            lineStyle.dimColor,
          )
        ) : (
          <Text color={lineStyle.color} dimColor={lineStyle.dimColor}>
            {entry.text}
          </Text>
        )}
        {" ".repeat(padding)}
        {BOX.v}
      </Text>,
    );
  }

  return (
    <Box flexDirection="column" width={width}>
      <Text>
        {BOX.tl}
        {BOX.h} <Text color="cyan">{activity.icon}</Text>{" "}
        <Text color={style.color} dimColor={style.dimColor}>
          {activity.label}
        </Text>{" "}
        {titleRight}
      </Text>
      {contentRows}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
