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
agent-dashboard
agent-dashboard --watch
agent-dashboard -w

# One-shot mode - print and exit
agent-dashboard --once
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
│ Build agent-dashboard CLI tool           │
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
| `.agent/plan.json` | Yes | "No plan found" |
| `.agent/decisions.json` | No | Hide section |

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
