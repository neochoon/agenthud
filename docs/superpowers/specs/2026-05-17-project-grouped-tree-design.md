# Project-Grouped Session Tree Design

## Goal

Restructure the AgentHUD session tree so sessions are grouped under their project (instead of each session appearing as a top-level row). Non-interactive (`claude -p` / SDK) sessions are visually distinguished but kept inline with their project. Reduces tree clutter when a project has many sessions (common after frequent `agenthud summary` runs or interactive restarts without `-c`).

## Current Problem

- Every JSONL file under `~/.claude/projects/<encoded-cwd>/` shows as its own top-level row.
- A single project with N interactive sessions + M non-interactive (`claude -p`) sessions produces N+M top-level rows.
- Users cannot easily see "all activity for project X" — it's spread across many sibling rows.
- Non-interactive sessions (from `agenthud summary`) accumulate quickly and obscure real sessions.

## Tree Structure

```
┌─ Sessions ────────────────────────────────────────────────┐
│ > agenthud                                                │
│     #864f [hot] sonnet-4.6                                │
│       » sub-agent-1                                       │
│       » sub-agent-2                                       │
│     #abc1 [warm] opus-4.7                                 │
│     (#398c [hot])                                         │
│     (#e31f [warm])                                        │
│   myproject                                               │
│     #def4 [hot] sonnet-4.6                                │
│   dotfiles                                                │
│     #ghi5 [cool] haiku-4.5                                │
│ ... 12 cold projects                                      │
└───────────────────────────────────────────────────────────┘
```

**Levels:**
- **Project node** (depth 0) — project name only; no status badge of its own; sortable by hottest session.
- **Session node** (depth 1) — `#XXXX [status] model` format. Non-interactive shown with parentheses + dim color.
- **Sub-agent node** (depth 2) — `» {agentId or task description}`; nested under its parent session.

**Cold summary row** — applies to *projects* whose every session is cold. Bottom-of-tree, expandable like today.

## Visual Treatment

| Element | Treatment |
|---------|-----------|
| Interactive session | Default color (varies by status) |
| Non-interactive session | Parentheses around id (`(#398c)`) + dim color throughout the row |
| Project header | Bright; bold if user wants (no badge, just name) |
| Cold projects | Hidden behind expandable `... N cold projects` row at the bottom |

The string `"<synthetic>"` in the JSONL model field is no longer used as a category label; `entrypoint === "sdk-cli"` from the first JSONL line is the authoritative signal for non-interactive sessions.

## Default Expand State

| Node | Default |
|------|---------|
| Project | Expanded (sessions visible) |
| Session's sub-agents | Existing behavior (collapsed when only cool/cold sub-agents present) |
| Cold projects group | Collapsed (existing global cold behavior) |

## Sorting

| Level | Sort key |
|-------|----------|
| Projects | Hottest session's status (hot/warm/cool/cold), then most-recent mtime |
| Sessions within a project | Interactive first → non-interactive; within each group, status → mtime |
| Sub-agents | Existing behavior |

## Keyboard Behavior

| Action | Project node | Session node | Sub-agent |
|--------|--------------|--------------|-----------|
| `↑↓` / `jk` | Move selection (flat traversal) | Same | Same |
| `↵` Enter | Toggle expand/collapse | Existing: toggle sub-agent group (only when cool/cold sub-agents exist) | Existing |
| `h` Hide | Add project name to `hiddenProjects` config | Existing: add `hideKey` to `hiddenSessions` | Existing: add to `hiddenSubAgents` |
| Selection → viewer | Show activity of the project's hottest session | Show that session's activity | Show that sub-agent's activity |

Note: pressing `↵` on a project doesn't change the activity viewer; it only toggles visibility of its sessions. The viewer follows whichever session is selected.

## Types

```typescript
// New
export interface ProjectNode {
  name: string;             // basename(projectPath)
  projectPath: string;      // decoded full path
  sessions: SessionNode[];  // sorted (see Sorting)
  hotness: SessionStatus;   // hottest session's status (used for sort + cold-grouping decision)
}

// Modified
export interface SessionNode {
  // existing fields...
  nonInteractive: boolean;  // NEW — true when entrypoint === "sdk-cli"
}

// Modified
export interface SessionTree {
  projects: ProjectNode[];  // REPLACES `sessions`
  totalCount: number;       // count of all sessions across all projects
  timestamp: string;
}

// Modified
export interface GlobalConfig {
  // existing fields...
  hiddenProjects: string[]; // NEW — by projectName (e.g. "agenthud")
}
```

## Files

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `ProjectNode`, `nonInteractive`, `hiddenProjects` |
| `src/data/sessions.ts` | Build `ProjectNode[]` instead of flat `SessionNode[]`; read `entrypoint` per session |
| `src/data/activityParser.ts` or new helper | Add `readEntrypoint(filePath): string \| null` |
| `src/config/globalConfig.ts` | Parse `hiddenProjects` from YAML; add `hideProject(name)` write helper |
| `src/ui/SessionTreePanel.tsx` | Add `kind: "project"` to `FlatRow` union; render at depth 0; nest sessions at depth 1; sub-agents at depth 2; non-interactive style |
| `src/ui/App.tsx` | Update `flattenSessions` for new structure; `onEnter`/`onHide` branches for project; selection-to-activity wiring for project (hottest session) |
| Tests (multiple) | Update mock data shape and new test cases |

