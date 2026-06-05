# Changelog

## [Unreleased]

## [0.11.2] - 2026-06-05

### Fixed
- **`report` dropped user prompts by default.** The default
  `--include` set didn't contain `user`, so every session block
  opened on `Thinking` and the prompt that actually triggered the
  turn was missing — reports read as if Claude acted out of nowhere.
  `user` is in the default set now; anyone who wants the prior
  output passes `--include response,bash,edit,thinking`.
- **Activity-viewer scroll-up couldn't reach git-merged entries.**
  The viewer renders `mergedActivities` (session activities + git
  commits, time-sorted), but `k` / `PgUp` / `Ctrl+U` clamped
  `scrollOffset` against the raw session-activity length, leaving
  the earliest entries unreachable when git commits were merged in.
  All three scroll-up handlers now clamp against the merged length,
  matching `g`'s existing behavior.

## [0.11.1] - 2026-06-04

### Fixed
- **Cold-only project tree was unusable at boot.** When every
  project's most recent session was older than today (e.g. after a few
  days away), the tree showed just a "N cold" summary row with no
  selection and j/k were silent no-ops. The cold group now expands by
  default and the boot selection lands on the cold-group sentinel so
  navigation works immediately.

## [0.11.0] - 2026-06-04

### New
- **`--cwd` to scope the view to a single project.** Walks up from
  `process.cwd()` to find the nearest registered Claude project and
  shows only that project (and its sub-agents). Header reads
  `Projects [<basename>]`. Exits 1 with a stderr message when no
  containing project is found — keeps an empty view from being
  mistaken for "no activity". Works in both `--watch` and `--once`,
  runs side-by-side with an unfiltered instance.
- **Read detail view shows the file content.** Pressing `↵` on a
  `Read` activity now shows the read content with the same
  syntax-coloring rules as Edit diffs, instead of just the path/range
  header.
- **Line numbers in the Read detail view.** Read content rows are
  prefixed with file line numbers; the gutter is dimmed so the eye
  lands on the code first.

### Fixed
- **`--cwd` on Windows.** First implementation used `path.sep` for the
  boundary check, so POSIX-style stored paths never matched on
  Windows. Accepts both `/` and `\` now.
- **Git commits surface inside nested repos.** When agenthud's project
  was a subdirectory of a larger repo, the commit feed could miss
  commits because the search ran from the wrong directory. Walks up to
  the actual repo root now.
- **Half-page scroll in the detail view.** Ctrl+U / Ctrl+D weren't
  wired up in the detail view — only the activity viewer. Both scroll
  consistently now.
- **Whitespace/indentation preserved in code and diff detail views.**
  Trailing-space trimming was collapsing indentation in some Edit/Read
  views; preserved verbatim now.

## [0.10.0] - 2026-05-25

### New
- **Session liveness badges (`[working]` / `[waiting]`).** Recently-active session rows now show what state the session is in, not just when it was last touched. `[working]` (green) means Claude is mid-turn (a tool is running or it's about to respond); `[waiting]` (magenta) means Claude yielded the turn and the ball is in your court — including an explicit `AskUserQuestion`. Derived from the structure of the JSONL tail, so a long-running tool still reads as `[working]` even while the file is momentarily quiet. Only replaces `[hot]` (within the 30-minute window); `warm/cool/cold` stay time-based, and non-interactive sessions are unaffected.
- **Rich tool activity details.** Tool rows now summarize what actually happened instead of just the tool name or filename: `Edit App.tsx L45-52 +3 -1` (line range + added/removed counts), `Write package.json L1-65 +65`, `Read App.tsx L60-189` (range), `TaskUpdate #1 pending→in_progress`, and `TaskCreate` shows the task subject. Pressing `↵` on an Edit opens the real unified diff with the same green/red/cyan coloring as git commits; a Write shows the written file content. Built by correlating each tool call with its result later in the session JSONL. `agenthud report` inherits the richer one-line detail for free.

## [0.9.5] - 2026-05-21

### New
- **Live-row treatment in the activity viewer.** The newest visible row gets a spinning icon, brighter color, and a "flashlight" highlight band that sweeps left → right across its label. Replaces the standalone sliding-arrow row from v0.9.3 — the alive cue now lives on the actual row, gaining the breathing slot back as real activity space.
- **Tracking mode (`t`)** — auto-follow the newest live sub-agent (or session if no live sub-agent) across the entire tree. Status bar swaps `t: track` for `TRK ●`; Projects panel header shows `[LIVE ⠧]`. Designed for ambient monitoring on a second monitor while long Claude skills churn through many sub-agents. Any explicit nav key turns it off.

