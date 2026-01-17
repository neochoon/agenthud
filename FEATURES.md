# Features

## Git Data Collection

- **Added**: 2026-01-09
- **Issue**: #1
- **Status**: Complete
- **Tests**: `tests/git.test.ts`
- **Source**: `src/data/git.ts`, `src/types/index.ts`

### Functions

| Function | Description | Return Type |
|----------|-------------|-------------|
| `getCurrentBranch()` | Get current git branch name | `string \| null` |
| `getTodayCommits()` | Get commits since midnight | `Commit[]` |
| `getTodayStats()` | Get lines added/deleted today | `GitStats` |

### Types

```typescript
interface Commit {
  hash: string;
  message: string;
  timestamp: Date;
}

interface GitStats {
  added: number;
  deleted: number;
}
```

## GitPanel Component

- **Added**: 2026-01-09
- **Issue**: #3
- **Status**: Complete
- **Tests**: `tests/GitPanel.test.tsx`
- **Source**: `src/ui/GitPanel.tsx`

### Usage

```tsx
import { GitPanel } from "./ui/GitPanel.js";

<GitPanel
  branch="feat/1-git-data"
  commits={commits}
  stats={{ added: 142, deleted: 23 }}
/>
```

### Display

```
┌─ Git ────────────────────────────────────┐
│ Branch: feat/1-git-data                  │
├──────────────────────────────────────────┤
│ Today: +142 -23 (3 commits)              │
│ • abc1234 Add login feature              │
│ • def5678 Fix bug                        │
│ • 890abcd Update docs                    │
└──────────────────────────────────────────┘
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `branch` | `string \| null` | Current branch name |
| `commits` | `Commit[]` | Today's commits (max 5 shown) |
| `stats` | `GitStats` | Lines added/deleted |

## CLI Entry Point

- **Added**: 2026-01-09
- **Issue**: #5
- **Status**: Complete
- **Tests**: `tests/cli.test.ts`, `tests/App.test.tsx`
- **Source**: `src/cli.ts`, `src/index.ts`, `src/ui/App.tsx`

### Usage

```bash
# Watch mode (default) - refreshes every 5 seconds
agenthud
agenthud --watch
agenthud -w

# One-shot mode - print and exit
agenthud --once
```

### Keyboard Shortcuts (watch mode)

| Key | Action |
|-----|--------|
| `q` | Quit |
| `r` | Refresh immediately |

### Building

```bash
npm run build
node dist/index.js --once
```

## PlanPanel Component

- **Added**: 2026-01-09
- **Issue**: #9
- **Status**: Complete
- **Tests**: `tests/plan.test.ts`, `tests/PlanPanel.test.tsx`
- **Source**: `src/data/plan.ts`, `src/ui/PlanPanel.tsx`

### Display

```
┌─ Plan ───────────────────────────────────┐
│ Build agenthud CLI tool           │
├──────────────────────────────────────────┤
│ ✓ Set up project                         │
│ ✓ Implement git data collection          │
│ → Create GitPanel UI component           │
│ ○ Add CLI entry point                    │
├──────────────────────────────────────────┤
│ 2/4 steps done                           │
├─ Decisions ──────────────────────────────┤
│ • Use Ink for terminal UI                │
│ • Use dependency injection for testing   │
└──────────────────────────────────────────┘
```

### Data Sources

| File | Required | On Missing |
|------|----------|------------|
| `.agenthud/plan.json` | Yes | "No plan found" |
| `.agenthud/decisions.json` | No | Hide section |

### Status Icons

| Status | Icon | Color |
|--------|------|-------|
| done | ✓ | green |
| in-progress | → | yellow |
| pending | ○ | dim |

### Props

| Prop | Type | Description |
|------|------|-------------|
| `plan` | `Plan \| null` | Plan data |
| `decisions` | `Decision[]` | Recent decisions (max 3) |
| `error` | `string?` | Error message |

## TestPanel Component

- **Added**: 2026-01-09
- **Issue**: #11
- **Status**: Complete
- **Tests**: `tests/tests.test.ts`, `tests/TestPanel.test.tsx`
- **Source**: `src/data/tests.ts`, `src/ui/TestPanel.tsx`, `scripts/save-test-results.ts`

### Display

```
┌─ Tests ──────────────────────────────────┐
│ ✓ 67 passed  ✗ 0 failed  · 860649e · 5m ago │
└──────────────────────────────────────────┘
```

With failures:
```
┌─ Tests ──────────────────────────────────┐
│ ✓ 30 passed  ✗ 2 failed  · abc1234 · 5m ago │
├──────────────────────────────────────────┤
│ ✗ tests/git.test.ts                      │
│   • returns null                         │
│ ✗ tests/App.test.tsx                     │
│   • renders correctly                    │
└──────────────────────────────────────────┘
```

Outdated (hash differs from HEAD):
```
│ ⚠ Outdated (3 commits behind)           │
```

### Saving Test Results

```bash
npm run test:save
```

Creates `.agenthud/test-results.json`:
```json
{
  "hash": "abc1234",
  "timestamp": "2026-01-09T16:00:00Z",
  "passed": 67,
  "failed": 0,
  "skipped": 0,
  "failures": []
}
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `results` | `TestResults \| null` | Test results data |
| `isOutdated` | `boolean` | Hash differs from HEAD |
| `commitsBehind` | `number` | Commits since test run |
| `error` | `string?` | Error message |

