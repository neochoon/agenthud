# AgentHUD

[![npm version](https://img.shields.io/npm/v/agenthud.svg)](https://www.npmjs.com/package/agenthud)
[![CI](https://github.com/neochoon/agenthud/actions/workflows/ci.yml/badge.svg)](https://github.com/neochoon/agenthud/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/neochoon/agenthud/branch/main/graph/badge.svg)](https://codecov.io/gh/neochoon/agenthud)

When working with AI coding agents like Claude Code, you lose visibility into what's happening across sessions. **AgentHUD** gives you a live session browser in a separate terminal — see every session, sub-agent, and activity as it happens.

![demo](./output960.gif)

## Install

Requires Node.js 20+.

```bash
npx agenthud
```

Run this in a separate terminal while using Claude Code. Press `?` inside the TUI any time for in-app help.

## What it shows

AgentHUD reads Claude Code's session files from `~/.claude/projects/` and displays them in a split view:

```
┌─ Projects ──────────────────────────────────────────────┐
│ > agenthud  ~/WestbrookAI/agenthud                      │
│     #864f [hot] Fix the auth bug in login flow          │
│         ├─ » code-reviewer                              │
│     (#398c [warm])                                      │
│   myproject  ~/work/myproject                           │
│     #def4 [hot] Add OAuth support                       │
│ ... 12 cold projects                                    │
└─────────────────────────────────────────────────────────┘
┌─ Activity · agenthud ───────────────────────────────────┐
│ [10:23] ○ Read  src/ui/App.tsx                          │
│ [10:23] ~ Edit  src/ui/App.tsx                          │
│ [10:23] $ Bash  npm test                                │
│ [10:23] < Response  Tests passed successfully           │
│ [10:25] ◆ abc1234  feat: fix auth callback              │
└─────────────────────────────────────────────────────────┘
```

**Project tree (top pane)**
- Sessions grouped under their project (project name + path at the top).
- Session rows show short ID + first user prompt (the session's "topic").
- Non-interactive sessions (from `claude -p`, SDK, `agenthud summary`) appear in parens and dimmed.
- Sub-agents nest one level deeper under their parent session.
- Cold projects collapse under `... N cold projects` at the bottom (press Enter on the line to expand).
- Press `h` to hide a project, session, or sub-agent (saved to `~/.agenthud/state.yaml`).

**Activity viewer (bottom pane)**
- Real-time feed for the selected session: file reads, edits, bash, responses, thinking, git commits.
- Press `f` to cycle through filter presets (configurable).
- Press `↵` on any row to open a scrollable detail view; on a commit row this shows `git show --stat`.

## Session status

Each session row carries a colored badge derived from when its JSONL file was last touched:

| Badge | Color | Meaning |
|-------|-------|---------|
| `[hot]` | green | Updated in the last 30 minutes — actively running |
| `[warm]` | yellow | Updated in the last hour |
| `[cool]` | cyan | Updated earlier today |
| `[cold]` | gray | Last updated yesterday or earlier — collapsed under `... N cold projects` at the bottom |

Sub-agents use the same scheme. Projects inherit the hottest status of their sessions; a project is treated as "cold" only when all its sessions are cold.

## Activity types

| Icon | Type | Description |
|------|------|-------------|
| `○` | Read | File being read |
| `~` | Edit / Write | File being modified |
| `$` | Bash | Shell command |
| `*` | Glob / Grep | File search |
| `@` | WebFetch / WebSearch | Web request |
| `»` | Task | Sub-agent task |
| `<` | Response | Claude's text response |
| `>` | User | Your message |
| `…` | Thinking | Claude's thinking (requires `showThinkingSummaries: true`) |
| `◆` | Commit | Git commit in the project (when `--with-git` or in viewer) |

## Keyboard shortcuts

Full reference is also available inside the app — press `?`.

### Project tree focus

| Key | Action |
|-----|--------|
| `↑` / `k` | Move up |
| `↓` / `j` | Move down |
| `↵` | Expand/collapse project, session, or sub-agent summary |
| `h` | Hide selected (project / session / sub-agent) |
| `Tab` | Switch focus to activity viewer |
| `PgUp` / `Ctrl+B` | Page up |
| `PgDn` / `Ctrl+F` | Page down |
| `r` | Refresh now |
| `?` | Help |
| `q` | Quit |

### Activity viewer focus

| Key | Action |
|-----|--------|
| `↑` / `k` | Scroll one line up |
| `↓` / `j` | Scroll one line down |
| `PgUp` / `Ctrl+B` | Page up |
| `PgDn` / `Ctrl+F` | Page down |
| `Ctrl+U` / `Ctrl+D` | Half page up / down |
| `g` | Jump to live (newest) |
| `G` | Jump to oldest |
| `↵` | Open detail view |
| `f` | Cycle filter preset |
| `Tab` | Switch focus to project tree |
| `?` | Help |
| `q` | Quit |

### Detail view

| Key | Action |
|-----|--------|
| `↑` / `k` / `↓` / `j` | Scroll |
| `↵` / `Esc` / `q` | Close |

## Report

Print activity for a date in Markdown or JSON — suitable for piping to scripts or LLMs:

```bash
agenthud report                                      # today (Markdown)
agenthud report --date 2026-05-14                    # specific date
agenthud report --date today --include all           # all activity types
agenthud report --format json                        # JSON output
agenthud report --detail-limit 0                     # no truncation (full text)
agenthud report --with-git                           # merge git commits into timeline
```

Output:

```
# AgentHUD Report: 2026-05-14

## myproject (10:23 – 14:45)

[10:23] $ npm test
[10:35] ~ src/ui/App.tsx
[11:15] < Added spinner hook to make the UI feel alive.
[14:30] ◆ abc1234 feat: fix auth callback
```

**Options:**

| Flag | Default | Description |
|------|---------|-------------|
| `--date` | today | `YYYY-MM-DD` or `today` (local date) |
| `--include` | `response,bash,edit,thinking` | Comma-separated types or `all` |
| `--format` | `markdown` | `markdown` or `json` |
| `--detail-limit` | `120` | Max chars per detail field; `0` = unlimited |
| `--with-git` | off | Merge git commits from each session's project into the timeline |

`--include` types: `response`, `bash`, `edit`, `thinking`, `read`, `glob`, `user`

## Summary

Generate an LLM-based summary of one day or a date range using the `claude` CLI:

```bash
# Single day
agenthud summary                            # today (always regenerated)
agenthud summary --date yesterday           # natural-language date
agenthud summary --date 2026-05-14          # past date (cached on second run)
agenthud summary --date 2026-05-14 --force  # ignore cache
agenthud summary --prompt "Only commits"    # override prompt

# Date range — daily summaries are re-summarized into a meta-summary
agenthud summary --last 7d                          # last 7 days, ending today
agenthud summary --from 2026-05-10 --to 2026-05-16  # explicit range
agenthud summary --last 7d -y                       # skip per-day confirmations
```

**Daily summaries** are saved to `~/.agenthud/summaries/YYYY-MM-DD.md`. Past dates are cached and returned instantly; today is always regenerated (activity still growing).

**Range summaries** generate any missing daily summaries first, then feed those into a second `claude` call that produces a cross-day synthesis (themes, multi-day workstreams, recurring patterns). Output is cached to `~/.agenthud/summaries/range-FROM_TO.md`. Cached dailies cost nothing to reuse, so weekly summaries are cheap after the first run.

Each missing daily prompts for confirmation just before generation, so you see concrete context (session/activity/commit counts and report size) before deciding. Pass `-y` / `--yes` to skip all prompts. Press Enter to accept the default (`[Y/n]`).

**Prompt customization:** The daily template lives at `~/.agenthud/summary-prompt.md` and the range template at `~/.agenthud/summary-range-prompt.md`. Both are auto-created from built-in templates on first run. Edit them freely.

**`--date` formats:** `YYYY-MM-DD`, `today`, `yesterday`, or `-Nd` (N days ago).

**Requires:** [`@anthropic-ai/claude-code`](https://www.npmjs.com/package/@anthropic-ai/claude-code) installed and authenticated.

## Configuration

`~/.agenthud/config.yaml` is auto-created on first run with sensible defaults. Edit it freely:

```yaml
# How often to poll for activity updates (Linux fallback when fs.watch isn't used)
refreshInterval: 2s

# Activity filter presets (cycle with 'f' key in viewer)
# Each list is one preset; [] means "all". First preset is the default.
filterPresets:
  - []
  - ["response"]
  - ["commit"]
```

App-managed state (hidden items) lives separately in `~/.agenthud/state.yaml` so your config file stays clean. You shouldn't need to edit it manually — use `h` in the TUI to hide things.

## Files

| Path | Purpose |
|------|---------|
| `~/.agenthud/config.yaml` | User settings (edit freely) |
| `~/.agenthud/state.yaml` | Hidden projects/sessions/sub-agents (app-managed) |
| `~/.agenthud/summary-prompt.md` | LLM prompt template for daily `summary` |
| `~/.agenthud/summary-range-prompt.md` | LLM prompt template for range `summary --last/--from/--to` |
| `~/.agenthud/summaries/YYYY-MM-DD.md` | Cached daily summaries |
| `~/.agenthud/summaries/range-FROM_TO.md` | Cached range summaries |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Path to Claude Code projects directory. Useful for backups or mounted volumes. |

## Feedback

Issues and PRs welcome at [GitHub](https://github.com/neochoon/agenthud).

## License

MIT
