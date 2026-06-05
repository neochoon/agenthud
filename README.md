# AgentHUD

[![npm version](https://img.shields.io/npm/v/agenthud.svg)](https://www.npmjs.com/package/agenthud)
[![CI](https://github.com/neochoon/agenthud/actions/workflows/ci.yml/badge.svg)](https://github.com/neochoon/agenthud/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/neochoon/agenthud/branch/main/graph/badge.svg)](https://codecov.io/gh/neochoon/agenthud)

An observability layer for [Claude Code](https://github.com/anthropics/claude-code). **See** your live sessions, **export** structured activity logs, and **summarize** a day or a week into an LLM digest — all from one CLI.

![demo](./demo/live.gif)

AgentHUD reads Claude Code's session files from `~/.claude/projects/` and gives you three things:

- **Live monitor** ([`agenthud`](#live-monitor)) — a split-view TUI showing every project, session, sub-agent, and activity as it happens.
- **Structured export** ([`agenthud report`](#report)) — print activity for any date as Markdown or JSON for piping to scripts, dashboards, or other LLMs.
- **LLM digest** ([`agenthud summary`](#summary)) — synthesize a day or a date range into an engineering summary via the `claude` CLI, with caching so weekly digests are cheap to regenerate.

## Install

Requires Node.js 20+.

```bash
npx agenthud
```

Run this in a separate terminal while using Claude Code. Press `?` inside the TUI any time for in-app help.

## Live monitor

AgentHUD's TUI splits the screen into a project tree and an activity viewer:

```
┌─ Projects ───────────────────────────────────────────────┐
│ > agenthud  ~/WestbrookAI/agenthud                   13m │
│     #864f [hot] Fix the auth bug in login flow           │
│         ├─ » code-reviewer                               │
│     (#398c [warm])                                       │
│   myproject  ~/work/myproject                         2d │
│     #def4 [hot] Add OAuth support                        │
│ ... 12 cold projects                                     │
└──────────────────────────────────────────────────────────┘
┌─ Activity · agenthud ────────────────────────────────────┐
│ [10:23] ○ Read  src/ui/App.tsx                           │
│ [10:23] ~ Edit  src/ui/App.tsx                           │
│ [10:23] $ Bash  npm test                                 │
│ [10:23] < Response  Tests passed successfully            │
│ [10:25] ⠧ Edit  src/auth/oauth.ts  ← bold + spinner = live │
└──────────────────────────────────────────────────────────┘
```

**Project tree (top pane)**
- Sessions grouped under their project (project name + path at the top).
- Session rows show short ID + first user prompt (the session's "topic"). Long titles truncate with a `…` suffix.
- Right edge of each row shows how long ago it was last touched: `42m`, `17h`, `3d`, `2w`, `1mo`, `1y`. Project rows use the most recent session's mtime.
- Non-interactive sessions (from `claude -p`, SDK, `agenthud summary`) appear in parens and dimmed.
- Sub-agents nest one level deeper under their parent session.
- Cold projects collapse under `... N cold projects` at the bottom (press Enter on the line to expand).
- Press `h` to hide a project, session, or sub-agent (saved to `~/.agenthud/state.yaml`).

**Activity viewer (bottom pane)**
- Real-time feed for the selected session: file reads, edits, bash, responses, thinking, git commits. Newest at the bottom, like `tail -f`.
- The **newest visible row is rendered "alive"** while in LIVE mode: its icon is replaced with a spinning glyph and the text turns bold. When a new activity arrives, the spinner moves to the new bottom row. Hidden when paused or empty.
- Press `f` to cycle through filter presets (configurable).
- Press `↵` on any row to open a scrollable detail view; on a commit row this shows `git show --stat --patch`.

### Session status

Each session row carries a colored badge derived from when its JSONL file was last touched:

| Badge | Color | Meaning |
|-------|-------|---------|
| `[hot]` | green | Updated in the last 30 minutes — actively running |
| `[warm]` | yellow | Updated in the last hour |
| `[cool]` | cyan | Updated earlier today |
| `[cold]` | gray | Last updated yesterday or earlier — collapsed under `... N cold projects` at the bottom |

Sub-agents use the same scheme. Projects inherit the hottest status of their sessions; a project is treated as "cold" only when all its sessions are cold.

### Activity types

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

### Keyboard shortcuts

Full reference is also available inside the app — press `?`.

#### Project tree focus

| Key | Action |
|-----|--------|
| `↑` / `k` | Move up |
| `↓` / `j` | Move down |
| `↵` | Expand/collapse project, session, or sub-agent summary |
| `h` | Hide selected (project / session / sub-agent) |
| `Tab` | Switch focus to activity viewer |
| `PgUp` / `Ctrl+B` | Page up |
| `PgDn` / `Ctrl+F` | Page down |
| `t` | Track — auto-follow the newest live sub-agent (any nav key turns it off) |
| `r` | Refresh now |
| `?` | Help |
| `q` | Quit |

When tracking is on, the tree panel's title shows `[LIVE ⠧]` and the status bar replaces `t: track` with `TRK ●`. Any explicit selection-changing key (`↑/k`, `↓/j`, `PgUp/PgDn`, `↵`, `h`, or `t` again) turns tracking off.

#### Activity viewer focus

| Key | Action |
|-----|--------|
| `↑` / `k` | Scroll one line up |
| `↓` / `j` | Scroll one line down |
| `PgUp` / `Ctrl+B` | Page up |
| `PgDn` / `Ctrl+F` | Page down |
| `Ctrl+U` / `Ctrl+D` | Half page up / down |
| `g` | Jump to top (oldest) |
| `G` | Jump to live (newest, bottom) |
| `↵` | Open detail view |
| `f` | Cycle filter preset |
| `r` | Refresh now |
| `Tab` | Switch focus to project tree |
| `?` | Help |
| `q` | Quit |

#### Detail view

| Key | Action |
|-----|--------|
| `↑` / `k` / `↓` / `j` | Scroll one line |
| `Ctrl+U` / `Ctrl+D` | Half page up / down |
| `↵` / `Esc` / `q` | Close |

Detail view colors the content based on activity type:

- **Git commit detail** (`git show --stat --patch`): added lines green (`+`), removed lines red (`-`), hunk headers cyan (`@@ ... @@`), `commit/Author/Date/diff` metadata dimmed.
- **Response / thinking / prompt**: text inside triple-backtick code fences renders in cyan so the boundary between prose and code is obvious. No language-specific syntax highlighting — just code-vs-prose separation.

### Behavior

- **Alternate screen buffer.** Watch mode uses the alt-screen (like `vim`, `htop`, `btop`), so quitting (`q`) restores the pre-launch shell completely. No TUI residue, no "is it still running?" confusion.
- **Minimum terminal size.** 80 cols × 20 rows. Smaller terminals show a one-line hint and redraw automatically when you resize.
- **Help overlay scrolls.** Press `?` for an in-app reference. The overlay scrolls (`j/k`, `PgUp/PgDn`, `Ctrl+B/F`, `Space`, `g/G`) so the full content is reachable on shorter terminals.

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
| `--date` | today | `YYYY-MM-DD`, `today`, `yesterday`, or `-Nd` (N days ago, local date) |
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

# Cheaper model — summarization doesn't need Opus-tier reasoning
agenthud summary --date today --model sonnet        # ~40% cheaper than Opus
agenthud summary --last 7d --model haiku            # ~80% cheaper, 200K context
```

**Daily summaries** are saved to `~/.agenthud/summaries/YYYY-MM-DD.md`. Past dates are cached and returned instantly; today is always regenerated (activity still growing).

**Range summaries** generate any missing daily summaries first, then feed those into a second `claude` call that produces a cross-day synthesis (themes, multi-day workstreams, recurring patterns). Output is cached to `~/.agenthud/summaries/range-FROM_TO.md`. Cached dailies cost nothing to reuse, so weekly summaries are cheap after the first run.

Each missing daily prompts for confirmation just before generation, so you see concrete context (session/activity/commit counts and report size) before deciding. Pass `-y` / `--yes` to skip all prompts. Press Enter to accept the default (`[Y/n]`).

**Prompt customization:** The daily template lives at `~/.agenthud/summary-prompt.md` and the range template at `~/.agenthud/summary-range-prompt.md`. Both are auto-created from built-in templates on first run. Edit them freely.

**`--date` formats:** `YYYY-MM-DD`, `today`, `yesterday`, or `-Nd` (N days ago).

**Model selection:** Summarization is a low-reasoning task (structured input → structured markdown) — Sonnet or Haiku usually beats Opus on cost-per-summary with no quality loss. Pass `--model sonnet`, `--model haiku`, or a full model id (`--model claude-sonnet-4-6`). With no flag, `claude` uses its default model.

**Cost warning:** If the day's activity log is large (~300K tokens or more), AgentHUD prints a warning before sending and asks for one more confirmation in interactive mode. `-y` skips the prompt but still prints the warning.

**Requires:** [`@anthropic-ai/claude-code`](https://www.npmjs.com/package/@anthropic-ai/claude-code) installed and authenticated.

## Configuration

`~/.agenthud/config.yaml` is auto-created on first run with sensible defaults. Edit it freely:

```yaml
# How often to poll for activity updates (Linux fallback when fs.watch isn't used)
refreshInterval: 2s

# Activity filter presets (cycle with 'f' key in viewer)
# Each list is one preset. Use "all" (or "*") to show everything.
# Types: response, user, bash, edit, thinking, read, glob, commit
filterPresets:
  - ["all"]
  - ["response", "user"]
  - ["commit"]

# Defaults for `agenthud report` (CLI flags still win per-invocation).
report:
  include: [user, response, bash, edit, thinking]
  detailLimit: 120
  withGit: false
  format: markdown

# Defaults for `agenthud summary`. Any field omitted here is inherited
# from `report` above. `model` is summary-specific.
summary:
  withGit: true
  detailLimit: 0
  # model: sonnet
```

`report` / `summary` resolve each option as **CLI flag → `summary:` key → `report:` key → built-in default**. The effective set is printed to stderr at the start of each run (e.g. `agenthud: report → include=[user,response,bash,edit,thinking] detail-limit=120 with-git=off format=markdown`), so the actual values are always visible.

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