## Init Command

- **Added**: 2026-01-10
- **Issue**: #13
- **Status**: Complete
- **Tests**: `tests/init.test.ts`, `tests/WelcomePanel.test.tsx`
- **Source**: `src/commands/init.ts`, `src/ui/WelcomePanel.tsx`

### Usage

```bash
npx agenthud init
```

### Behavior

1. **Welcome screen**: When running `agenthud` without `.agenthud/` directory:
```
┌─ Welcome to agenthud ────────────────────────────────────┐
│                                                          │
│   No .agenthud/ directory found.                            │
│                                                          │
│   Quick setup:                                           │
│      npx agenthud init                                   │
│                                                          │
│   Or visit: github.com/neochoon/agenthud                 │
│                                                          │
│   Press q to quit                                        │
└──────────────────────────────────────────────────────────┘
```

2. **Init command** creates:
   - `.agenthud/plan.json`: `{}`
   - `.agenthud/decisions.json`: `[]`
   - `.agenthud/config.yaml`: Default config
   - `.gitignore` with `.agenthud/` (or appends if exists)
   - `CLAUDE.md` with Agent State section (or appends if exists)

### Files Created

| File | Content |
|------|---------|
| `.agenthud/plan.json` | `{}` |
| `.agenthud/decisions.json` | `[]` |
| `.agenthud/config.yaml` | Default config |
| `.gitignore` | `.agenthud/` |
| `CLAUDE.md` | Agent State section |

### CLAUDE.md Section

```markdown
## Agent State

Maintain `.agenthud/` directory:
- Update `plan.json` when plan changes
- Append to `decisions.json` for key decisions
```

## Config System

- **Added**: 2026-01-10
- **Issue**: #17, #19
- **Status**: Complete
- **Tests**: `tests/config.test.ts`, `tests/config-integration.test.tsx`, `tests/runner.test.ts`
- **Source**: `src/config/parser.ts`, `src/runner/command.ts`, `src/data/git.ts`, `src/data/plan.ts`

### Configuration File

Create `.agenthud/config.yaml`:

```yaml
# agenthud configuration
panels:
  git:
    enabled: true
    interval: 30s
    command:
      branch: git branch --show-current
      commits: git log --since=midnight --pretty=format:"%h|%aI|%s"
      stats: git log --since=midnight --numstat --pretty=format:""

  plan:
    enabled: true
    interval: 10s
    source: .agenthud/plan.json

  tests:
    enabled: true
    interval: manual
    command: npm test -- --reporter=json
```

### Panel Options

| Option | Type | Description |
|--------|------|-------------|
| `enabled` | `boolean` | Show/hide panel |
| `interval` | `string` | Refresh interval (`30s`, `5m`, `manual`) |
| `command` | `string/object` | Shell command(s) to run |
| `source` | `string` | (plan only) Path to plan.json |

### Config-Driven Data

| Panel | Data Source | Config Field |
|-------|-------------|--------------|
| Git | Shell commands | `git.command.{branch,commits,stats}` |
| Plan | File read | `plan.source` |
| Tests | Shell command | `tests.command` |

