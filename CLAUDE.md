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
│   ├── cli.ts            # CLI argument parsing
│   ├── ui/
│   │   ├── App.tsx       # Main Ink component
│   │   ├── Dashboard.tsx # Dashboard layout
│   │   ├── GitPanel.tsx  # Git info panel
│   │   ├── ClaudePanel.tsx # Claude Code session panel
│   │   └── TestPanel.tsx # Test results panel
│   ├── data/
│   │   ├── git.ts        # Git data collection
│   │   ├── claude.ts     # Claude Code session data
│   │   ├── tests.ts      # Parse test results
│   │   └── watcher.ts    # File watcher for live updates
│   └── types/
│       └── index.ts      # Type definitions
└── tests/
    ├── git.test.ts
    ├── claude.test.ts
    └── App.test.tsx
```

## Data Sources

| Data | Source | Method |
|------|--------|--------|
| Branch | git | `git branch --show-current` |
| Commits today | git | `git log --since=midnight --oneline` |
| Lines changed | git | `git diff --stat HEAD~n` |
| Claude | `~/.claude/projects/` | JSONL file watch |
| Tests | `test-results.json` | Jest/Vitest JSON output |

## CLI Interface

```bash
# Watch mode (default) - live updates
agenthud
agenthud --watch
agenthud -w

# One-shot - print and exit
agenthud --once

# Specify project directory
agenthud --dir /path/to/project

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
