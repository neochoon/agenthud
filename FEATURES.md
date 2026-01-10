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
- **Issue**: #17
- **Status**: Complete
- **Tests**: `tests/config.test.ts`, `tests/config-integration.test.tsx`, `tests/runner.test.ts`
- **Source**: `src/config/parser.ts`, `src/runner/command.ts`

### Configuration File

Create `.agenthud/config.yaml`:

```yaml
# agenthud configuration
panels:
  git:
    enabled: true
    interval: 30s

  plan:
    enabled: true
    interval: 10s

  tests:
    enabled: true
    interval: manual
    # command: npm test -- --reporter=json
```

### Panel Options

| Option | Type | Description |
|--------|------|-------------|
| `enabled` | `boolean` | Show/hide panel |
| `interval` | `string` | Refresh interval (`30s`, `5m`, `manual`) |
| `source` | `string` | (plan only) Path to plan.json |
| `command` | `string` | (tests only) Command to run |

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
