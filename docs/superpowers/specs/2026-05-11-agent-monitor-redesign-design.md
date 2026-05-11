# AgentHUD v0.8 — Global Agent Monitor Redesign

## Overview

AgentHUD transitions from a project-scoped dashboard to a global Claude Code agent monitor. Run it anywhere; it auto-detects all active Claude sessions system-wide and displays them in a scrollable split-view with full activity history.

## Problem

- Current AgentHUD requires a `.agenthud/` directory in the project root, tying it to a specific working directory.
- Sub-agent activity is not visible: when the main agent spawns sub-agents via the `Task` tool, those sessions run invisibly.
- Activity history is ephemeral: once activities scroll off the panel, there's no way to review what happened earlier in the session.
- Git, Test, and Project panels are secondary concerns better served by dedicated tools.

## Goals

1. Auto-detect all running Claude Code sessions from `~/.claude/projects/`.
2. Display sessions in a tree (parent → sub-agents) with real-time status.
3. Provide a scrollable full-history viewer for any selected session.
4. Allow saving session logs to disk.
5. Move config to `~/.agenthud/config.yaml` (global, not per-project).

## Out of Scope

- Git, test, and project info panels (removed).
- Per-project `.agenthud/` config (removed; migration note in docs).
- Non-Claude agent integrations (n8n, LangGraph) — future work.

---

## Architecture

### Config

- **Location**: `~/.agenthud/config.yaml`
- **Removed**: `.agenthud/config.yaml` (project-level) — display a one-time migration warning if detected.
- Minimal config: refresh interval, session timeout threshold, log save directory.

```yaml
# ~/.agenthud/config.yaml
refreshInterval: 2s
sessionTimeout: 30m   # sessions idle longer than this are hidden
logDir: ~/.agenthud/logs
```

### Session Detection

- Scan all subdirectories under `~/.claude/projects/`.
- For each project directory, collect **all** JSONL files (a project can have multiple concurrent sessions).
- Parse each JSONL to determine session status: `running` (activity within `sessionTimeout`), `idle`, `done`.
- Detect sub-agent sessions by matching `Task` tool call results in parent JSONL to session IDs in child JSONL files. (Implementation detail: investigate exact linkage field in JSONL during development.)

### Data Layer

| Module | Responsibility |
|---|---|
| `src/data/sessions.ts` | Discover all sessions from `~/.claude/projects/` |
| `src/data/sessionHistory.ts` | Parse full activity history for a session (all JSONL entries) |
| `src/data/sessionTree.ts` | Build parent→child tree from session relationships |

Remove: `src/data/git.ts`, `src/data/tests.ts`, `src/data/project.ts`, `src/data/otherSessions.ts`, `src/data/detectTestFramework.ts`.

### UI Components

| Component | Responsibility |
|---|---|
| `src/ui/SessionTreePanel.tsx` | Top pane: tree of all sessions with status |
| `src/ui/ActivityViewerPanel.tsx` | Bottom pane: scrollable full history of selected session |
| `src/ui/App.tsx` | Split-view layout, focus management, keyboard routing |

Remove: `GitPanel.tsx`, `TestPanel.tsx`, `ProjectPanel.tsx`, `OtherSessionsPanel.tsx`, `GenericPanel.tsx`, `WelcomePanel.tsx`.

---

## UI Design

### Layout

```
┌─ AgentHUD ──────────────────────────────────┐
│ ► feat/auth       [running] 2m  sonnet-4.6  │  ← SessionTreePanel
│   ├─ » Agent 1    [done]    45s             │    (focus: tree)
│ → └─ » Agent 2    [running] 12s             │
│ ○ fix/bug-123     [idle]    8m              │
├─ Agent 2 ─────── ↑↓ scroll · s:save ───────┤
│  ○ Reading package.json                     │  ← ActivityViewerPanel
│  ~ Writing auth.middleware.ts               │    (focus: viewer)
│  $ npx tsc --noEmit                         │
│  ○ Reading tsconfig.json                    │
│  [LIVE ▼]                                   │
└─────────────────────────────────────────────┘
 Tab: switch focus · q: quit · r: refresh
```

### Session Tree Panel (top)

- Lists all detected sessions sorted by last activity (most recent first).
- Each session shows: icon, project name/branch, status badge, duration, model name.
- Sub-agents are indented under their parent with `├─ »` / `└─ »` prefix.
- Arrow keys `↑`/`↓` navigate between sessions (only when tree has focus).
- `Enter` or `Tab` moves focus to the viewer pane.
- Status badges: `[running]` (green), `[done]` (dim), `[idle]` (yellow).

### Activity Viewer Panel (bottom)

- Shows the **complete** activity history of the selected session from the first entry.
- Entries are rendered identically to the current ClaudePanel activity format (icon + label + detail).
- When at the bottom ("live" mode), new activities append automatically.
- Scrolling up pauses live mode; a `[LIVE ▼]` / `[PAUSED]` indicator shows current state.
- Pressing `G` resumes live mode and jumps to the bottom.

### Keyboard Shortcuts

| Key | Context | Action |
|---|---|---|
| `↑` / `↓` | Tree focus | Navigate sessions |
| `Tab` | Any | Toggle focus: tree ↔ viewer |
| `↑` / `↓` | Viewer focus | Scroll activity history |
| `g` | Viewer focus | Jump to first activity |
| `G` | Viewer focus | Jump to latest (resume live) |
| `s` | Viewer focus | Save session log to `logDir` |
| `r` | Any | Refresh session list |
| `q` | Any | Quit |

---

## Session History Storage

- All JSONL entries for a session are parsed and held in memory as `ActivityEntry[]`.
- No truncation — full history is retained for the session's lifetime in AgentHUD.
- On `s` key: write rendered text log to `~/.agenthud/logs/<YYYY-MM-DD>-<session-id>.txt`.
- Log format: plain text, one activity per line, with timestamp prefix.

---

## Error Handling

- If `~/.claude/projects/` does not exist: show "No Claude sessions found" message.
- If a JSONL file cannot be parsed: skip that session and show a dim warning entry.
- If `~/.agenthud/` does not exist: create it on first run.
- If project-level `.agenthud/config.yaml` is detected: show one-time warning "Config moved to ~/.agenthud/config.yaml".

---

## Testing

- Unit tests for `sessions.ts`, `sessionHistory.ts`, `sessionTree.ts` with fixture JSONL files.
- Unit tests for `SessionTreePanel` and `ActivityViewerPanel` using `ink-testing-library`.
- Integration test: full App render with mock session data (tree + viewer).
- Remove tests for deleted modules (git, tests, project, otherSessions, detectTestFramework).

---

## Migration Notes

- Users with `.agenthud/config.yaml` will see a one-time warning on startup.
- Custom panels feature (`customPanels` config) is removed in v0.8. Users relying on it should remain on v0.7.x.
- The `--dir` CLI flag is removed (no longer relevant without project-scoped panels).
