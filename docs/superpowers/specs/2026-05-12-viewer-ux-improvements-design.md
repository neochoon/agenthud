# ActivityViewer UX Improvements Design

## Overview

Two related UX problems in the ActivityViewerPanel, fixed together:

1. **Display order**: newest activities should appear at the top, not the bottom.
2. **Paused mode stability**: a bug causes refresh to reset scroll position and exit paused mode unexpectedly; paused mode also needs a position indicator and new-item badge.

---

## Problem 1: Display Direction

Currently activities render oldest-at-top, newest-at-bottom (chat style). For an agent monitor the user primarily wants to see what the agent is doing *right now*, so newest-at-top is more natural — the live view always shows the latest action without requiring the user to scroll.

**New behaviour:**
- Live mode: newest activity at row 1, older below.
- Reading (paused) mode: pressing `↓` goes further back in history; pressing `↑` returns toward newer content.

**Implementation:** keep `activities[]` in natural JSONL order (oldest index 0, newest index N). Reverse the rendered slice: `slice(...).reverse()`.

---

## Problem 2: Paused Mode Bug + UX

### Bug

`useEffect` that loads activities has `allFlat` in its dependency array. `allFlat` is recomputed on every refresh, so the effect fires every 2 s and calls `setScrollOffset(0)` and `setIsLive(true)` — forcibly ejecting the user from paused mode.

**Fix:** use a ref to access `allFlat` inside the effect so only `selectedId` is a real dependency. The effect resets scroll/live only when the selected session actually changes.

```
allFlatRef (ref) ← updated every render, no dep needed
useEffect([selectedId]) → reset scroll + live + load activities
```

### Paused Mode: Position-Anchored Refresh

While paused, the refresh callback still loads new activities. To keep the viewed window stable:

```
delta = newActivities.length - prev activities.length
if (delta > 0 && !isLive):
  scrollOffset += delta   // anchor: same items stay visible
  newCount    += delta    // badge counter
```

`newCount` resets to 0 when the user returns to live mode (`G` key or scrollOffset reaches 0).

`activitiesLength` is tracked in a ref so it can be read inside `useCallback` without adding `activities` to the dependency array.

### Scroll Semantics (viewer focus, newest-at-top)

| Key | Action |
|-----|--------|
| `↑` / `k` | Newer (scrollOffset − 1, if 0 → live) |
| `↓` / `j` | Older (scrollOffset + 1, capped at max) |
| `G` | Live mode — jump to newest (top) |
| `g` | Jump to oldest (bottom) |
| `s` | Save log |

Max scrollOffset = `Math.max(0, activities.length - viewerRows)`.

---

## Visual Design

### Title Bar

| Mode | Colour | Suffix example |
|------|--------|----------------|
| Live | default (white) | `[LIVE ▼]` |
| Paused, no new items | yellow | `[PAUSED ↓10]` |
| Paused, new items waiting | yellow | `[PAUSED ↓10 +5↑]` |

- `↓10` = scrolled 10 rows down from newest (= `scrollOffset`).
- `+5↑` = 5 new activities arrived above the current view while paused.

### ActivityViewerPanel Props

Add `newCount: number` prop. Remove unused `hasFocus` prop (currently `_hasFocus`).

```ts
export interface ActivityViewerPanelProps {
  activities: ActivityEntry[];
  sessionName: string;
  scrollOffset: number;
  isLive: boolean;
  newCount: number;      // new
  visibleRows: number;
  width: number;
}
```

### Slice & Reverse

```ts
// Paused
const end   = Math.max(0, activities.length - scrollOffset);
const start = Math.max(0, end - visibleRows);
visibleActivities = activities.slice(start, end).reverse();

// Live
visibleActivities = activities.slice(-visibleRows).reverse();
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/ui/App.tsx` | Bug fix (allFlatRef), newCount state, refresh delta logic, scroll key direction swap |
| `src/ui/ActivityViewerPanel.tsx` | Add newCount prop, remove hasFocus, title colour + position + badge, reverse slice |
| `tests/ui/ActivityViewerPanel.test.tsx` | Update props, add newest-at-top + paused title tests |
| `tests/ui/App.test.tsx` | Add paused-mode stability test |

---

## Out of Scope

- Cursor/highlight on a specific line (not requested).
- Changing the activities data model or JSONL parsing.
- Any changes to SessionTreePanel.
