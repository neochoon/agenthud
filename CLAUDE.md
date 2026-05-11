# AgentHUD

CLI tool to monitor agent status in real-time. Works with Claude Code, multi-agent workflows, and any AI agent system.

## Overview

```bash
$ agenthud --watch

┌─ AgentHUD ─────────────────────────┐
│ Agent: Claude Code                         │
│ Branch: feat/123-auth                      │
│ Plan: 3/5 steps done                       │
├─ Today ────────────────────────────────────┤
│ +3 commits  +142 lines  -23 lines          │
├─ Tests ────────────────────────────────────┤
│ ✓ 12 passed  ✗ 1 failed                    │
└────────────────────────────────────────────┘
```

## Language

All source code, comments, commit messages, and documentation must be written in English, regardless of the language used in conversation.

## Tech Stack

- Runtime: Node.js (ES Modules)
- Language: TypeScript
- UI: Ink (React for CLI)
- Build: tsup
- Test: Vitest
- Package: npm (publishable as `npx agenthud`)

## Project Structure

```
agenthud/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # Entry point
│   ├── main.ts           # App bootstrap
│   ├── cli.ts            # CLI argument parsing
│   ├── config/
│   │   └── globalConfig.ts # ~/.agenthud/config.yaml parser
│   ├── data/
│   │   ├── activityParser.ts  # JSONL activity parsing utilities
│   │   ├── sessions.ts        # Global session discovery
│   │   └── sessionHistory.ts  # Full session history parsing
│   ├── ui/
│   │   ├── App.tsx            # Main Ink component (split view)
│   │   ├── SessionTreePanel.tsx  # Top pane: session tree
│   │   ├── ActivityViewerPanel.tsx # Bottom pane: scrollable history
│   │   ├── constants.ts       # Box drawing, width constants
│   │   └── hooks/
│   │       └── useHotkeys.ts  # Keyboard handling
│   ├── types/
│   │   └── index.ts      # Type definitions
│   └── utils/
│       ├── nodeVersion.ts
│       └── performance.ts
└── tests/
    ├── config/
    │   └── globalConfig.test.ts
    ├── data/
    │   ├── activityParser.test.ts
    │   ├── sessions.test.ts
    │   └── sessionHistory.test.ts
    └── ui/
        ├── App.test.tsx
        ├── SessionTreePanel.test.tsx
        ├── ActivityViewerPanel.test.tsx
        └── hooks/
            └── useHotkeys.test.ts
```

## Data Sources

| Data | Source | Method |
|------|--------|--------|
| Sessions | `~/.claude/projects/` | JSONL file scan |
| Sub-agents | `~/.claude/projects/{id}/subagents/` | Directory structure |
| Config | `~/.agenthud/config.yaml` | YAML parse |
| Logs | `~/.agenthud/logs/` | File write on `s` key |

## CLI Interface

```bash
# Watch mode (default) - live updates
agenthud
agenthud --watch
agenthud -w

# One-shot - print and exit
agenthud --once

# JSON output (for scripting)
agenthud --json
```

## Development

### TDD Required

1. Write tests first
2. Review test before implementation
3. Implement code that passes tests

### Workflow

1. Create Issue before work
2. Discuss design, get confirmation
3. Create branch (never commit to main)
4. Write tests for all features
5. Verify tests pass before commit
6. Update documentation
7. Link Issue in PR

### Commit Convention

- feat: new feature
- fix: bug fix
- docs: documentation
- refactor: refactoring
- test: tests

### Do Not

- Commit directly to main
- Add features without tests
- Make big changes without confirmation
- Leave documentation outdated
- Push without user permission (CI runs on push, may cause errors)

## Future Extensions

- Multi-agent workflow monitoring
- n8n / LangGraph / CrewAI integration
- Web dashboard mode
- Remote agent monitoring
- Metrics export (Prometheus)
