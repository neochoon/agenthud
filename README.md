# AgentHUD

[![npm version](https://img.shields.io/npm/v/agenthud.svg)](https://www.npmjs.com/package/agenthud)
[![CI](https://github.com/neochoon/agenthud/actions/workflows/ci.yml/badge.svg)](https://github.com/neochoon/agenthud/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/neochoon/agenthud/branch/main/graph/badge.svg)](https://codecov.io/gh/neochoon/agenthud)

An observability layer for [Claude Code](https://github.com/anthropics/claude-code). **See** your live sessions, **export** structured activity logs, and **summarize** a day or a week into an LLM digest — all from one CLI.

![demo](./demo/live.gif)

AgentHUD reads Claude Code's session files from `~/.claude/projects/` and gives you three things:

- **Live monitor** (`agenthud`) — a split-view TUI showing every project, session, sub-agent, and activity as it happens
- **Structured export** (`agenthud report`) — Markdown or JSON for piping to scripts, dashboards, or other LLMs
- **LLM digest** (`agenthud summary`) — a day or a date range synthesized into an engineering summary via the `claude` CLI

→ **See [FEATURES.md](./FEATURES.md) for the full surface** — every flag, keybinding, config key, file path, and env var.

## Install

Requires Node.js 20+.

```bash
npx agenthud
```

Run this in a separate terminal while using Claude Code. Press `?` inside the TUI any time for in-app help.

> **Platform support.** Primary development is on macOS and Linux; the full test suite runs on all three platforms in CI (including Windows). Windows runtime behavior is exercised by a manual smoke job but isn't daily-driven — issues there are valued bug reports.

## Quickstart

```bash
# Live monitor
agenthud                                  # all Claude projects
agenthud --cwd                            # scope to the project containing $PWD
agenthud --once                           # snapshot mode, no alt-screen

# Activity report
agenthud report --date today              # today's activity as markdown
agenthud report --format json             # script-readable
agenthud report --with-git                # merge git commits into the timeline

# LLM summary
agenthud summary --date today             # daily summary via `claude -p`
agenthud summary --last 7d                # cross-day synthesis of last 7 days
agenthud summary -oI                      # open the summary + the summaries index
```

## What you see

The TUI splits into a project tree (top) and an activity viewer (bottom):

```
┌─ Projects ─────────────────────────────────────────────────┐
│ > agenthud  ~/WestbrookAI/agenthud                     13m │
│     #864f [hot] Fix the auth bug in login flow             │
│         ├─ » code-reviewer                                 │
│     (#398c [warm])                                         │
│   myproject  ~/work/myproject                           2d │
│     #def4 [hot] Add OAuth support                          │
│ ... 12 cold projects                                       │
└────────────────────────────────────────────────────────────┘
┌─ Activity · agenthud ──────────────────────────────────────┐
│ [10:23] ○ Read  src/ui/App.tsx                             │
│ [10:23] ~ Edit  src/ui/App.tsx                             │
│ [10:23] $ Bash  npm test                                   │
│ [10:23] < Response  Tests passed successfully              │
│ [10:25] ⠧ Edit  src/auth/oauth.ts  ← bold + spinner = live │
└────────────────────────────────────────────────────────────┘
```

Sessions get colored badges — `[hot]` / `[warm]` / `[cool]` / `[cold]` — based on how recently their JSONL file was touched. Cold projects collapse under a `... N cold projects` sentinel. Press `↵` on any activity to open a scrollable detail view.

Full keybinding and badge reference: [FEATURES.md](./FEATURES.md#keybindings).

## Configuration

`~/.agenthud/config.yaml` is auto-created on first run with sensible defaults. CLI flags override config values per-invocation. Resolution order is `CLI flag → summary.<key> → report.<key> → built-in default`, and the effective values print to stderr at the start of every `report` / `summary` run.

App-managed UI state (hidden projects/sessions/sub-agents toggled by `h`) lives separately in `~/.agenthud/state.yaml`.

Full schema, file paths, and env vars: [FEATURES.md → Config](./FEATURES.md#config).

## More

- **Reference:** [FEATURES.md](./FEATURES.md) — every flag, keybinding, config key, file path, env var
- **Release history:** [CHANGELOG.md](./CHANGELOG.md)
- **Deferred items:** [BACKLOG.md](./BACKLOG.md)
- **Issues / PRs:** [GitHub](https://github.com/neochoon/agenthud)

## License

MIT
