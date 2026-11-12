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
| Live event stream | `agenthud follow` | v0.19.x | [Follow](#follow) |
| Browser UI | `agenthud web` | v0.20.x | [Web UI](#web-ui) |
| Workspace-scoped report / summary | `--cwd` / `--project` | v0.20.x | [Report](#report) |
| Global config | `~/.agenthud/config.yaml` | v0.9.0 | [Config](#config) |
| Effective-options stderr line | (automatic) | v0.12.0 | [Effective options](#effective-options) |

Cross-cutting reference:

- [Keybindings](#keybindings) — full key map (mirrors what `?` shows in-app)
- [Runtime requirements](#runtime-requirements) — which Node version each source needs
- [Files & directories](#files--directories) — what lives in `~/.agenthud/`
- [Environment variables](#environment-variables)

---

## Watch

The default mode. Real-time TUI: project tree on top, activity viewer
on the bottom, both polling every agent's session store (see
[Runtime requirements](#runtime-requirements)) every ~2 s.

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
| `--cwd` | off | Only the project containing the current directory |
| `--project PATH\|NAME` | off | Repeatable. Whitelist of workspaces (absolute paths, or project names unique among discovered projects) |

**Workspace scope:** `--cwd` / `--project` restrict the report to a
whitelist of projects — pass `--project` more than once to work across
several at once (`--project agenthud --project desktop_pet`). Resolution
walks the *discovered* projects (any provider), not `~/.claude/projects/`
directory names, so a Kiro or DSH workspace scopes correctly; `--cwd`
picks the deepest project containing the working directory. An unknown
value exits 1 with the list of known projects, and an ambiguous
`--project web` (two projects with that name) refuses to guess and asks
for a path. The resolved whitelist is echoed as `scope = a, b` on stderr.

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
activity report (markdown) into an agent CLI (the **summary
engine**: Claude / Codex / Kiro — see `--engine` below).

**Invocation:** `agenthud summary [--date ...] [flags]`

**Flags** (in addition to `report`'s `--include`, `--detail-limit`,
`--with-git`):

| Flag | Default | Description |
|---|---|---|
| `--date YYYY-MM-DD \| today \| yesterday \| -Nd` | `today` | Date to summarize |
| `--engine NAME` | `auto` | Which agent CLI synthesizes the summary: `auto` (first installed of claude → codex → kiro), `claude`, `codex`, `kiro`. Also set via `summary.engine` in config. |
| `--prompt TEXT` | (template file) | Override prompt inline (daily only) |
| `--style PATH` | `~/.agenthud/summary-style.md` | Style-reference file to imitate. Also set via `summary.style` (a path, or `false` to disable) |
| `--no-style` | off | Ignore the style reference for this run |
| `--force` | off | Regenerate even if cached |
| `--model NAME` | engine default | Forward to the engine's model flag (e.g. `sonnet`, `gpt-5`, full id) |
| `-y, --yes` | off | Skip confirmation prompt |
| `-o, --open` | off | Open the produced summary in OS default app |
| `-I, --open-index` | off | Open `~/.agenthud/summaries/index.md` |
| `--cwd` | off | Summarize only the project containing the current directory |
| `--project PATH\|NAME` | off | Repeatable. Whitelist of workspaces (see [Report](#report)) |

**Workspace scope:** a scoped summary covers the whitelisted projects
and is cached SEPARATELY —
`~/.agenthud/summaries/YYYY-MM-DD--<project>-<hash>[+<project>-<hash>].md`
— so it never overwrites the whole-day digest for the same date, and the
index lists both (`2026-11-12 (Thu)` and
`2026-11-12 (Thu) · agenthud + desktop-pet`). The suffix is sorted, so
the same project set in any order shares one cache file. The backlink
prev/next chain stays within one scope set, so paging through days never
jumps between scopes. `scopeToProjects` is applied at discovery, which
means the payload, the empty-day check and `--with-git` all see only
those workspaces.

**Behavior:**
- Builds the markdown payload via `generateReport`. If the day has
  zero activity, announces "no activity — skipping" and returns
  exit 0 without spawning the engine or writing a file (v0.12.2 /
  v0.12.3).
- Past days are cached at `~/.agenthud/summaries/YYYY-MM-DD.md`
  (scoped: `YYYY-MM-DD--<project>-<hash>.md`) and reused on subsequent
  runs. Today is always regenerated.
- Prompt template comes from `~/.agenthud/summary-prompt.md`
  (auto-created on first run from
  `src/templates/summary-prompt.md`); `--prompt` overrides for
  one run. The shipped template asks for **Simplified Chinese output**
  in a **weekly-report shape** — `### 工作内容`, project groups numbered
  `1、` `2、`, items `（1）` `（2）` — and spells out the register rules
  (omit the subject, 了-suffixed verbs, semicolon-chained parallel
  actions, close on a state or judgement, state problems plainly).
  Edit the file to change the language or shape.
- A **style reference** is prepended to that prompt when the file
  exists: `~/.agenthud/summary-style.md` by default, `--style <path>` for
  a one-off, `--no-style` to drop it, `summary.style` in config to point
  elsewhere or `false` to disable. A missing default file means "off" (no
  error); an unreadable EXPLICIT path is an error. Capped at 8,000
  characters, cut at a paragraph break. Feed it a distilled *profile* of
  your writing, not an archive — tens of KB of real reports costs ~10K
  input tokens per run and makes the model lift project names and
  conclusions out of the samples.
- The prompt is part of the cache key: the provenance marker records a
  `prompt: <fingerprint>`, so editing the template — or the style
  reference, which is composed into it — regenerates instead of serving
  text written under the old instructions. Files written before that
  field existed are still reused as-is — add `--force` once to re-render
  them.
- Token usage line printed at the end (`N in / M out · cache: A
  read, B written · $X.XXXX`) — Claude engine only; Codex/Kiro
  omit it.
- Oversize reports (~300K tokens estimated) print a warning and,
  interactively, prompt one more time before sending (v0.9.4).
- The Claude engine runs `claude -p --no-session-persistence` so
  the summary call doesn't pollute the session tree (v0.9.2 /
  v0.9.3). Codex uses `codex exec -o <file>`; Kiro uses
  `kiro-cli chat --no-interactive`.
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

## Follow

`agenthud follow` streams a single, chronologically-merged feed of
every new event across **all** sessions and sub-agents — a humane
`tail -f` for "what are all my agents doing," and the
machine-readable substrate a higher-level supervisor can consume.
It is read-only: it observes, never acts.

```bash
agenthud follow [--since SPEC] [--json] [--include TYPES] [--once]
```

**Flags:**

- `--since now|<N>h|<N>m|<N>s` — where the stream starts (default `now`,
  i.e. pure tail). `<N>h` / `<N>m` / `<N>s` backfill the last N
  hours/minutes/seconds, then follow live. (`HH:MM` / ISO / `last` are
  deferred.)
- `--json` — emit NDJSON (one JSON object per line, the stable
  supervisor contract) instead of human lines.
- `--include TYPES` — comma list filtering **activity** event
  subtypes only (same vocabulary as `report.include`:
  `response,bash,edit,thinking,read,glob,user,task`). `state` and
  `lifecycle` events always pass — they are the supervisor's trigger
  signal; `--include` only narrows the activity firehose.
- `--once` — emit the backfill since `--since` and exit, instead of
  streaming (the `tail` to the default's `tail -f`). Handy for scripts
  and quick "what happened in the last N" checks. Pair with a non-`now`
  `--since` (e.g. `--since 5m --once`); `--since now --once` emits nothing.

**Event model (the NDJSON contract).** One JSON object per line,
additive-only:

```ts
interface FollowEvent {
  ts: number;                 // epoch ms (activity ts; detection time for state/lifecycle)
  type: "activity" | "state" | "lifecycle";
  provider: string;           // "claude" | "codex" | "kiro" | "kiro-ide" | "opencode"
  project: string;            // project name (basename of cwd)
  projectPath: string;        // absolute cwd
  session: string;            // owning top-level session's full id
  subagent: string | null;    // sub-agent's own id when the event is the sub-agent's; else null
  // activity:  label?, detail?
  // state:     from?, to?    (working | waiting | null)
  // lifecycle: kind?         (session_start | session_end | subagent_spawn | subagent_done)
}
```

- **activity** — a new `ActivityEntry` appeared in a session's
  history (Read / Edit / Bash / Response / …).
- **state** — a session's `liveState` changed (working↔waiting↔null).
  `working→waiting` is the headline "this agent is now waiting on the
  user" trigger.
- **lifecycle** — a session/sub-agent was first seen or disappeared.

**Human line format** (default, no `--json`):
`[HH:MM:SS] project/session[/subagent]  <label>  <detail>` — plain,
width-naive, pipe-safe.

**Consumer note.** Pipe to a supervisor process, or persist with
`agenthud follow --json > events.ndjson`. Latency equals the refresh
interval (default 2s, `refreshIntervalMs` in config). Broken pipe
(e.g. `| head`) exits 0 quietly; SIGINT/SIGTERM stop cleanly.

**Available since:** v0.19.x.

## Web UI

The same tree and activity viewer as the TUI, in a browser, plus the
report and summary controls — for people who would rather click than
memorize keys. **The interface is in Chinese.**

**Invocation:** `agenthud web [--port N] [--open] [--cwd | --project …]`

```bash
agenthud web                # http://127.0.0.1:7787/?token=…
agenthud web --port 9000 -o # different port, open the browser
agenthud web --project a --project b   # start on a workspace whitelist
agenthud web --cwd          # start scoped to this directory's project
```

| Flag | Default | Description |
|---|---|---|
| `--port N`, `-p N` | `7787` | Port to listen on; `0` picks a free one |
| `-o, --open` | off | Open the URL in the default browser |
| `--cwd` | off | Start scoped to the current directory's project |
| `--project PATH\|NAME` | off | Repeatable. Start on that project whitelist |

**Layout, and why** — the page is a three-step flow, and only what you can
act on is open by default:

- **① 勾选工作区** (top, always open, the primary control): one checkbox
  per discovered project with its session / active counts, plus
  `全选` / `清空` / `仅活跃`. **At least one workspace must be checked** —
  the session tree, the report and the summary all show *only* the
  checked ones. The selection persists in `localStorage`, and the
  URL/`--project` whitelist seeds it on first load.
- **② 时间范围** (directly under it): `单日` / `最近 5 天` / `最近 7 天` /
  `自定义` (two date pickers). The current range and its day count are
  shown inline; a range over 14 days warns that a range summary costs one
  model call per day plus one to synthesize.
- **③ 查看** (right, three tabs): the selected session's activity with
  click-to-expand tool bodies (Bash output, Read with a dimmed
  line-number gutter, Edit as a colored diff); the markdown report for
  the chosen range + whitelist; and a summary pane whose
  `生成当天摘要` / `生成区间摘要（N 天）` button POSTs to the server and
  renders the result, with previous summaries collapsed under a
  `<details>` you open on demand.
- Only read-only detail is folded away: projects collapse, non-active
  sessions hide behind `展开 N 个冷会话` (a), tool bodies open on click,
  the summary history sits behind its `<details>`.

**Behavior:**
- **Loopback only.** Refuses to bind anything but `127.0.0.1`, and
  rejects a request whose `Host` header isn't `127.0.0.1:<port>` /
  `localhost:<port>` — the DNS-rebinding guard.
- **Token-guarded.** Each run mints a random token, printed as part of
  the URL; every `/api/*` call needs it (`X-Agenthud-Token`). Another
  local process, or a stray tab, cannot drive the API without it.
- The tree polls every 3s using the same discovery the TUI uses, so a
  session that appears in one appears in the other.
- `/api/report` takes either `?date=` (one day) or `?from=&to=` (an
  inclusive range, capped at 62 days); a range returns one document with
  a `## <date>` section per day. `/api/summary` accepts the same pair and
  switches to the range runner (per-day dailies, then one synthesis).
- `GET /api/activity` resolves the file from the server's own discovery;
  a client-supplied `path` is only checked for consistency, so the
  endpoint can't be turned into an arbitrary file reader.
- The summary button POSTs to `/api/summary` and returns the markdown
  from the cache file; the server calls the runner with `quiet: true`,
  so nothing is sprayed into its own stdout. Expect 30–90s for a day,
  longer for a range.

**Available since:** v0.20.x.

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
# engine: auto            # auto | claude | codex | kiro
# model: sonnet           # forwarded to the engine's model flag
# style: ~/.agenthud/summary-style.md   # or false to disable
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
| `/` | Narrow-finder: type to filter sessions/sub-agents; `↑`/`↓` to select a hit; `↵` to select that session (viewer follows) and restore the full tree; `Esc` to cancel. |

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
| `/` | Narrow-finder: type to filter visible activities, `↑`/`↓` to select, `↵` to jump cursor to the chosen activity and restore the full stream, `Esc` to cancel. Composes (AND) with the `f` type-filter. |

### Detail view

| Key | Action |
|---|---|
| `↑` `↓` / `k` `j` | Scroll |
| `↵` / `q` | Close |
| `Esc` | Close (or close search if open, staying in detail view) |
| `/` | Open search — type to jump to first match; matches highlighted |
| `n` / `N` | Next / previous match (after pressing `↵` to commit the query) |

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
| `[working]` | The agent is mid-turn (tool running or about to respond) | green |
| `[waiting]` | The agent yielded; ball is in your court (incl. `AskUserQuestion`) | magenta |

`[working]` / `[waiting]` replace `[hot]` within the 30-minute window
(v0.10.0); `warm/cool/cold` stay time-based.

## Runtime requirements

`agenthud` requires **Node.js 20+**. Two session sources depend on a
built-in Node module that only ships in newer releases; when it is
absent the provider reports itself unavailable (`isAvailable()` false)
and is skipped — no error, no crash, the other sources keep working.

| Source | Built-in module used | Minimum Node |
|---|---|---|
| Claude Code, Codex CLI, Kiro CLI, Kiro IDE | `node:fs` only | 20 |
| opencode | `node:sqlite` | 22 |
| DeepSeek Harness (DSH) | `node:zlib` (zstd) | 22.15 |

`engines` in `package.json` stays at `>=20` on purpose: the binary is
still useful on Node 20 for four of the five sources. To see what was
picked up, run `agenthud --once` (per-row provider tag) or
`agenthud report --format json` (a `provider` field per session).

## Files & directories

| Path | Purpose |
|---|---|
| `~/.agenthud/config.yaml` | User settings (edit freely) |
| `~/.agenthud/state.yaml` | Hidden items (app-managed) |
| `~/.agenthud/summary-prompt.md` | Daily summary prompt template (auto-copied on first run) |
| `~/.agenthud/summary-range-prompt.md` | Range summary prompt template |
| `~/.agenthud/summary-style.md` | Style reference the summary imitates (optional; absent = off) |
| `~/.agenthud/summaries/` | Cached daily and range summaries (scoped ones: `DATE--<project>-<hash>.md`) |
| `~/.agenthud/summaries/index.md` | Auto-generated navigable index |
| `~/.claude/projects/` | Claude Code session JSONL files (read-only) |
| `~/.codex/sessions/` | Codex CLI rollout JSONL files (read-only) |
| `…/Kiro/User/globalStorage/kiro.kiroagent/` | Kiro IDE session + execution files (read-only) |
| `~/.kiro/sessions/cli/` | Kiro CLI session files (read-only) |
| `~/.dsh/sessions/` | DSH session logs (`session.v4.jsonl.zstd`, zstd frames — read-only) |
| `~/.dsh/storages/session_projcache/` | DSH projection cache: titles, model, context gauge, open step (read-only) |

Per-provider on-disk schemas (with `jq` verification commands) are
documented under [`docs/schemas/`](./docs/schemas/).

## Environment variables

| Variable | Effect |
|---|---|
| `CLAUDE_PROJECTS_DIR` | Override the Claude projects directory (default: `~/.claude/projects`). Useful for backups or mounted volumes. (v0.8.2) |
| `CODEX_SESSIONS_DIR` | Override the Codex sessions directory (default: `~/.codex/sessions`). |
| `KIRO_SESSIONS_DIR` | Override the Kiro CLI sessions directory (default: `~/.kiro/sessions/cli`). |
| `KIRO_IDE_SESSIONS_DIR` | Override the Kiro IDE `workspace-sessions` directory. |
| `DSH_HOME` | Override the DSH data root (default: `~/.dsh`). Sessions and the projection cache are resolved from it. |
| `DSH_SESSIONS_DIR` | Override the DSH sessions root outright (default: `<DSH_HOME>/sessions`). |
| `AGENTHUD_HOME` | Override the app data directory (default: `~/.agenthud`). |
| `WSL_DISTRO_NAME`, `/proc/version` markers | WSL detection (cached for the process; v0.12.4). Affects `--open` opener preference (`wslview` over `xdg-open`) and the cwd-home protection in legacy-config migration. |
| `NODE_ENV` | Set to `production` by default in the bundled binary to disable React dev-mode profiler accumulation (~12× memory-leak reduction; v0.9.0). |
| `FORCE_COLOR` / `NO_COLOR` | Honored by Ink for color output. |

---

_For the change history per version, see [CHANGELOG.md](./CHANGELOG.md). To
report a bug or request a feature, see the [issue
tracker](https://github.com/neochoon/agenthud/issues)._
