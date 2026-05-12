# Viewer UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the paused-mode reset bug in ActivityViewerPanel and improve the viewer UX: newest activities at top, paused title shows position + new-item badge.

**Architecture:** Two tasks, each TDD. Task 1 updates ActivityViewerPanel in isolation (new prop, reverse display, title). Task 2 fixes App.tsx's broken useEffect dep, adds newCount state, delta-anchored refresh, and swaps scroll direction for the viewer.

**Tech Stack:** TypeScript, React (Ink), Vitest, ink-testing-library

---

## File Map

| File | Changes |
|------|---------|
| `src/ui/ActivityViewerPanel.tsx` | Remove `hasFocus`, add `newCount`, reverse slice, update title |
| `src/ui/App.tsx` | Fix `useEffect` dep, add `allFlatRef` + `activitiesLengthRef`, add `newCount` state, fix `refresh`, swap viewer scroll directions, update JSX |
| `tests/ui/ActivityViewerPanel.test.tsx` | Remove `hasFocus` from all renders, add `newCount`, add 3 new tests |
| `tests/ui/App.test.tsx` | No changes needed (mocked sessions return empty list) |

---

## Task 1: ActivityViewerPanel — newest-at-top, newCount prop, paused title

**Files:**
- Modify: `src/ui/ActivityViewerPanel.tsx`
- Test: `tests/ui/ActivityViewerPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

Replace `tests/ui/ActivityViewerPanel.test.tsx` entirely:

```tsx
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../../src/types/index.js";
import { ActivityViewerPanel } from "../../src/ui/ActivityViewerPanel.js";

const makeActivity = (label: string, i: number): ActivityEntry => ({
  timestamp: new Date(1_700_000_000_000 + i * 1000),
  type: "tool",
  icon: "○",
  label,
  detail: `file${i}.ts`,
});

const baseProps = {
  sessionName: "s",
  scrollOffset: 0,
  isLive: true,
  newCount: 0,
  visibleRows: 10,
  width: 80,
};

describe("ActivityViewerPanel", () => {
  it("renders session name in title", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
        sessionName="feat/auth"
      />,
    );
    expect(lastFrame()).toContain("feat/auth");
  });

  it("renders activity label and detail", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
      />,
    );
    expect(lastFrame()).toContain("Read");
    expect(lastFrame()).toContain("file0.ts");
  });

  it("shows LIVE indicator when isLive is true", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
      />,
    );
    expect(lastFrame()).toContain("LIVE");
  });

  it("shows PAUSED indicator when isLive is false", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
        isLive={false}
      />,
    );
    expect(lastFrame()).toContain("PAUSED");
  });

  it("shows empty message when no activities", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel {...baseProps} activities={[]} />,
    );
    expect(lastFrame()).toContain("No activity");
  });

  it("shows newest activity first (at top of rendered output)", () => {
    const activities = [
      makeActivity("OldestAction", 0),
      makeActivity("MiddleAction", 1),
      makeActivity("NewestAction", 2),
    ];
    const { lastFrame } = render(
      <ActivityViewerPanel {...baseProps} activities={activities} />,
    );
    const frame = lastFrame() ?? "";
    const newestIdx = frame.indexOf("NewestAction");
    const oldestIdx = frame.indexOf("OldestAction");
    expect(newestIdx).toBeGreaterThanOrEqual(0);
    expect(oldestIdx).toBeGreaterThanOrEqual(0);
    expect(newestIdx).toBeLessThan(oldestIdx);
  });

  it("shows PAUSED title with scroll position indicator", () => {
    const activities = Array.from({ length: 20 }, (_, i) =>
      makeActivity("Read", i),
    );
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={activities}
        scrollOffset={5}
        isLive={false}
      />,
    );
    expect(lastFrame()).toContain("PAUSED");
    expect(lastFrame()).toContain("↓5");
  });

  it("shows new item badge in PAUSED title when newCount > 0", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
        scrollOffset={1}
        isLive={false}
        newCount={3}
      />,
    );
    expect(lastFrame()).toContain("+3↑");
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
npx vitest run tests/ui/ActivityViewerPanel.test.tsx
```

Expected: several failures — `hasFocus` prop still required, no `newCount` prop, display not reversed, no position indicator.

- [ ] **Step 3: Update ActivityViewerPanel**

Replace `src/ui/ActivityViewerPanel.tsx` with:

```tsx
import { Box, Text } from "ink";
import type React from "react";
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