### Interval Values

| Value | Description |
|-------|-------------|
| `30s` | Refresh every 30 seconds |
| `5m` | Refresh every 5 minutes |
| `manual` | Only refresh on 'r' key press |

### Per-Panel Refresh

Each panel refreshes independently based on its `interval`:
- Git: Default 30s (doesn't change often)
- Plan: Default 10s (Claude updates it frequently)
- Tests: Default manual (expensive to run)

### Command Runner

When `command` is specified for tests panel, agenthud will:
1. Execute the command
2. Parse JSON output (Vitest format)
3. Display results in Tests panel

```yaml
panels:
  tests:
    enabled: true
    interval: manual
    command: npm test -- --reporter=json
```

### Default Behavior

- No config.yaml: Uses hardcoded defaults
- Missing field: Uses default silently
- Invalid field: Shows warning, uses default

## Generic Panel Component

- **Added**: 2026-01-10
- **Issue**: #21
- **Status**: Complete
- **Tests**: `tests/GenericPanel.test.tsx`, `tests/config.test.ts`
- **Source**: `src/ui/GenericPanel.tsx`, `src/data/custom.ts`, `src/config/parser.ts`

### Overview

GenericPanel allows users to define custom panels in config.yaml that display data from shell commands or JSON files.

### Configuration

```yaml
panels:
  # Custom panel with shell command
  docker:
    enabled: true
    command: docker ps --format '{"title":"Docker","items":[...]}'
    renderer: list
    interval: 30s

  # Custom panel with file source
  status:
    enabled: true
    source: .agenthud/status.json
    renderer: status
    interval: manual
```

### Renderer Types

| Type | Use Case | Display |
|------|----------|---------|
| `list` | Default, bullet points | `• item 1`<br>`• item 2` |
| `progress` | Checklist with progress bar | `┌─ Title ──── 7/10 ███████░░░ ─┐` |
| `status` | Pass/fail summary | `✓ 10 passed  ✗ 2 failed` |

### Data Format

Commands and source files should output JSON in this format:

```typescript
interface GenericPanelData {
  title: string;           // Panel title
  summary?: string;        // One-line summary
  items?: Array<{
    text: string;
    status?: "done" | "pending" | "failed";
  }>;
  progress?: {
    done: number;
    total: number;
  };
  stats?: {
    passed: number;
    failed: number;
    skipped?: number;
  };
}
```

### Examples

#### List Renderer
```json
{
  "title": "Docker",
  "summary": "3 containers running",
  "items": [
    { "text": "nginx:latest" },
    { "text": "redis:alpine" },
    { "text": "postgres:15" }
  ]
}
```

Display:
```
┌─ Docker ──────────────────────────────── ↻ 25s ─┐
│ 3 containers running                            │
│ • nginx:latest                                  │
│ • redis:alpine                                  │
│ • postgres:15                                   │
└─────────────────────────────────────────────────┘
```

#### Progress Renderer
```json
{
  "title": "Build",
  "progress": { "done": 7, "total": 10 },
  "items": [
    { "text": "Compile", "status": "done" },
    { "text": "Test", "status": "done" },
    { "text": "Deploy", "status": "pending" }
  ]
}
```

Display:
```
┌─ Build ───────────────────── 7/10 ███████░░░ ─┐
│ ✓ Compile                                      │
│ ✓ Test                                         │
│ ○ Deploy                                       │
└────────────────────────────────────────────────┘
```

#### Status Renderer
```json
{
  "title": "Lint",
  "stats": { "passed": 100, "failed": 0 }
}
```

Display:
```
┌─ Lint ──────────────────────────── just now ─┐
│ ✓ 100 passed                                  │
└───────────────────────────────────────────────┘
```

### Line-Separated Output

If the command output is not valid JSON, each line becomes an item:

```bash
# Command output:
nginx
redis
postgres

# Displayed as:
┌─ Containers ─────────────────────────────────┐
│ • nginx                                       │
│ • redis                                       │
│ • postgres                                    │
└───────────────────────────────────────────────┘
```

### Hotkeys for Manual Panels

Custom panels with `interval: manual` get auto-assigned hotkeys:
- First letter of panel name
- Next letter if conflict

Status bar shows: `d: run docker · t: run tests · r: refresh · q: quit`

### Props

| Prop | Type | Description |
|------|------|-------------|
| `data` | `GenericPanelData` | Panel data |
| `renderer` | `"list" \| "progress" \| "status"` | Renderer type |
| `countdown` | `number \| null` | Countdown seconds |
| `relativeTime` | `string` | Relative time (for manual) |
| `error` | `string` | Error message |

## Visual Feedback for Refresh/Run

- **Added**: 2026-01-10
- **Issue**: #23
- **Status**: Complete
- **Tests**: `tests/GitPanel.test.tsx`, `tests/PlanPanel.test.tsx`, `tests/TestPanel.test.tsx`, `tests/GenericPanel.test.tsx`
- **Source**: `src/ui/App.tsx`, `src/ui/GitPanel.tsx`, `src/ui/PlanPanel.tsx`, `src/ui/TestPanel.tsx`, `src/ui/GenericPanel.tsx`, `src/data/git.ts`, `src/data/custom.ts`

### Overview

Panels now provide visual feedback when refreshing or running commands:

1. **"running..."** in yellow while command executes
2. **"just now"** in green for 1.5s after completion
3. **Countdown in green** for 1.5s when timer resets

### Async Command Execution

Commands now execute asynchronously, allowing the UI to remain responsive:
- Git panel commands run in parallel
- Custom panel commands run independently
- UI updates immediately when command starts

### Visual States

| State | Display | Duration | Panels |
|-------|---------|----------|--------|
| Running | "running..." (yellow) | While executing | Git, Tests, Custom |
| Just Completed | "just now" (green) | 1.5s | Tests |
| Just Refreshed | Countdown in green | 1.5s | Git, Plan, Custom |

### Props Added

#### GitPanel
| Prop | Type | Description |
|------|------|-------------|
| `isRunning` | `boolean` | Shows "running..." in title |
| `justRefreshed` | `boolean` | Shows countdown in green |

#### PlanPanel
| Prop | Type | Description |
|------|------|-------------|
| `justRefreshed` | `boolean` | Shows "just now" in title |
| `relativeTime` | `string` | Relative time display |

#### TestPanel
| Prop | Type | Description |
|------|------|-------------|
| `isRunning` | `boolean` | Shows "running..." in title |
| `justCompleted` | `boolean` | Shows "just now" in title |

#### GenericPanel
| Prop | Type | Description |
|------|------|-------------|
| `isRunning` | `boolean` | Shows "running..." in title |
| `justRefreshed` | `boolean` | Shows countdown in green |

### Example Display

Normal state:
```
┌─ Git ────────────────────────────────── ↻ 25s ─┐
```

Running:
```
┌─ Git ─────────────────────────────── running... ─┐
```

Just refreshed (countdown in green for 1.5s):
```
┌─ Git ────────────────────────────────── ↻ 30s ─┐
```

## ProjectPanel Component

- **Added**: 2026-01-11
- **Issue**: #25
- **Status**: Complete
- **Tests**: `tests/project.test.ts`, `tests/ProjectPanel.test.tsx`
- **Source**: `src/data/project.ts`, `src/ui/ProjectPanel.tsx`

### Overview

ProjectPanel displays project information including name, language, license, stack, file/line counts, and dependency counts.

### Display

```
┌─ Project ────────────────────────────── ↻ 300s ─┐
│ agenthud · TypeScript · MIT                     │
│ Stack: ink, react, vitest                       │
│ Files: 44 ts · Lines: 3.5k                      │
│ Deps: 3 prod · 8 dev                            │
└─────────────────────────────────────────────────┘
```

For Python projects:
```
┌─ Project ────────────────────────────── ↻ 300s ─┐
│ my-api · Python · MIT                           │
│ Stack: fastapi, pytest, sqlalchemy              │
│ Files: 28 py · Lines: 2.1k                      │
│ Deps: 8                                         │
└─────────────────────────────────────────────────┘
```

### Data Sources

| Data | Source |
|------|--------|
| Name | `package.json`, `pyproject.toml`, or folder name |
| Language | tsconfig.json, package.json, pyproject.toml, go.mod, etc. |
| License | `package.json`, `pyproject.toml` |
| Stack | Well-known dependencies (react, django, etc.) |
| Files | `find` command on src/lib/app directories |
| Lines | `wc -l` on source files |
| Dependencies | `package.json`, `pyproject.toml` |

### Language Detection

First match wins:

| Indicator File | Language |
|----------------|----------|
| `tsconfig.json` | TypeScript |
| `package.json` | JavaScript |
| `pyproject.toml` | Python |
| `requirements.txt` | Python |
| `setup.py` | Python |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `Gemfile` | Ruby |
| `pom.xml` | Java |
| `build.gradle` | Java |

### Stack Detection

Well-known frameworks and tools (max 5, frameworks prioritized):

**JS/TS**: react, vue, angular, express, fastify, ink, vitest, jest, webpack, vite
**Python**: django, flask, fastapi, pytest, pandas, numpy, tensorflow, pytorch

### Configuration

```yaml
panels:
  project:
    enabled: true
    interval: 5m  # doesn't change often
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `data` | `ProjectData` | Project information |
| `countdown` | `number \| null` | Countdown seconds |
| `width` | `number` | Panel width |
| `justRefreshed` | `boolean` | Shows countdown in green |

## Panel-Based Folder Structure

- **Added**: 2026-01-11
- **Issue**: #27
- **Status**: Complete
- **Tests**: `tests/init.test.ts`, `tests/plan.test.ts`, `tests/tests.test.ts`
- **Source**: `src/commands/init.ts`, `src/data/plan.ts`, `src/data/tests.ts`, `src/config/parser.ts`

### Overview

The `.agenthud/` folder now uses a panel-based structure:

```
.agenthud/
├── config.yaml
├── plan/
│   ├── plan.json
│   └── decisions.json
└── tests/
    └── results.json
```

### Backwards Compatibility

- **New projects**: Get the new folder structure on `agenthud init`
- **Old projects**: Keep working with old locations (`.agenthud/plan.json`, `.agenthud/decisions.json`)
- **Fallback logic**: Checks new location first, falls back to old location
- **No migration**: No auto-migration or warnings

### Init Command

Creates the new structure:

| Path | Content |
|------|---------|
| `.agenthud/` | Root directory |
| `.agenthud/plan/` | Plan panel directory |
| `.agenthud/tests/` | Tests panel directory |
| `.agenthud/config.yaml` | Configuration file |
| `.agenthud/plan/plan.json` | Plan data |
| `.agenthud/plan/decisions.json` | Decisions list |

### Config Defaults

```yaml
panels:
  plan:
    enabled: true
    interval: 10s
    source: .agenthud/plan/plan.json  # New location

  tests:
    enabled: true
    interval: manual
    command: npx vitest run --reporter=json
    # source: .agenthud/tests/results.json  # Optional
```

### Tests Panel Source Option

The tests panel now supports both `command` and `source` options:

| Option | Priority | Behavior |
|--------|----------|----------|
| `command` | 1 | Run command and parse output |
| `source` | 2 | Read from JSON file |

If both are set, `command` takes priority.

### Plan Fallback Logic

```
1. Check .agenthud/plan/plan.json (new location)
2. If not found, check .agenthud/plan.json (old location)
3. Same fallback for decisions.json
```

## ClaudePanel Component

- **Added**: 2026-01-12
- **Issue**: #29
- **Status**: Complete
- **Tests**: `tests/claude.test.ts`
- **Source**: `src/data/claude.ts`, `src/ui/ClaudePanel.tsx`

### Overview

ClaudePanel displays real-time status of Claude Code sessions running in the current project.

### Display

Active session (running):
```
┌─ Claude ─────────────────────────────────── 🔄 08:37 ─┐
│ "Show me the dotfiles structure"                      │
│ → Bash: find /Users/neochoon/dotfiles -maxdepth 3...  │
└───────────────────────────────────────────────────────┘
```

Active session (completed):
```
┌─ Claude ─────────────────────────────────── ✅ 08:37 ─┐
│ "Show me the dotfiles structure"                      │
│ ✓ Completed · 305 tokens · 12s                        │
└───────────────────────────────────────────────────────┘
```

No active session:
```
┌─ Claude ──────────────────────────────────────────────┐
│ No active session                                     │
└───────────────────────────────────────────────────────┘
```

### Data Source

Claude Code stores session data in JSONL files:

```
~/.claude/projects/-{project-path-with-dashes}/*.jsonl
```

Example:
- Project: `/Users/neochoon/agenthud`
- Session files: `~/.claude/projects/-Users-neochoon-agenthud/*.jsonl`

### Status Icons

| Icon | Status | Description |
|------|--------|-------------|
| 🔄 | running | Activity within 30 seconds |
| ✅ | completed | Activity within 30s-5min |
| ⏳ | idle | No activity for 5+ minutes |
| - | none | No session file found |

### Configuration

```yaml
panels:
  claude:
    enabled: true
    interval: 2s  # Fast refresh for real-time monitoring
```

### Functions

| Function | Description | Return Type |
|----------|-------------|-------------|
| `getClaudeSessionPath(projectPath)` | Convert project path to session directory | `string` |
| `findActiveSession(sessionDir)` | Find most recent active session file | `string \| null` |
| `parseSessionState(sessionFile)` | Parse session state from JSONL | `ClaudeSessionState` |
| `getClaudeData(projectPath)` | Get Claude session data for project | `ClaudeData` |

### Types

```typescript
type ClaudeSessionStatus = "running" | "completed" | "idle" | "none";

interface ClaudeSessionState {
  status: ClaudeSessionStatus;
  lastUserMessage: string | null;
  currentAction: string | null;  // e.g., "Bash: npm run build"
  lastTimestamp: Date | null;
  tokenCount: number;
}

interface ClaudeData {
  state: ClaudeSessionState;
  error?: string;
  timestamp: string;
}
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `data` | `ClaudeData` | Claude session data |
| `countdown` | `number \| null` | Countdown seconds |
| `width` | `number` | Panel width |
| `justRefreshed` | `boolean` | Shows countdown in green |

## Startup Experience and UI Improvements

- **Added**: 2026-01-17
- **Issue**: #71
- **Status**: Complete
- **Tests**: `tests/utils/nodeVersion.test.ts`, `tests/data/sessionAvailability.test.ts`
- **Source**: `src/utils/nodeVersion.ts`, `src/data/sessionAvailability.ts`, `src/main.ts`, `src/index.ts`

### Overview

Improved the startup experience for new users and fixed various UI layout issues that occur in edge cases.

### Node.js Version Check

Shows a friendly error message and exits gracefully when Node.js version is below 20:

```
Error: Node.js 20+ is required (current: v18.17.0)

Please upgrade Node.js:
  https://nodejs.org/
```

### Session Availability Check

When no Claude session exists in the current directory:

**Other projects have sessions:**
```
No Claude Code session found in current directory.

Projects with Claude Code sessions:
  - agenthud
  - pain-radar
  - my-api

Run agenthud from one of these project directories.
```

**No sessions exist anywhere:**
```
Could not find any projects with Claude Code sessions.

Start a Claude Code session in a project directory first:
  $ claude
```

### Startup Flow

```
1. Check Node.js version >= 20
   → No: Show error, exit

2. Check Claude session in current directory
   → No: Check other projects
      → Has sessions: Show project list, exit
      → No sessions: Show "not found" message, exit

3. Check .agenthud/ directory
   → No: Show Welcome screen (init suggestion)
   → Yes: Show dashboard
```

### Git Error Suppression

Suppressed "fatal: not a git repository" error messages in non-git directories by adding `stdio: 'pipe'` to all `execSync` calls in git.ts.

### Other Sessions Panel Fixes

- Replaced ambiguous-width emojis with ASCII characters:
  - `📁` → removed
  - `⚡` → `*`
  - `🔵` → `*` (active)
  - `⚪` → `o` (inactive)
- Removed `clearEOL` escape sequence that broke 2-column layout
- Added conditional coloring:
  - Cyan for project names (when count > 0)
  - Yellow for active count (when count > 0)
  - Dim when counts are 0

### Functions

| Function | Description | Return Type |
|----------|-------------|-------------|
| `checkNodeVersion()` | Check Node.js version and exit if < 20 | `void` |
| `hasCurrentProjectSession(cwd)` | Check if current project has Claude session | `boolean` |
| `getProjectsWithSessions(cwd)` | Get list of other projects with sessions | `string[]` |
| `checkSessionAvailability(cwd)` | Combined session availability check | `SessionAvailabilityResult`
