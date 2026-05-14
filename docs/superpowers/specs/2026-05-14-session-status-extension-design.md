# Session Status Extension Design

## Goal

Extend the Sessions panel with 4-level status (hot/warm/cool/cold), collapsible cold sessions, and a hide feature that persists to config.

## Architecture

### Status Thresholds

| Status | Criterion | Color |
|--------|-----------|-------|
| `hot`  | < 30 minutes | green |
| `warm` | 30 min – 1 hour | yellow |
| `cool` | today (calendar day), but > 1 hour ago | cyan |
| `cold` | before today (previous calendar days) | gray |

`cool` vs `cold` boundary is **calendar-based**, not elapsed-time-based. A session from today at 00:01 is `cool` even if 10 hours have passed; a session from yesterday at 23:59 is `cold`.

The existing `sessionTimeoutMs` config option is removed. These thresholds are hardcoded.

---

### Sessions Panel Layout

```
┌─ Sessions ──────────────────────────────────────┐
│ agenthud #a3f2 [hot]  ~/WestbrookAI/...     2m  │
│ ├─ » a26daaf [warm]  Task 3: Create...     45m  │
│ └─ ... 2 cool  1 cold                           │
│ zipsa #b2c1 [cool]  ~/WestbrookAI/...       3h  │
│ ── 3 cold ──────────────────────────────────── ↵ │
└─────────────────────────────────────────────────┘
```

- **hot/warm/cool** sessions always visible, sorted hot → warm → cool
- **cold** sessions hidden by default; a single `── N cold ──` summary row appears at the bottom
- Selecting the cold summary row and pressing Enter expands/collapses all cold sessions
- `hiddenSessions` from config are excluded entirely (not counted in cold summary)

---

### Sub-agent Display Rules

| Sub-agent status | Display |
|-----------------|---------|
| hot | shown individually |
| warm | shown individually |
| cool | collapsed into `... N cool` summary |
| cold | collapsed into `... N cold` summary |

When parent session is in `expandedIds` (Enter pressed): all sub-agents shown individually.

Sub-agent summary line format: `└─ ... 2 cool  1 cold`

`hiddenSubAgents` from config are excluded from counts and display.

---

### Hide Feature

Keyboard shortcut: **`h`**

- Pressed on a session row → adds session ID to `hiddenSessions` in config
- Pressed on a sub-agent row → adds sub-agent ID to `hiddenSubAgents` in config
- Pressed on `── N cold ──` summary → hides all cold sessions at once
- Config is written to disk immediately; UI refreshes

Un-hiding requires manual config file edit (out of scope for this version).

Config file (`~/.agenthud/config.yaml`):
```yaml
hiddenSessions:
  - abc12345def67890abc12345def67890
hiddenSubAgents:
  - a26daafb3c4d5e6f
```

---

## Files Changed

### `src/types/index.ts`
- `SessionStatus`: `"running" | "idle" | "done"` → `"hot" | "warm" | "cool" | "cold"`
- `GlobalConfig`: add `hiddenSessions: string[]`, `hiddenSubAgents: string[]`

### `src/ui/constants.ts`
- Keep `THIRTY_MINUTES_MS`
- Add `ONE_HOUR_MS = 60 * 60 * 1000`

### `src/data/sessions.ts`
- Replace `getSessionStatus()` with calendar-aware logic
- Filter hidden sessions/sub-agents in `discoverSessions()` and `buildSubAgents()`

### `src/config/globalConfig.ts`
- Parse `hiddenSessions` / `hiddenSubAgents` from YAML (default: `[]`)
- Remove `sessionTimeoutMs` (no longer used)
- Add `hideSession(id)` — appends ID to `hiddenSessions` and writes to standard config path
- Add `hideSubAgent(id)` — appends ID to `hiddenSubAgents` and writes to standard config path

### `src/ui/SessionTreePanel.tsx`
- Update `getStatusColor()` for hot/warm/cool/cold
- Add `FlatRow` kind: `cold-sessions-summary` (for the `── N cold ──` row)
- Update `flattenSessions()`: separate sub-agent cool/cold summary, build cold session summary row
- Add `ColdSessionsSummaryRow` component
- `expandedIds` now also tracks whether cold sessions are expanded (`"__cold__"` sentinel key)

### `src/ui/App.tsx`
- Update `flattenSessions()` to include cold sessions when `expandedIds.has("__cold__")`
- Add `onHide` handler: calls `hideSession()` or `hideSubAgent()`, then refreshes
- Enter on `── N cold ──` row: toggles `"__cold__"` in `expandedIds`

### `src/ui/hooks/useHotkeys.ts`
- Add `onHide` callback
- Bind `h` key → `onHide()`
- Add `h: hide` to tree statusBar items

---

## Testing

- `getSessionStatus()` unit tests: hot/warm/cool/cold boundaries including calendar-day edge cases
- `SessionTreePanel` render tests: cold summary row, expand/collapse cold, sub-agent cool/cold summaries
- `globalConfig` tests: parse `hiddenSessions`/`hiddenSubAgents`, `hideSession()`/`hideSubAgent()` write
- `useHotkeys` test: `h` key triggers `onHide`