export function getActivityStyle(activity: ActivityEntry): ActivityStyle {
  if (activity.type === "user") {
    return { color: "white", dimColor: false };
  }
  if (activity.type === "response") {
    return { color: "green", dimColor: false };
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
  width: number;
}

function formatActivityTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function truncateDetail(detail: string, maxWidth: number): string {
  if (getDisplayWidth(detail) <= maxWidth) return detail;
  let truncated = "";
  let currentWidth = 0;
  for (const char of detail) {
    const charWidth = getDisplayWidth(char);
    if (currentWidth + charWidth > maxWidth - 3) {
      truncated += "...";
      break;
    }
    truncated += char;
    currentWidth += charWidth;
  }
  return truncated;
}

export function ActivityViewerPanel({
  activities,
  sessionName,
  scrollOffset,
  isLive,
  newCount,
  visibleRows,
  width,
}: ActivityViewerPanelProps): React.ReactElement {
  const innerWidth = getInnerWidth(width);
  const contentWidth = innerWidth - 1;

  let titleSuffix: string;
  if (isLive) {
    titleSuffix = "[LIVE ▼]";
  } else {
    const badge = newCount > 0 ? ` +${newCount}↑` : "";
    titleSuffix = `[PAUSED ↓${scrollOffset}${badge}]`;
  }

  // Determine which slice to show, then reverse so newest is at top
  let visibleActivities: ActivityEntry[];
  if (activities.length === 0) {
    visibleActivities = [];
  } else if (isLive) {
    visibleActivities = activities.slice(-visibleRows).reverse();
  } else {
    const end = Math.max(0, activities.length - scrollOffset);
    const start = Math.max(0, end - visibleRows);
    visibleActivities = activities.slice(start, end).reverse();
  }

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
    for (let i = 0; i < visibleActivities.length; i++) {
      const activity = visibleActivities[i];
      const style = getActivityStyle(activity);

      const time = formatActivityTime(activity.timestamp);
      const timestamp = `[${time}] `;
      const timestampWidth = timestamp.length;
      const icon = activity.icon;
      const iconWidth = getDisplayWidth(icon);
      const label = activity.label;
      const detail = activity.detail;
      const count = activity.count;

      const countSuffix = count && count > 1 ? ` (×${count})` : "";
      const countSuffixWidth = countSuffix.length;

      const prefixWidth = 2 + timestampWidth + iconWidth + 1;
      const labelPart = detail ? `${label}: ` : label;
      const labelWidth = labelPart.length;
      const _availableForDetail =
        contentWidth - prefixWidth - labelWidth - countSuffixWidth + 1;
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
      let _displayWidth: number;

      if (detail) {
        const truncated = truncateDetail(detail, Math.max(0, detailMaxWidth));
        labelContent = `${labelPart}${truncated}${countSuffix}`;
        _displayWidth =
          prefixWidth -
          1 +
          labelWidth +
          getDisplayWidth(truncated) +
          countSuffixWidth;
      } else {
        labelContent = label + countSuffix;
        _displayWidth = prefixWidth - 1 + label.length + countSuffixWidth;
      }

      const usedWidth =
        1 +
        1 +
        timestampWidth +
        iconWidth +
        1 +
        getDisplayWidth(labelContent) +
        1;
      const padding = Math.max(0, width - usedWidth);

      lines.push(
        <Text key={`activity-${i}`}>
          {BOX.v} <Text dimColor>{timestamp}</Text>
          <Text color="cyan">{icon}</Text>{" "}
          <Text color={style.color} dimColor={style.dimColor}>
            {labelContent}
          </Text>
          {" ".repeat(padding)}
          {BOX.v}
        </Text>,
      );
    }
  }

  return (
    <Box flexDirection="column" width={width}>
      <Text color={isLive ? undefined : "yellow"}>
        {createTitleLine(sessionName, titleSuffix, width)}
      </Text>
      {lines}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
npx vitest run tests/ui/ActivityViewerPanel.test.tsx
```

Expected: 8 tests passing.

- [ ] **Step 5: Run full suite to check for regressions**

```bash
npx vitest run
```

Expected: all Vitest tests pass (Vitest strips types, so TypeScript prop mismatches don't cause runtime failures). However `npm run build` will fail until App.tsx is updated in Task 2 — that is expected and fine at this stage.

- [ ] **Step 6: Commit**

```bash
git add src/ui/ActivityViewerPanel.tsx tests/ui/ActivityViewerPanel.test.tsx
git commit -m "feat: newest-at-top display, paused title with position badge in ActivityViewerPanel"
```

---

## Task 2: App.tsx — bug fix, newCount state, delta refresh, scroll direction

**Files:**
- Modify: `src/ui/App.tsx`
- Test: `tests/ui/App.test.tsx` (no changes needed — mocked sessions return empty list, existing tests still pass)

- [ ] **Step 1: Verify existing App tests pass before changes**

```bash
npx vitest run tests/ui/App.test.tsx
```

Expected: 2 failures (TypeScript: `hasFocus` prop removed from ActivityViewerPanel, `newCount` missing). This confirms what needs to change.

- [ ] **Step 2: Rewrite App.tsx**

Replace `src/ui/App.tsx` with:

```tsx
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "../cli.js";
import {
  ensureLogDir,
  hasProjectLevelConfig,
  loadGlobalConfig,
} from "../config/globalConfig.js";
import { parseSessionHistory } from "../data/sessionHistory.js";
import { discoverSessions } from "../data/sessions.js";
import type {
  ActivityEntry,
  SessionNode,
  SessionTree,
} from "../types/index.js";
import { ActivityViewerPanel } from "./ActivityViewerPanel.js";
import { useHotkeys } from "./hooks/useHotkeys.js";
import { SessionTreePanel } from "./SessionTreePanel.js";

const VIEWER_HEIGHT_FRACTION = 0.55;

function flattenSessions(tree: SessionTree): SessionNode[] {
  const result: SessionNode[] = [];
  for (const s of tree.sessions) {
    result.push(s);
    result.push(...s.subAgents);
  }
  return result;
}

export function App({ mode }: { mode: "watch" | "once" }): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const isWatchMode = mode === "watch";

  const config = useMemo(() => loadGlobalConfig(), []);
  const migrationWarning = useMemo(() => hasProjectLevelConfig(), []);

  const [sessionTree, setSessionTree] = useState<SessionTree>(() =>
    discoverSessions(config),
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const first = sessionTree.sessions[0];
    return first?.id ?? null;
  });
  const [focus, setFocus] = useState<"tree" | "viewer">("tree");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isLive, setIsLive] = useState(true);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [newCount, setNewCount] = useState(0);

  const allFlat = useMemo(() => flattenSessions(sessionTree), [sessionTree]);

  // Ref so session-switch effect can read allFlat without it being a dep
  const allFlatRef = useRef<SessionNode[]>([]);
  useEffect(() => {
    allFlatRef.current = allFlat;
  }, [allFlat]);

  // Ref so refresh callback can read activities.length without it being a dep
  const activitiesLengthRef = useRef(0);
  useEffect(() => {
    activitiesLengthRef.current = activities.length;
  }, [activities.length]);

  // Reset scroll/live only when selected session changes, not on every refresh
  useEffect(() => {
    const node = allFlatRef.current.find((s) => s.id === selectedId);
    if (node) {
      setActivities(parseSessionHistory(node.filePath));
      setScrollOffset(0);
      setIsLive(true);
      setNewCount(0);
    } else {
      setActivities([]);
    }
  }, [selectedId]);

  const refresh = useCallback(() => {
    const tree = discoverSessions(config);
    setSessionTree(tree);
    const updatedFlat = flattenSessions(tree);
    const node = updatedFlat.find((s) => s.id === selectedId);
    if (!node) return;
    const newActivities = parseSessionHistory(node.filePath);
    const delta = newActivities.length - activitiesLengthRef.current;
    setActivities(newActivities);
    // In paused mode: anchor position by adjusting offset for new items
    if (!isLive && delta > 0) {
      setScrollOffset((o) => o + delta);
      setNewCount((n) => n + delta);
    }
  }, [config, selectedId, isLive]);

  // Auto-refresh in watch mode
  useEffect(() => {
    if (!isWatchMode) return;
    const timer = setInterval(refresh, config.refreshIntervalMs);
    return () => clearInterval(timer);
  }, [isWatchMode, refresh, config.refreshIntervalMs]);

  const selectedIndex = allFlat.findIndex((s) => s.id === selectedId);
  const height = stdout?.rows ?? 40;
  const width = stdout?.columns ?? 80;
  const viewerRows = Math.max(
    5,
    Math.floor(height * VIEWER_HEIGHT_FRACTION) - 4,
  );

  const saveLog = useCallback(() => {
    if (!activities.length || !selectedId) return;
    ensureLogDir(config.logDir);
    const date = new Date().toISOString().slice(0, 10);
    const filePath = join(
      config.logDir,
      `${date}-${selectedId.slice(0, 8)}.txt`,
    );
    const lines = activities.map(
      (a) => `[${a.timestamp.toISOString()}] ${a.icon} ${a.label} ${a.detail}`,
    );
    try {
      writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
    } catch {
      // silently fail — log dir may not be writable
    }
  }, [activities, selectedId, config.logDir]);

  const { handleInput, statusBarItems } = useHotkeys({
    focus,
    onSwitchFocus: () => setFocus((f) => (f === "tree" ? "viewer" : "tree")),
    onScrollUp: () => {
      if (focus === "tree") {
        const prev = Math.max(0, selectedIndex - 1);
        setSelectedId(allFlat[prev]?.id ?? selectedId);
      } else {
        // ↑ = toward newer (decrease offset, newest is at top)
        setScrollOffset((o) => {
          const newOffset = Math.max(0, o - 1);
          if (newOffset === 0) {
            setIsLive(true);
            setNewCount(0);
          }
          return newOffset;
        });
      }
    },
    onScrollDown: () => {
      if (focus === "tree") {
        const next = Math.min(allFlat.length - 1, selectedIndex + 1);
        setSelectedId(allFlat[next]?.id ?? selectedId);
      } else {
        // ↓ = toward older (increase offset, newest is at top)
        setIsLive(false);
        setScrollOffset((o) =>
          Math.min(o + 1, Math.max(0, activities.length - viewerRows)),
        );
      }
    },
    onScrollTop: () => {
      // g = jump to oldest (maximum scrollOffset)
      setIsLive(false);
      setScrollOffset(Math.max(0, activities.length - viewerRows));
    },
    onScrollBottom: () => {
      // G = jump to newest (live, scrollOffset 0)
      setIsLive(true);
      setScrollOffset(0);
      setNewCount(0);
    },
    onSaveLog: saveLog,
    onRefresh: refresh,
    onQuit: exit,
  });

  useInput((input, key) => handleInput(input, key), { isActive: isWatchMode });

  const selectedSession = allFlat.find((s) => s.id === selectedId);
  const sessionDisplayName =
    selectedSession?.projectName ||
    (selectedId ? `agent-${selectedId.slice(0, 6)}` : "No session selected");

  return (
    <Box flexDirection="column">
      {migrationWarning && (
        <Box marginBottom={1}>
          <Text color="yellow">Config moved to ~/.agenthud/config.yaml</Text>
        </Box>
      )}

      <SessionTreePanel
        sessions={sessionTree.sessions}
        selectedId={selectedId}
        hasFocus={focus === "tree"}
        width={width}
      />

      <Box marginTop={1}>
        <ActivityViewerPanel
          activities={activities}
          sessionName={sessionDisplayName}
          scrollOffset={scrollOffset}
          isLive={isLive}
          newCount={newCount}
          visibleRows={viewerRows}
          width={width}
        />
      </Box>

      {isWatchMode && (
        <Box marginTop={1} justifyContent="space-between" width={width}>
          <Text dimColor>{statusBarItems.join(" · ")}</Text>
          <Text dimColor>AgentHUD v{getVersion()}</Text>
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass. If TypeScript errors appear, check that `hasFocus` is fully removed from the `ActivityViewerPanel` JSX in App.tsx and `newCount` is present.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: Build success with no errors.

- [ ] **Step 5: Lint**

```bash
npm run lint
```

Expected: no errors. If any appear, run `npm run lint:fix` and re-check.

- [ ] **Step 6: Commit**

```bash
git add src/ui/App.tsx
git commit -m "fix: anchor scroll position in paused mode, swap viewer scroll direction for newest-at-top"
```
