# agenthud

Terminal dashboard for AI agent development.

```
┌─ Git ────────────────────────────────────────────────────┐
│ main · +1068 -166 · 12 commits · 23 files                │
│ • 1d00dc0 refactor: rename project from agent-dashboa... │
│ • 3529727 fix: Decisions separator line width now mat... │
│ • d7652c4 fix: use proper box character for Decisions... │
│ • 1594987 feat: move progress bar to Plan title line     │
│ • d5a9f4d feat: improve Plan panel and Tests panel di... │
└──────────────────────────────────────────────────────────┘

┌─ Plan ─────────────────────────────────── 7/10 ███████░░░┐
│ Build agenthud CLI tool                                  │
│ ✓ Set up project (npm, TypeScript, Vitest)               │
│ ✓ Implement git data collection module                   │
│ ✓ Create GitPanel UI component                           │
│ ✓ Add CLI entry point with watch mode                    │
│ ✓ Fix getTodayStats bug                                  │
│ ○ Add --dir flag for project directory                   │
│ ○ Add --json flag for JSON output                        │
│ ✓ Add PlanPanel component                                │
│ ✓ Add TestPanel component                                │
│ ○ Publish to npm                                         │
├─ Decisions ──────────────────────────────────────────────┤
│ • Use dependency injection for git module testing        │
│ • Use Ink for terminal UI                                │
│ • Use git log --numstat for stats instead of git diff... │
└──────────────────────────────────────────────────────────┘

┌─ Tests ──────────────────────────────────────────────────┐
│ ⚠ Outdated (1 commit behind)                             │
│ ✓ 70 passed · 3529727 · 40m ago                          │
└──────────────────────────────────────────────────────────┘
```

## Install
```bash
npx agenthud
```

## Features

- **Git**: Branch, commits, line changes
- **Plan**: Progress, decisions from `.agenthud/plan.json`
- **Tests**: Results with outdated detection

## Setup

Add to your `CLAUDE.md`:
```markdown
Maintain `.agenthud/` directory:
- Update `plan.json` when plan changes
- Update `decisions.json` for key decisions
```

## Keyboard

- `q` - quit
- `r` - refresh

## License

MIT