## Data Flow

```
discoverSessions(config)
  └─ for each project dir:
       ├─ skip if config.hiddenProjects.includes(projectName)
       └─ for each .jsonl file:
            ├─ stat → mtime, status
            ├─ readModelName(filePath)
            ├─ readEntrypoint(filePath)         // NEW — first line only
            ├─ readSubAgentInfo if relevant
            └─ → SessionNode { ..., nonInteractive: entrypoint === "sdk-cli" }
       └─ group → ProjectNode { name, projectPath, sessions, hotness }
  └─ partition projects into { active, cold } (cold = hotness === "cold")
  └─ sort active by hotness then mtime
  └─ return { projects: [...active, ...wrap(cold)], totalCount, timestamp }
```

The cold-projects group is represented by either:
- A separate field on `SessionTree`, e.g., `coldProjects: ProjectNode[]`, OR
- Inline at the end of `projects` and detected at render time by checking `hotness === "cold"`

Decision: use a separate field `SessionTree.coldProjects` so the panel's tree-flattening logic stays simple.

```typescript
export interface SessionTree {
  projects: ProjectNode[];
  coldProjects: ProjectNode[];
  totalCount: number;
  timestamp: string;
}
```

## Entrypoint Detection

Read the **first non-empty line** of the JSONL file and JSON-parse it. Use the `entrypoint` field if present.

```typescript
function readEntrypoint(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const firstLine = readFileSync(filePath, "utf-8").split("\n")[0];
    if (!firstLine) return null;
    const entry = JSON.parse(firstLine);
    return typeof entry.entrypoint === "string" ? entry.entrypoint : null;
  } catch {
    return null;
  }
}
```

`nonInteractive = readEntrypoint(filePath) === "sdk-cli"`. Defaults to `false` when undetectable (safer to show as interactive than hide).

## Selection & Activity Loading

When `selectedId` is a project name (prefixed with `__proj-` to disambiguate from session UUIDs):
- Activity viewer shows the project's hottest session's activities.
- Git commits panel uses that hottest session's projectPath.
- If the project has zero sessions visible (all hidden individually), activity viewer is empty.

Project selection IDs follow the same sentinel pattern used today for `__cold__` and `__sub-{id}__`:
- `__proj-{projectName}__` — selectable, expandable.

## Migration

- `SessionTree.sessions` is renamed to `SessionTree.projects` — a breaking change for any external consumer. Only internal callers exist; update all in this PR.
- `hiddenSessions` (by `hideKey`) remains unchanged — users keep their existing per-session hides.
- `hiddenProjects` is additive.

## Edge Cases

| Case | Behavior |
|------|----------|
| Project has only non-interactive sessions | Shown as a project; all sessions parenthesized + dim |
| All sessions in a project hidden via `hiddenSessions` | Project header still rendered (its sessions are just empty); selecting it shows "no session" |
| `entrypoint` field missing in older JSONL | Treat as interactive (safer default) |
| Hidden project (`hiddenProjects`) | Entire project + all its sessions skipped from tree and `totalCount` |
| Project name collision (two different cwds basename to same name) | Each project keeps its own `projectPath`; UI shows duplicate names. Disambiguate later if it becomes a real problem. |

## Testing

- `src/data/sessions.ts`
  - Builds `ProjectNode[]` from multiple project dirs
  - Within a project, sessions sorted interactive→non-interactive, then by status
  - `nonInteractive` reflects `entrypoint === "sdk-cli"` from first line
  - Defaults to interactive when `entrypoint` missing/unparseable
  - `hiddenProjects` filters out entire projects
  - Cold projects (all sessions cold) go into `coldProjects`
- `src/config/globalConfig.ts`
  - Parses `hiddenProjects` from YAML
  - `hideProject(name)` appends without duplication
- `src/ui/SessionTreePanel.tsx`
  - Renders project header at depth 0
  - Renders sessions at depth 1 with correct indentation
  - Non-interactive sessions show parens + dim style
  - Cold projects group expands/collapses
- `src/ui/App.tsx`
  - `flattenSessions` produces correct flat list (project → sessions → sub-agents)
  - Pressing `↵` on a project toggles its expansion
  - Pressing `h` on a project hides the whole project
  - Selecting a project loads hottest session's activities
- Manual smoke
  - Run `agenthud` with mixed interactive + non-interactive sessions; verify grouping looks right
  - Hide a project, re-launch, confirm it's gone

## Out of Scope

- Per-project subgroups for sub-agents (sub-agents already nest under their session)
- Multi-cwd project disambiguation (acknowledged but deferred)
- Re-categorizing existing `hiddenSessions` entries
- Reworking the activity viewer to show "project-level" aggregated activities (always shows a single session at a time)