### Changed
- **Tracking picks "new" sub-agents, not "newest mtime".** The first version kept whichever sub-agent had the most recent file write — in practice the already-busy sub-agent always won, so newly started ones never got selected. Now tracking keeps a snapshot of all known ids when enabled and jumps only when a *new* id appears, or when the current selection cools off.
- **1-second polling while tracking is on.** macOS `fs.watch` recursive can silently drop events for files inside sibling project directories; the poll guarantees cross-project jumps land within a second.

### Fixed
- **Smoother spinner + flashlight.** Three perf passes after the v0.9.4 baseline:
  1. The flashlight tick is now gated on `isLive && !helpMode && !detailMode && activities.length > 0` — no more 100ms App re-renders while paused or while reading help.
  2. Spinner and flashlight share one 150ms cadence (was 100ms) so both animations advance on the same React render.
  3. `ActivityRow` extracted into a `React.memo`'d component; non-live rows skip re-render on every tick, so even tall viewers stay smooth.

## [0.9.4] - 2026-05-20

### New
- **`agenthud summary --model <name>`** forwards `--model` to `claude -p`. Summarization is a low-reasoning task, so cheaper models almost always suffice — `sonnet` (~40% cheaper than Opus, 1M context) or `haiku` (~80% cheaper, 200K context). Accepts a short alias or a full model id. Default unchanged (claude's own default model).
- **Oversize report warning.** The input stats line now includes an estimated token count. Reports above ~300K tokens print a loud warning and, in interactive mode, prompt one more time before sending. Range mode with `-y` only prints the warning and proceeds.

### Fixed
- **`report --include` validates unknown types.** A typo like `--include response,bas` used to be silently accepted (no match, no error). Now unknown tokens trigger an error listing the offending values and the full list of valid types. Missing value after `--include` also errors.

## [0.9.3] - 2026-05-20

### Changed
- **Activity viewer is now tail-feed.** Newest activity sits at the bottom, like `tail -f` / terminal logs / chat apps. Empty padding moved to the top. `g` jumps to the oldest (top), `G` to the live edge (bottom) — vim convention restored. PgUp/PgDn directions swap accordingly. The status bar's `PAUSED` indicator now shows `↑N` (scrolled up from live) and `+N↓` (new entries below the current view).
- **Top-panel renamed "Projects"** (was "Sessions"). The tree groups sessions under projects at the top level, so the title now matches the structure. Updated Tab hint, HelpPanel section, and README.
- **Elapsed labels coarsen past one hour.** Replaced `27h35m` style with single-unit `s/m/h/d/w/mo/y`. Cold sessions become readable at a glance ("1d", "3w", "2mo").
- **Project rows show elapsed time too.** Right edge of each project row uses the most recently modified session's mtime as the project's "last activity".
- **Width-aware title truncation.** Session and sub-agent titles now truncate by terminal display cells (CJK-aware) and append a single-cell `…` when clipped. Upstream task-description / first-prompt caps lifted from 60/80 → 300 chars, so wide terminals show more.
- **Filter presets accept "all" / "*" / "any" keyword.** Same semantic as the bare `[]` (no filter), but legible to non-coders. Default `filterPresets` updated to `[["all"], ["response", "user"], ["commit"]]` — the middle preset now includes user prompts so the conversation flow is one cycle away.
- **Commit detail uses `git show --stat --patch`** so actual diff hunks appear (the colorizer can do something with them).

### New
- **Sliding `›` live indicator** at the viewer's bottom edge. Animates left → right (180ms per cell, full content width) while the viewer is in LIVE mode and the app is in watch mode. Hidden when paused, empty, or non-watch. Resets to position 0 whenever the viewer's subject changes.
- **Detail view syntax coloring.** Diff lines color green (`+`), red (`-`), cyan (`@@` hunks), dim metadata (`commit/Author/Date/diff/index`). Outside commits, fenced code blocks (` ```...``` `) render in cyan to separate prose from code. No language-specific syntax highlighting — just structural cues.
- **Alternate screen buffer in watch mode.** Like `vim` / `htop` / `btop`: launching switches to a fresh buffer, quitting (`q`, Ctrl+C, SIGTERM, or an uncaught error) restores the pre-launch shell verbatim. No TUI residue.
- **Minimum terminal size guard.** Watch mode below 80 cols × 20 rows refuses to render the split UI and shows a clear "needs larger terminal" panel that redraws automatically when you resize.
- **Scrollable help overlay.** The `?` overlay now scrolls (`j/k`, `↑/↓`, `PgUp/PgDn`, `Ctrl+B/F`, `Space`, `g/G`) with a bottom indicator (`-- current / total --`) so the full content is reachable on shorter terminals.
- **Tree cursor stays visible when focus is on the viewer.** Selected row keeps a dim version of its highlight; Tab back to the tree restores the bright state. Avoids losing project/session context while reading sub-agent activity in the viewer.
- **Right gap on tree rows.** A 3-cell padding is reserved on the right side of session and project rows so the title doesn't run flush against the elapsed/model column.
- **Breathing-room blank slot at the viewer bottom.** Reserves one row below the newest activity (no real activity sits flush against the box border).
- **Session-status documentation.** README and HelpPanel now document the `[hot]/[warm]/[cool]/[cold]` badges (30 min / 1 hour / same day / older) with their colors and the cold-collapse rule.

### Removed
- **`s` save-log hotkey** — superseded by `agenthud report`. The `logDir` config field and `~/.agenthud/logs/` references are gone too.
- **Stale `src/templates/config.yaml`** — leftover v0.7.x panel-based template no longer read by the loader.

### Fixed
- **Running from `~`** no longer treats the global `~/.agenthud/config.yaml` as a "legacy project config" and offers to delete it. Regression guard added.
- **Range summary cache stale-when-today.** `agenthud summary --last 7d` on the same day previously returned the cached output even though today's daily had grown. Range cache now treated as valid only for past-only ranges.
- **Cold sub-agents re-expand on session collapse.** Once toggled visible, the cold sub-agent group used to stay expanded across the parent session's collapse/reopen cycle. Closing the parent session now resets the per-session expansion flag, so reopening returns to the default (cold subs grouped under the sub-summary sentinel).
- **Status bar overflow on narrow terminals.** When `AgentHUD vX.Y.Z` branding + shortcuts exceeded the width, the two halves overlapped. Now the branding is dropped first, then shortcut items trim from the front, keeping `?: help` and `q: quit` as the safety net.
- **`agenthud summary` polluting its own tree.** `claude -p` is now invoked with `--no-session-persistence`, so the summary call no longer creates a JSONL session file under `~/.claude/projects/`.
- **`--with-git` help text** corrected — previously said "from cwd"; the implementation actually pulls commits from each session's projectPath.

## [0.9.2] - 2026-05-18

### New
- **Multi-day range summary** — `agenthud summary --last 7d`, `agenthud summary --from X --to Y`. Daily summaries are cached and re-summarized into a cross-day synthesis (themes, multi-day workstreams, recurring patterns). Range output cached at `~/.agenthud/summaries/range-FROM_TO.md`. `-y/--yes` skips per-day confirmation prompts.
- **Just-in-time confirmation prompts** — Each missing daily prompts only after its scan stats are shown (sessions/activities/commits/KB), so you decide with concrete context. Enter accepts the default (`[Y/n]`).
- **Progress feedback for summary** — `scanning sessions...`, input stats, `sending to claude (this may take a minute)...`, and final `saved to` line surface during the call.
- **Token usage display** — Each summary call ends with `N in / M out · cache: A read, B written · $X.XXXX` extracted from claude's `result` event.
- **Range prompt template** — `~/.agenthud/summary-range-prompt.md` auto-created on first range run; guards against per-day timeline recap and surfacing tooling state (`cached`, `not logged in`) as content.
- **Improved daily prompt template** — Tighter section structure (Context / Key Accomplishments / Technical Insights / Major Code Changes / Open Questions), length guidance, omit-empty rule, and a hallucination guard for "Open Questions".
- **Scrollable help overlay** — `?` overlay now scrolls (`j/k`, `↑/↓`, `PgUp/PgDn`, `Ctrl+B/F`, Space, `g/G`) instead of silently truncating on shorter terminals. Bottom indicator shows current / total and a scroll hint.
- **Session status documentation** — README and HelpPanel now document the `[hot]`/`[warm]`/`[cool]`/`[cold]` badges (30 min / 1 hour / same day / older) with their colors and the cold-collapse rule.

### Changed
- **`claude -p` called with `--no-session-persistence`** — Summary calls no longer create JSONL session files under `~/.claude/projects/`, so they don't pollute agenthud's own session tree.
- **`--date` accepts `yesterday` and `-Nd`** — In addition to `YYYY-MM-DD` and `today`.
- **Cache invalidated on failure** — A failed `claude -p` run now deletes the partial cache file so the next run doesn't replay error output.
- **Top-panel title renamed `Sessions` → `Projects`** — The tree groups sessions under projects at the top level; the title now matches the structure. Tab hint and HelpPanel section also updated.
- **Status bar collapses on narrow terminals** — When `AgentHUD vX.Y.Z` branding + shortcuts exceed width, branding is dropped first, then shortcut items are trimmed from the front (keeping `?: help` and `q: quit`).
- **`--with-git` help text corrected** — Previously said "from cwd"; the implementation actually pulls commits from each session's projectPath.

### Removed
- **`s` save-log hotkey** — Superseded by `agenthud report` which produces the same activity dump as a one-shot CLI invocation. `logDir` config field and `~/.agenthud/logs/` directory references removed alongside.
- **Stale `src/templates/config.yaml`** — Leftover v0.7.x panel-based config (no longer read by the current loader, no code references). Removed from the bundle.

### Fixed
- **CI also runs `tsc --noEmit`** — Catches type errors that tsup transpilation alone would ship (e.g., the `tree.sessions` regression in v0.9.0).
- **Running from home directory** — `agenthud` launched from `~` no longer offers to delete `~/.agenthud/config.yaml` as a "legacy project config" (or show the related migration banner). The legacy-detection now skips paths that resolve to the global config.
- **Stale range cache when today is in range** — `agenthud summary --last 7d` on the same day previously returned the cached range output even though today's daily had since grown. Range cache is now treated as valid only for past-only ranges.
- **Watch mode below 80×20** — Refuses to render the split-view UI on terminals smaller than 80 cols × 20 rows and shows a clear "needs larger terminal" panel instead. Resizing the window auto-redraws.

## [0.9.1] - 2026-05-17

### Fixed
- **Windows path test** — `summaryRunner` test now accepts both `/` and `\` separators
- **CI gates publish** — Publish workflow waits for the cross-platform CI matrix to pass on the same commit before pushing to npm

## [0.9.0] - 2026-05-17

### New
- **Project-grouped session tree** — Sessions are now grouped under their project (project name + path at the top). Session rows show short ID + first user prompt instead of redundant project name.
- **`agenthud summary` command** — Generate LLM summary of daily activity via `claude -p`. Cached at `~/.agenthud/summaries/YYYY-MM-DD.md`. Options: `--date`, `--prompt`, `--force`. Editable prompt template at `~/.agenthud/summary-prompt.md`.
- **In-app help (`?` key)** — Full-screen help overlay listing all shortcuts, CLI commands, and file locations.
- **Activity filter (`f` key)** — Cycle through filter presets (configurable in `config.yaml`).
- **Git commits in viewer + report** — `◆` commit entries appear in the activity timeline. `--with-git` flag for `report`. Press `↵` on a commit to see `git show --stat`.
- **`agenthud report` formats** — `--format json` for machine-readable output, `--detail-limit N` for truncation control.
- **`hiddenProjects` config** — Hide entire projects from the tree via `h` key.
- **Cold projects collapse** — Projects where all sessions are cold collapse into a single `... N cold projects` row at the bottom.
- **Non-interactive sessions visualized** — Sessions from `claude -p` / SDK shown in parens and dimmed.
- **`CLAUDE_PROJECTS_DIR` env var** — Override the Claude projects directory.

### Changed
- **Config / state split** — `~/.agenthud/config.yaml` holds user settings; `~/.agenthud/state.yaml` holds app-managed hidden items. Auto-migrates on first run.
- **Cold sessions and projects default collapsed** — Inverse expansion: alive items default expanded (Enter collapses), cold items default collapsed (Enter expands).
- **`agenthud summary` runs from `~/.agenthud/`** — Avoids polluting user's working project with summary session files.
- **Newlines preserved in detail view** — Multi-line responses/thinking/prompts display with proper line breaks (previously flattened to single line).
- **Viewer cursor/scroll preserved on refresh** — fs.watch updates no longer reset the viewer position.
- **g/G keys swapped** — `g` = live (newest, top), `G` = oldest (bottom) — matches vim visual convention.
- **`getDisplayWidth` cached** — ~17% CPU reduction by memoizing repeated stringWidth calls.

### Fixed
- **Memory leak** — `NODE_ENV=production` by default to stop React dev-mode profiler accumulating PerformanceMeasure objects (~600KB/s leak → ~50KB/s).
- **Git access via `--git-dir`** — Only `.git` needs to be accessible (works with mounted backups).
- **Sub-agent navigation snap** — Arrow keys recover gracefully when sub-agent disappears from flat list.
- **Time displayed in local timezone** — Report and viewer use local time instead of UTC.
- **Ctrl+F no longer triggers filter** — `f` key only fires without Ctrl modifier.

## [0.8.5] - 2026-05-16

### New
- **`agenthud summary` command** — Generate LLM summary of daily activity via `claude` CLI
  - `--date YYYY-MM-DD|today` — Date to summarize
  - `--prompt TEXT` — Override default prompt
  - `--force` — Regenerate even if cached
- **Cached daily summaries** — Past dates cached at `~/.agenthud/summaries/YYYY-MM-DD.md`; today always regenerated
- **Editable prompt template** — Auto-creates `~/.agenthud/summary-prompt.md` on first run for easy customization

### Fixed
- **Git access via `--git-dir`** — No longer requires `cwd` to be the project directory; only `.git` needs to be accessible (useful for mounted/read-only setups)
- **Suppressed git stderr** — "fatal: not a git repository" messages no longer leak to terminal
- **Memory leak** — Set `NODE_ENV=production` by default to stop React dev-mode profiler accumulating `PerformanceMeasure` objects (~600KB/s leak → ~50KB/s)
- **Stabilized filter memoization** — `mergedActivities` no longer recomputes on every spinner tick
- **Sub-agent navigation snap** — Arrow keys recover gracefully when selected sub-agent disappears from flat list
- **Sentinel expansion** — Expanding `__sub-parent__` sentinel moves selection to first newly-visible sub-agent

## [0.8.4] - 2026-05-15

### New
- **Git commits in viewer** — `◆` commit entries appear in the activity timeline (session date range, refreshed every 30s)
- **Git commits in report** — `--with-git` merges commits into the timeline chronologically
- **Detail view for commits** — Press `↵` on a commit to see `git show --stat`
- **Activity filter** — Press `f` to cycle through filter presets (configurable in `~/.agenthud/config.yaml`)
- **`--detail-limit`** — Control truncation in `agenthud report` (0 = unlimited)
- **`--format json`** — JSON output with sub-agents nested under parent sessions

### Fixed
- **g/G keys swapped** — `g` now goes to live (newest), `G` goes to oldest, matching visual vim convention
- **Filter resets scroll** — Applying a filter no longer leaves the viewport pointing outside the results
- **Git date range** — Viewer fetches commits across the full session date range, not just today
- **Ctrl+F no longer triggers filter** — `f` key only fires without Ctrl
- **Sub-agent navigation snap** — Arrow keys no longer jump to first session when sub-agent disappears from flat list
- **Sentinel expansion** — Expanding `__sub-parent__` sentinel now moves selection to first newly-visible sub-agent

## [0.8.3] - 2026-05-15

### Fixed
- **Report uses local date for filtering and display** — activity times and date boundaries now match the system timezone instead of UTC

## [0.8.2] - 2026-05-15

### New
- **`agenthud report` command** - Print Markdown or JSON summary of activity for a given date
  - `--date YYYY-MM-DD|today` - Target date (default: today)
  - `--include TYPES` - Filter activity types (default: response,bash,edit,thinking)
  - `--format markdown|json` - Output format (default: markdown)
- **`CLAUDE_PROJECTS_DIR` env var** - Override the Claude projects directory for backups or mounted volumes

### Fixed
- **Layout fills screen on startup** - Viewer panel now always fills remaining height
- **Dynamic tree height** - Session tree shrinks when few sessions, giving more space to viewer
- **Error on unknown commands/flags** - `agenthud foobar` now exits with an error instead of silently starting watch mode

## [0.8.1] - 2026-05-14

### New
- **Animated LIVE badge** - Spinner replaces static ▼ in `[LIVE ⠙]`
- **Detail view colors** - Title icon/label now matches activity type colors (cyan icon, type-specific label color)

## [0.8.0] - 2026-05-14

### New
- **Detail View** - Press `↵` on any activity in the viewer to open a full-content scrollable modal (`↑↓/jk` to scroll, `↵/Esc/q` to close)
- **Thinking blocks** - Parses and displays Claude's thinking blocks (`…`) when `showThinkingSummaries: true` is set in Claude Code settings
- **Spinner** - Animated braille spinner in the status bar shows the app is live
- **Status bar moved to top** - Shortcuts and spinner now appear at the top of the screen

### Fixed
- **Layout scroll bug** - Screen no longer shifts up by one line when terminal is full
- **Viewer always fills screen** - Activity viewer now pads to full height even when content is sparse

### Changed
- **Hidden sessions format** - Config now stores `projectName/uuid` instead of bare UUID (e.g. `agenthud/569708ba-...`) for readability
- **Status bar layout** - AgentHUD name on the left, shortcuts on the right
- **Save shortcut hidden** - `s: save` removed from visible shortcuts (key still works)
- **Updated README** - Reflects current split-view UI, keyboard shortcuts, and config options

## [0.7.4] - 2025-01-23

### Fixed
- **Other Sessions Panel** - Fixed session detection and display issues
- **Session Timeout** - Improved session timeout handling
- **Test Compatibility** - Fixed test compatibility issues across platforms

## [0.7.3] - 2025-01-23

### New
- **Model Name Display** - Shows the model name in Claude panel title (e.g., `Claude [opus-4.5]`)
- **Turn Duration** - Displays last response time (e.g., `Last: 45s`)

### Fixed
- **Windows Compatibility** - Fixed path encoding for Windows file systems (replaces `:` with `@` in encoded paths)
- **Cross-platform File Operations** - Improved path handling for Windows environments

## [0.7.2] - 2025-01-22

### Improved
- **Project List Display** - Shows project paths with `~` shorthand for home directory
- **Smart Sorting** - Projects sorted by most recent modification time (newest first)
- **Project Filtering** - Filters out non-existent paths and non-development directories
- **Copy-Paste Command** - Shows ready-to-use `cd` command for quick navigation

### Fixed
- **Init Command** - `agenthud init` no longer creates `.gitignore` in non-git directories
- **Windows Compatibility** - Fixed path separator issues in session availability tests

## [0.7.1] - 2025-01-17

### Fixed
- **Graceful Node.js Version Check** - Shows helpful message when Node.js < 20 instead of cryptic library errors
- **Git Errors Suppressed** - No more "fatal: not a git repository" errors in non-git directories
- **Other Sessions Panel Layout** - Replaced ambiguous-width emojis with ASCII characters to fix layout breaking in 2-column mode
- **Windows Path Compatibility** - Fixed path separator issue in session availability tests

### Improved
- **Session Availability Check** - Shows list of projects with Claude sessions when no session exists in current directory
- **Conditional Colors** - Other Sessions panel uses cyan/yellow for non-zero counts, dim for zero

## [0.7.0] - 2025-01-17

### New
- **Responsive 2-Column Layout** - Automatically switches to 2-column layout when terminal width >= 102 columns
  - Left column: Claude + Other Sessions panels
  - Right column: Project, Git, Tests, and custom panels
  - 50:50 width ratio with 2-character gap
- **Dynamic Height Calculation** - Claude panel activities adjust based on terminal height and todo count
- **Auto Layout Detection** - No configuration needed; layout adapts to terminal size

### Fixed
- Tests panel now always shows (removed `testsDisabled` logic that hid it on error)
- ANSI escape codes stripped from activity descriptions (fixed `2m` display bug)
- Column gap alignment in wide layout mode
- Single column mode now uses full terminal width instead of fixed 70

### Changed
- `wideLayoutThreshold` config is now optional (auto-calculated as MIN_WIDTH * 2 + gap)
- `width` config is now optional (uses terminal width by default)

## [0.6.5] - 2025-01-16

### New
- **Subagent Activities** - Task entries now show their subagent's recent activities nested below with `└` prefix
- Each Task displays up to 3 most recent tool calls from its subagent
- Total activity count shown in parentheses (e.g., `Task: Explore codebase (15)`)

## [0.6.4] - 2025-01-16

### New
- **Biome Linting** - Added Biome for linting and formatting (`npm run lint`)
- **Session Time Display** - Shows session start time with elapsed duration (e.g., `17:23 (4h 32m)`)
- **M Notation for Tokens** - Large token counts shown as `24.8M tokens` instead of `24774K`

### Fixed
- Task icon `▶` breaking panel border (changed to `»` for consistent width)
- Title line width calculation using `getDisplayWidth` consistently

### Improved
- **Faster Initial Render** - Test data loads lazily after first paint
- Elapsed time >= 10h omits minutes (e.g., `20h` instead of `20h 52m`)
- All imports now use `node:` protocol

## [0.6.3] - 2025-01-16

### New
- **JUnit XML Support** - All test frameworks (vitest, jest, mocha, pytest) now output JUnit XML format for consistent parsing

### Internal
- Test folder structure reorganized to match `src/` layout
- Removed test mock patterns from production code, using `vi.mock()` instead

## [0.6.2] - 2025-01-15

### Internal
- **Auto Deploy** - npm publish and GitHub Release on tag push (`v*`)

## [0.6.1] - 2025-01-15

### New
- **Token Usage in Title** - See session token count (input + cache + output) in Claude panel title
- **Subagent Tokens** - Includes token usage from subagent sessions
- **Configurable Session Timeout** - Set `session_timeout` in config (default: 60 min)

### Fixed
- Panel countdown timers freezing at 1 second
- Data refresh stopping after first interval
- Wrong session selected when multiple sessions have same modification time
- Windows path separator issue for subagent token counting

### Internal
- **Refactored App.tsx** - Extracted reusable hooks (useCountdown, useVisualFeedback, useHotkeys, usePanelData)
- Reduced App.tsx from 750 to 487 lines (-35%)
- Added 59 new tests for extracted hooks

## [0.6.0] - 2025-01-14

### New
- **Todo Progress** - See Claude's task list updating in real-time with animated icons
- **Activity Grouping** - Repeated edits to same file shown as `Edit: file.ts (×3)`
- **Auto-detect Test Runner** - Automatically finds vitest, jest, etc.

### Improved
- Cleaner activity log with less visual noise

## [0.5.17] - 2025-01-13

### New
- **Other Sessions Panel** - See Claude sessions running in other project folders
- **Session Timer** - Know how long Claude has been working

### Improved
- Works on Windows, macOS, and Linux
- Panel width adjusts to your terminal size

### Breaking
- Requires Node.js 20+ (Node 18 no longer supported)

## [0.5.0] - 2025-01-04

### New
- **Claude Panel** - Watch Claude Code sessions in real-time
- See which files Claude is reading/writing and what commands it runs
- Token usage display

## [0.4.0] - 2025-01-02

### New
- **Custom Panels** - Add your own panels in `.agenthud/panels/`
- **Config File** - Set refresh intervals per panel

## [0.3.0] - 2024-12-31

### New
- **Git Panel** - Current branch, today's commits, lines changed
- **Test Panel** - Test results at a glance
- Watch mode for live updates

[Unreleased]: https://github.com/neochoon/agenthud/compare/v0.10.0...HEAD
[0.10.0]: https://github.com/neochoon/agenthud/compare/v0.9.4...v0.10.0
[0.9.5]: https://github.com/neochoon/agenthud/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/neochoon/agenthud/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/neochoon/agenthud/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/neochoon/agenthud/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/neochoon/agenthud/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/neochoon/agenthud/compare/v0.8.5...v0.9.0
[0.8.5]: https://github.com/neochoon/agenthud/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/neochoon/agenthud/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/neochoon/agenthud/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/neochoon/agenthud/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/neochoon/agenthud/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/neochoon/agenthud/compare/v0.7.4...v0.8.0
[0.7.4]: https://github.com/neochoon/agenthud/compare/v0.7.3...v0.7.4
[0.7.3]: https://github.com/neochoon/agenthud/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/neochoon/agenthud/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/neochoon/agenthud/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/neochoon/agenthud/compare/v0.6.5...v0.7.0
[0.6.5]: https://github.com/neochoon/agenthud/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/neochoon/agenthud/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/neochoon/agenthud/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/neochoon/agenthud/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/neochoon/agenthud/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/neochoon/agenthud/compare/v0.5.17...v0.6.0
[0.5.17]: https://github.com/neochoon/agenthud/compare/v0.5.0...v0.5.17
[0.5.0]: https://github.com/neochoon/agenthud/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/neochoon/agenthud/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/neochoon/agenthud/releases/tag/v0.3.0
