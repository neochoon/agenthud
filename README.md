# AgentHUD

[![npm version](https://img.shields.io/npm/v/agenthud.svg)](https://www.npmjs.com/package/agenthud)
[![CI](https://github.com/neochoon/agenthud/actions/workflows/ci.yml/badge.svg)](https://github.com/neochoon/agenthud/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/neochoon/agenthud/branch/main/graph/badge.svg)](https://codecov.io/gh/neochoon/agenthud)

A **heads-up display** for your AI coding agents — **Claude Code**, **OpenAI Codex**, **AWS Kiro**, and **opencode**. AgentHUD reads each agent's on-disk sessions (JSONL files, or opencode's SQLite store) and merges them into one tree, so a project you've touched from several agents shows as a single row with combined sessions and sub-agents.

![demo](./demo/live.gif)

It's organized as **three layers, by who's reading** — a human at a glance, a human at the end of the day, and a machine:

- **`agenthud`** — **the live HUD.** A real-time TUI showing which session is `[working]` versus `[waiting]` on you, right now, across every agent. Glance at it in a side terminal and know what all your agents are doing. *This is the hero — the name is HUD for a reason.*
- **`agenthud summary`** — **the daily digest.** Fold a day (or a week) into an LLM engineering summary — a standup-in-one-command habit, via whichever agent CLI you have installed (claude, codex, or kiro-cli, auto-detected).
- **`agenthud report`** — **the machine layer.** Structured Markdown / JSON. `summary` is literally `report` piped into an agent CLI, so the daily digest isn't a black box — and you can pipe `report` into anything else, too.
- **`agenthud follow`** — **the live machine feed.** A chronologically-merged stream of every event (activity + state + lifecycle) across all sessions and sub-agents, as human lines or `--json` NDJSON — the read-only substrate a higher-level supervisor can consume. See [FEATURES.md](./FEATURES.md#follow).

→ **See [FEATURES.md](./FEATURES.md) for the full surface** — every flag, keybinding, config key, file path, and env var. Per-agent session schemas: [Claude Code](./docs/schemas/claude-session.md) · [Codex CLI](./docs/schemas/codex-session.md) · [Kiro IDE](./docs/schemas/kiro-ide-session.md) · [Kiro CLI](./docs/schemas/kiro-session.md) · [opencode](./docs/schemas/opencode-session.md) (or browse [docs/schemas/](./docs/schemas/)).

Requires Node.js 20+ (opencode sessions need Node 22+ — they're read via the built-in `node:sqlite`; on older Node, opencode is simply skipped and everything else works). Open agenthud in a separate terminal while you work; press `?` inside the TUI for in-app help.

## Try without installing

```bash
npx agenthud
# or: bunx agenthud
```

## Install for daily use

```bash
npm i -g agenthud
# or: bun i -g agenthud
```

> **Platform support.** Primary development is on macOS and Linux; the full test suite runs on all three platforms in CI (including Windows). Windows runtime behavior is exercised by a manual smoke job but isn't daily-driven — issues there are valued bug reports.

## Quickstart

```bash
# 1 · The live HUD
agenthud                                  # all projects, every agent
agenthud --cwd                            # scope to the project containing $PWD

# 2 · The daily digest
agenthud summary                          # synthesize today via your agent CLI
agenthud summary --last 7d                # cross-day synthesis of the last 7 days
agenthud summary -oI                      # open the summary + the summaries index

# 3 · The machine layer
agenthud report                           # today's activity as markdown
agenthud report --format json             # script-readable
agenthud report --with-git                # merge git commits into the timeline
```

## The live HUD — `agenthud`

The hero. A split-view TUI: a project tree (top) and an activity viewer (bottom), refreshing as your agents work.

```
┌─ Projects ────────────────────────────────────────────────────────────────────────────────────┐
│ 4 projects (2) · 31 sessions (3) · 142 sub-agents (1) · ⊘ 2 hidden                            │
│ > agenthud  ~/WestbrookAI/agenthud  6 sessions (2) · 114 sub-agents                           │
│     #864f [working] Fix the auth bug in login flow                         9s 41% claude opus │
│         ├─ » code-reviewer                                                                    │
│     #019e [waiting] review the data layer                                  2m 44% codex gpt-5 │
│   myproject  ~/work/myproject                                                              2d │
│     #def4 [cool] Add OAuth support                                        2m 5% kiro-ide auto │
│ ... 12 cold projects                                                                          │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
┌─ Activity · agenthud ─────────────────────────────────────────────────────────────────────────┐
│ [10:23] ○ Read  src/ui/App.tsx                                                                │
│ [10:23] ~ Edit  src/ui/App.tsx                                                                │
│ [10:23] $ Bash  npm test                                                                      │
│ [10:23] < Response  Tests passed successfully                                                 │
│ [10:25] ⠧ Edit  src/auth/oauth.ts  ← bold + spinner = live                                    │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

The activity viewer (bottom) **follows your selection** — pick any session *or sub-agent* and it streams what that node is doing right now, the live line bold with a spinner. So when a sub-agent is mid-task you can watch exactly what it's reading, editing, or running; press `↵` on any activity for a scrollable detail view.

The badge tells you, per session, **what the agent is doing right now**:

- `[working]` — there's a pending tool call at the tail; the agent is mid-step.
- `[waiting]` — the turn yielded back to you (a question, or a finished reply).

These live states are read from the structure of each session's JSONL tail and **override** the time-based recency badges (`[hot]` / `[warm]` / `[cool]` / `[cold]`) whenever a session is live. Each row also carries a colored provider label (`claude` / `codex` / `kiro` / `kiro-ide` / `opencode`), its model, and a context-window gauge; only hot/warm (and live) sessions count as active and render bright. Sub-agents nest under their parent regardless of which agent spawned them, the panel title is a tree-wide census, and cold projects collapse under a `... N cold projects` sentinel.

Full keybinding and badge reference: [FEATURES.md](./FEATURES.md#keybindings).

## The daily digest — `agenthud summary`

The asynchronous human layer: a day or a date range, synthesized into an engineering summary you can read like a standup note.

```bash
agenthud summary --date yesterday         # one day
agenthud summary --last 7d                # a rolling window
agenthud summary --from 2026-06-01 --to 2026-06-07
```

The summary runs through an **agent CLI of your choice**. By default it auto-detects the first one installed in `claude → codex → kiro` order; set a default with `summary.engine` in `~/.agenthud/config.yaml`, or override per-run with `--engine <claude|codex|kiro>`. So Claude-, Codex-, and Kiro-only users all get summaries with no extra setup.

Summaries are cached one-file-per-day under `~/.agenthud/summaries/`, cross-linked into a browsable index (`-I` to open it), and stamped with the engine + model that produced them — so switching engines regenerates rather than serving stale text.

## Scripting & integration — `agenthud report`

`agenthud report` is the machine-readable layer the other two are built on. It isn't a feature you rarely touch — it's the substrate of the one you use every day:

```bash
# This is, essentially, what `summary` does under the hood:
agenthud report --date yesterday | claude -p "$(cat ~/.agenthud/summary-prompt.md)"

# …so the same report can flow anywhere else:
agenthud report --format json | jq '.sessions[].model'   # into a dashboard
agenthud report --with-git    | your-own-llm-call        # into any pipeline
```

`summary` is just `report` piped into an agent CLI. The digest isn't a black box — it's `report` + a prompt + whichever LLM you like, and you can swap any part. Markdown is the default; `--format json` (with provider + model per session) is the script-friendly form.

## Configuration

`~/.agenthud/config.yaml` is auto-created on first run with sensible defaults. CLI flags override config values per-invocation. Resolution order is `CLI flag → summary.<key> → report.<key> → built-in default`, and the effective values print to stderr at the start of every `report` / `summary` run.

App-managed UI state (hidden projects/sessions/sub-agents toggled by `h`) lives separately in `~/.agenthud/state.yaml`.

Full schema, file paths, and env vars: [FEATURES.md → Config](./FEATURES.md#config).

## More

- **Reference:** [FEATURES.md](./FEATURES.md) — every flag, keybinding, config key, file path, env var
- **Feature history:** [FEATURE-HISTORY.md](./FEATURE-HISTORY.md) — headline features by version
- **Release history:** [CHANGELOG.md](./CHANGELOG.md)
- **Deferred items:** [BACKLOG.md](./BACKLOG.md)
- **Issues / PRs:** [GitHub](https://github.com/neochoon/agenthud)

## License

MIT
