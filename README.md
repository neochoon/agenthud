# agenthud

Terminal dashboard for AI agent development.

```
┌─ Claude ─────────────────────────────────────────────────────┐
│ [10:30:00] > User: Show me the project structure             │
│ [10:30:05] * Glob: src/**/*.ts                               │
│ [10:30:10] ○ Read: package.json                              │
│ [10:30:15] < Response: Here's the project structure...       │
│ [10:30:20] $ Bash: npm run test                              │
│ [10:30:25] ~ Edit: src/index.ts                              │
└──────────────────────────────────────────────────────────────┘

┌─ Git ────────────────────────────────────────────────────────┐
│ main · +1068 -166 · 12 commits · 23 files                    │
│ • 1d00dc0 refactor: rename project from agent-dashboa...     │
│ • 3529727 fix: Decisions separator line width now mat...     │
│ • d7652c4 fix: use proper box character for Decisions...     │
└──────────────────────────────────────────────────────────────┘

┌─ Tests ──────────────────────────────────────────────────────┐
│ ✓ 301 passed · 3fd7988                                       │
└──────────────────────────────────────────────────────────────┘
```

## Install
```bash
npx agenthud
```

## Features

- **Claude**: Real-time Claude Code session monitoring
- **Git**: Branch, commits, line changes
- **Tests**: Results with outdated detection
- **Project**: Package info, stack detection

## Claude Panel Icons

| Symbol | Type |
|--------|------|
| `>` | User input |
| `<` | Response |
| `~` | Edit/Write |
| `○` | Read |
| `$` | Bash |
| `*` | Glob/Grep |
| `@` | Web |
| `▶` | Task |
| `?` | Question |

## Configuration

Create `.agenthud.yaml` in your project root:

```yaml
panels:
  git:
    enabled: true
    interval: 30s
  claude:
    enabled: true
    interval: 5s
    max_activities: 20
  tests:
    enabled: true
    interval: manual
  project:
    enabled: true
    interval: 60s
```

## Keyboard

- `q` - quit
- `r` - refresh

## License

MIT
