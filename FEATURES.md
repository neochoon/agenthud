# Features

This is the user-facing reference for everything `agenthud` exposes —
commands, flags, keybindings, config keys, file paths, environment
variables. For changes per version, see [CHANGELOG.md](./CHANGELOG.md).
For getting started, see [README.md](./README.md).

> **History note:** agenthud was rewritten around v0.8.x from a
> "custom panels" framework into the current session-tree + activity
> viewer model. Versions before that (v0.3.0 – v0.7.x) describe an
> earlier product and are kept in CHANGELOG.md for the historical
> record only. The "Stable since" column below tracks the first
> shipping version of each feature *in its current form*.

---

## Overview

| Mode | Command | Stable since | Reference |
|---|---|---|---|
| Watch (live TUI) | `agenthud` | v0.8.x rewrite | [Watch](#watch) |
| Snapshot | `agenthud --once` | v0.8.2 | [Snapshot](#snapshot) |
| Cwd-scoped watch | `agenthud --cwd` | v0.11.0 | [Cwd scope](#cwd-scope) |
| Activity tracker (auto-follow) | `t` key | v0.9.5 | [Tracker](#tracker) |
| Activity report | `agenthud report` | v0.8.2 | [Report](#report) |
| Daily LLM summary | `agenthud summary --date` | v0.8.5 | [Summary daily](#summary-daily) |
| Range LLM summary | `agenthud summary --from/--to` / `--last Nd` | v0.9.2 | [Summary range](#summary-range) |
| Summary `--open` | `agenthud summary -o` | v0.12.0 | [Summary open](#summary-open) |
| Summaries index hub | `agenthud summary --open-index` / `-I` | v0.12.0 | [Summaries index](#summaries-index) |
| Subagent visibility in reports | `task` include type | v0.13.0 | [Subagent reporting](#subagent-reporting) |
| Global config | `~/.agenthud/config.yaml` | v0.9.0 | [Config](#config) |
| Effective-options stderr line | (automatic) | v0.12.0 | [Effective options](#effective-options) |

Cross-cutting reference:

- [Keybindings](#keybindings) — full key map (mirrors what `?` shows in-app)
- [Files & directories](#files--directories) — what lives in `~/.agenthud/`
- [Environment variables](#environment-variables)

---

## Watch

The default mode. Real-time TUI: project tree on top, activity viewer
on the bottom, both polling `~/.claude/projects/` every ~2 s.

**Invocation:** `agenthud` or `agenthud watch` (also `-w`,
`--watch`).

**Behavior:**
- Renders an Ink-based split view. Top panel: hot/warm/cool/cold
  session tree grouped by project. Bottom panel: tail-feed of the
  selected session's activity.
- Switches to the alternate screen buffer on startup and restores
  the pre-launch terminal verbatim on quit (`q`, Ctrl+C, SIGTERM).
- Refuses to render on terminals smaller than 80 cols × 20 rows
  and shows a clear "needs larger terminal" panel that
  auto-redraws on resize.

**Available since:** v0.8.x rewrite (project-grouped tree v0.9.0,
session liveness badges v0.10.0, rich tool details v0.10.0).

## Snapshot

Print one frame of watch mode and exit. Useful for piping to a file
or for non-interactive contexts (CI, scripts).

**Invocation:** `agenthud --once`

**Behavior:**
- Renders the current session tree to stdout without entering the
  alternate screen, then exits cleanly. Scrollback preserved
  (fixed in v0.11.4).

**Available since:** v0.8.2.

## Cwd scope

Scope the watch view (or snapshot) to whichever Claude project
contains the current working directory.

**Invocation:** `agenthud --cwd` (combinable with `--once`)

**Behavior:**
- Walks up from `cwd` looking for a Claude project directory match.
- Exits 1 if no such project is found.
- On WSL, `homedir()` lies; the cwd-detection skips
  `/mnt/<drive>/Users/<name>` paths from being treated as project
  paths (v0.12.4).

**Available since:** v0.11.0 (Windows separator fix same release).

## Tracker

Auto-follow the newest live sub-agent (or session if no live
sub-agent exists) across the entire tree. Designed for ambient
monitoring on a second monitor while long Claude skills churn
through many sub-agents.

**Invocation:** press `t` in watch mode.

**Behavior:**
- Status bar swaps `t: track` for `TRK ●`; Projects panel header
  shows `[LIVE ⠧]`.
- Polling jumps to 1 second while tracking is on (macOS `fs.watch`
  recursive drops cross-project events otherwise).
- Selection jumps only when a *new* sub-agent id appears, or when
  the current selection cools off — not just because the current
  one was busiest (v0.9.5 fix).
- Any explicit nav key (↑/↓/Tab/etc.) turns tracking off.

**Available since:** v0.9.5.

## Report

Print a chronological activity report for a date — Markdown for
humans, JSON for scripts.

**Invocation:** `agenthud report [flags]`

**Flags:**

| Flag | Default | Description |
|---|---|---|
| `--date YYYY-MM-DD \| today \| yesterday \| -Nd` | `today` | Date to report on |
| `--include TYPES` | `user,response,bash,edit,thinking,task` | Comma-separated activity types or `all` |
| `--format markdown \| json` | `markdown` | Output format |
| `--detail-limit N` | `120` | Max chars per activity detail; `0` = unlimited |
| `--with-git` | off | Merge git commits from each session's project path into the timeline |

**Include types:** `user`, `response`, `bash`, `edit`, `thinking`,
`task`, `read`, `glob`, `commit`. Unknown values error (v0.9.4
fix). The default set is shared with `summary` via
`DEFAULT_INCLUDE_TYPES`.

**Output:**
- **Markdown:** one section per session with `[HH:MM] <icon>
  <label>: <detail>` rows. Times in local timezone. Task tool
  activities also unroll the subagent's returned text as a
  `<task-result>…</task-result>` block (v0.13.0).
- **JSON:** structured output with sub-agents nested under their
  parent session.

**Behavior:**
- Reads `~/.claude/projects/<id>/*.jsonl` for each session on the
  target date.
- With `--with-git`: invokes `git log --git-dir <project>/.git`
  for each session's project path.

**Defaults source:** `~/.agenthud/config.yaml → report.*`, then
built-in defaults. CLI flags override per-run.

**Available since:** v0.8.2 (with-git v0.8.4, JSON format v0.8.4,
config-driven defaults v0.12.0).

## Summary daily

Generate an LLM summary of a single day's activity by piping the
activity report (markdown) into `claude -p`.

**Invocation:** `agenthud summary [--date ...] [flags]`

**Flags** (in addition to `report`'s `--include`, `--detail-limit`,
`--with-git`):

| Flag | Default | Description |
|---|---|---|
| `--date YYYY-MM-DD \| today \| yesterday \| -Nd` | `today` | Date to summarize |
| `--prompt TEXT` | (template file) | Override prompt inline (daily only) |
| `--force` | off | Regenerate even if cached |
| `--model NAME` | claude default | Forward to `claude --model` (e.g. `sonnet`, `haiku`, full id) |
| `-y, --yes` | off | Skip confirmation prompt |
| `-o, --open` | off | Open the produced summary in OS default app |
| `-I, --open-index` | off | Open `~/.agenthud/summaries/index.md` |

**Behavior:**
- Builds the markdown payload via `generateReport`. If the day has
  zero activity, announces "no activity — skipping" and returns
  exit 0 without spawning claude or writing a file (v0.12.2 /
  v0.12.3).
- Past days are cached at `~/.agenthud/summaries/YYYY-MM-DD.md`
  and reused on subsequent runs. Today is always regenerated.
- Prompt template comes from `~/.agenthud/summary-prompt.md`
  (auto-created on first run from
  `src/templates/summary-prompt.md`); `--prompt` overrides for
  one run.
- Token usage line printed at the end (`N in / M out · cache: A
  read, B written · $X.XXXX`) parsed from claude's `result`
  event.
- Oversize reports (~300K tokens estimated) print a warning and,
  interactively, prompt one more time before sending (v0.9.4).
- `claude -p` is called with `--no-session-persistence` so the
  summary call doesn't pollute the session tree (v0.9.2 / v0.9.3).
- After a successful write, `regenerateIndex` updates
  `~/.agenthud/summaries/index.md` and each summary's backlink
  footer (v0.12.0).

**Available since:** v0.8.5 (config-driven defaults v0.12.0,
`--model` v0.9.4, `--open` / `--open-index` v0.12.0,
`--no-session-persistence` v0.9.3).

## Summary range

Generate a cross-day synthesis from a date range. Per-day daily
summaries are produced first (cached and reused), then meta-summarized
into a single range markdown.

**Invocation:**
- `agenthud summary --last Nd` (last N days, ending today)
- `agenthud summary --from YYYY-MM-DD --to YYYY-MM-DD`

**Flags:** All daily summary flags except `--prompt` (range mode
uses `~/.agenthud/summary-range-prompt.md` and does not accept an
inline prompt). `-y/--yes` accepts per-day confirmation prompts in
one go.

**Behavior:**
- Confirmation per missing daily prompts only *after* its scan
  stats are shown (sessions/activities/commits/KB), so you decide
  with concrete context (v0.9.2).
- All-empty range returns exit 0 with a neutral skip message
  (v0.12.3).
- Range output cached at `~/.agenthud/summaries/range-FROM_TO.md`.
- Cache is invalidated when today is in the range (v0.9.3 fix).

**Meta-input format (v0.13.0):** Each daily summary is wrapped in
`<day date="YYYY-MM-DD">…</day>` rather than the previous
`# YYYY-MM-DD` heading + `---` separator. The date rides as a
structured attribute (no conflation with date headings inside a
summary) and tag boundaries can't be forged by content (avoids
collision with markdown horizontal rules or yaml frontmatter
inside a daily).

**Available since:** v0.9.2 (XML meta-input v0.13.0).

## Summary open

Once a summary is written (or read back from cache), launch it in
the OS default app — typically a browser with a markdown
extension, or VS Code.

**Invocation:** `agenthud summary -o` (or `--open`)

**Behavior:**
- Native spawn (`open` on macOS, `xdg-open` / `wslview` on Linux/WSL,
  `cmd /c start` on Windows). No extra dependency.
- WSL detection prefers `wslview` over `xdg-open` when both are on
  PATH (v0.12.2).
- Spawn errors and non-zero exit codes from the opener are
  surfaced on stderr instead of failing silently (v0.12.2 fix).
- Works across daily, range, and cache-hit paths.
- Combinable with `-I`: `-oI` opens both the summary and the
  index (POSIX short-flag clusters land in v0.12.3).

**Available since:** v0.12.0.

## Summaries index

Auto-managed markdown hub at `~/.agenthud/summaries/index.md`
listing every daily and range summary, grouped year → month →
newest-first, with a one-line snippet and `(Sun)`-style weekday
tag per row.

**Invocation:** `agenthud summary -I` (or `--open-index`).
Combinable with `-o`: `-oI` opens both.

**Behavior:**
- Regenerated automatically after every successful summary write
  (daily, range, or cache hit).
- Each summary file gets a backlink footer prepended:
  `[← all summaries] · [← prev] · [next →]` wrapped in HTML
  comment markers so re-runs replace cleanly.
- `-I` works even on empty days (v0.12.3 fix) — the index hub is
  meant for navigation, not gated on whether today produced new
  content.

**Available since:** v0.12.0.

## Subagent reporting

Task tool delegations to sub-agents are surfaced in `report` and
`summary` output. Previously every Task call was silently dropped
from the markdown report — meaning LLM summaries described a
near-empty day whenever you delegated work.

**Activation:** included by default in
`DEFAULT_INCLUDE_TYPES = [user, response, bash, edit, thinking,
task]`. Opt out per-run with `--include user,response,bash,edit`,
or persistently by omitting `task` from `report.include` in
`~/.agenthud/config.yaml`.

**Output:** the parent's Task row shows the task description as
usual. Below it, a `<task-result>…</task-result>` XML block
contains the subagent's returned text (truncated by
`--detail-limit`). The XML tag form survives subagent output that
contains code fences, horizontal rules, or yaml frontmatter —
content can't forge the boundary.

**Other tools** (Edit, Write, Read) deliberately keep their
`detailBody` *out* of the markdown report to keep payload size
bounded. The TUI detail view still renders those bodies on `↵`.

**Available since:** v0.13.0.

## Config

Global config at `~/.agenthud/config.yaml`. Auto-created on first
run with sensible defaults. Hidden items (per-user UI state) live
in a sibling `~/.agenthud/state.yaml`, app-managed (v0.9.0 split).

**Resolution order for `report` / `summary` options:**
`CLI flag → summary.<key> → report.<key> → built-in default`.
Effective values are echoed to stderr at the start of each run.

**Schema (current defaults shown):**

```yaml
refreshIntervalMs: 2000

# Hidden from the tree (managed via 'h' key)
hiddenProjects: []
hiddenSessions: []
hiddenSubAgents: []

# Activity filter presets (cycle with 'f' key)
# "all" / "*" / "any" / [] all mean unfiltered
filterPresets:
  - ["all"]
  - ["response", "user"]
  - ["commit"]

# Defaults for `agenthud report` (CLI flags still win per-invocation)
report:
  include: [user, response, bash, edit, thinking, task]
  detailLimit: 120
  withGit: false
  format: markdown

# Defaults for `agenthud summary` (inherits from report.* when omitted)
summary: {}
```

**Allowed `include` types:** `user`, `response`, `bash`, `edit`,
`thinking`, `read`, `glob`, `commit`, `task`.

**Available since:** v0.9.0 in current shape; `report.*` /
`summary.*` config-driven defaults v0.12.0; `task` type v0.13.0.

## Effective options

At the start of every `report` and `summary` run, agenthud writes
a one-line summary of the effective options to stderr:

```
report → include=[user,response,bash,edit,thinking,task] detail-limit=120 with-git=off format=markdown
prompt = ~/.agenthud/summary-prompt.md
```

Tells you what was actually used. No surprises about hidden
hard-coded defaults.

**Available since:** v0.12.0.

---

## Keybindings

Sourced from `src/ui/HelpPanel.tsx:SECTIONS` — the same content
the `?` overlay renders in-app.

### Project tree

| Key | Action |
|---|---|
| `↑` `↓` / `k` `j` | Move selection |
| `←` / `h` | Jump to parent (sub-agent → session, session → project) |
| `PgUp` / `Ctrl+B` | Page up |
| `PgDn` / `Ctrl+F` | Page down |
| `↵` | Expand/collapse project, session, or summary |
| `H` (Shift+H) | **Toggle** hide on selected — hides if visible, unhides if hidden. Mutates — case matters. |
| `a` | Toggle "show hidden items" in the tree (dim `⊘` marker on hidden rows). |
| `t` | Track: auto-follow the newest live sub-agent (any nav key turns it off) |
| `Tab` | Switch focus to activity viewer |
| `r` | Refresh now |

> **Note (v0.14.0):** Hide moved from `h` to `Shift+H` and became a toggle. The lowercase `h` is now the vim-left alias for `←` (jump to parent). Press `a` to reveal hidden items in the tree (they render dim with a `⊘` marker); `H` on a hidden row unhides it. A status-bar indicator surfaces hidden-but-still-active items so an accidentally-hidden hot session never becomes invisible.

### Activity viewer

| Key | Action |
|---|---|
| `↑` `↓` / `k` `j` | Scroll one line |
| `PgUp` / `PgDn` / `Ctrl+B` / `Ctrl+F` | Scroll one page |
| `Ctrl+U` / `Ctrl+D` | Scroll half page |
| `g` | Jump to top (oldest) |
| `G` | Jump to live (newest, bottom) |
| `↵` | Open detail view for selected activity |
| `f` | Cycle filter preset (set in `config.yaml`) |
| `Tab` | Switch focus to project tree |

### Detail view

| Key | Action |
|---|---|
| `↑` `↓` / `k` `j` | Scroll |
| `↵` / `Esc` / `q` | Close |

### Always available

| Key | Action |
|---|---|
| `?` | Toggle this help |
| `q` | Quit (or close detail/help) |

### Session status badges

| Badge | Meaning | Color |
|---|---|---|
| `[hot]` | Updated in the last 30 minutes | green |
| `[warm]` | Updated in the last hour | yellow |
| `[cool]` | Updated earlier today | cyan |
| `[cold]` | Last updated yesterday or earlier (collapsed by default) | gray |
| `[working]` | Claude is mid-turn (tool running or about to respond) | green |
| `[waiting]` | Claude yielded; ball is in your court (incl. `AskUserQuestion`) | magenta |

`[working]` / `[waiting]` replace `[hot]` within the 30-minute window
(v0.10.0); `warm/cool/cold` stay time-based.

## Files & directories

| Path | Purpose |
|---|---|
| `~/.agenthud/config.yaml` | User settings (edit freely) |
| `~/.agenthud/state.yaml` | Hidden items (app-managed) |
| `~/.agenthud/summary-prompt.md` | Daily summary prompt template (auto-copied on first run) |
| `~/.agenthud/summary-range-prompt.md` | Range summary prompt template |
| `~/.agenthud/summaries/` | Cached daily and range summaries |
| `~/.agenthud/summaries/index.md` | Auto-generated navigable index |
| `~/.claude/projects/` | Claude Code session JSONL files (read-only) |
| `~/.codex/sessions/` | Codex CLI rollout JSONL files (read-only) |
| `…/Kiro/User/globalStorage/kiro.kiroagent/` | Kiro IDE session + execution files (read-only) |
| `~/.kiro/sessions/cli/` | Kiro CLI session files (read-only) |

Per-provider on-disk schemas (with `jq` verification commands) are
documented under [`docs/schemas/`](./docs/schemas/).

## Environment variables

| Variable | Effect |
|---|---|
| `CLAUDE_PROJECTS_DIR` | Override the Claude projects directory (default: `~/.claude/projects`). Useful for backups or mounted volumes. (v0.8.2) |
| `CODEX_SESSIONS_DIR` | Override the Codex sessions directory (default: `~/.codex/sessions`). |
| `KIRO_SESSIONS_DIR` | Override the Kiro CLI sessions directory (default: `~/.kiro/sessions/cli`). |
| `KIRO_IDE_SESSIONS_DIR` | Override the Kiro IDE `workspace-sessions` directory. |
| `AGENTHUD_HOME` | Override the app data directory (default: `~/.agenthud`). |
| `WSL_DISTRO_NAME`, `/proc/version` markers | WSL detection (cached for the process; v0.12.4). Affects `--open` opener preference (`wslview` over `xdg-open`) and the cwd-home protection in legacy-config migration. |
| `NODE_ENV` | Set to `production` by default in the bundled binary to disable React dev-mode profiler accumulation (~12× memory-leak reduction; v0.9.0). |
| `FORCE_COLOR` / `NO_COLOR` | Honored by Ink for color output. |

---

_For the change history per version, see [CHANGELOG.md](./CHANGELOG.md). To
report a bug or request a feature, see the [issue
tracker](https://github.com/neochoon/agenthud/issues)._
