# Changelog

## [Unreleased]

### New
- **Multi-day range summary** — `agenthud summary --last 7d`, `agenthud summary --from X --to Y`. Daily summaries are cached and re-summarized into a cross-day synthesis (themes, multi-day workstreams, recurring patterns). Range output cached at `~/.agenthud/summaries/range-FROM_TO.md`. `-y/--yes` skips per-day confirmation prompts.
- **Just-in-time confirmation prompts** — Each missing daily prompts only after its scan stats are shown (sessions/activities/commits/KB), so you decide with concrete context. Enter accepts the default (`[Y/n]`).
- **Progress feedback for summary** — `scanning sessions...`, input stats, `sending to claude (this may take a minute)...`, and final `saved to` line surface during the call.
- **Token usage display** — Each summary call ends with `N in / M out · cache: A read, B written · $X.XXXX` extracted from claude's `result` event.
- **Range prompt template** — `~/.agenthud/summary-range-prompt.md` auto-created on first range run; guards against per-day timeline recap and surfacing tooling state (`cached`, `not logged in`) as content.
- **Improved daily prompt template** — Tighter section structure (Context / Key Accomplishments / Technical Insights / Major Code Changes / Open Questions), length guidance, omit-empty rule, and a hallucination guard for "Open Questions".

### Changed
- **`claude -p` called with `--no-session-persistence`** — Summary calls no longer create JSONL session files under `~/.claude/projects/`, so they don't pollute agenthud's own session tree.
- **`--date` accepts `yesterday` and `-Nd`** — In addition to `YYYY-MM-DD` and `today`.
- **Cache invalidated on failure** — A failed `claude -p` run now deletes the partial cache file so the next run doesn't replay error output.

### Removed
- **`s` save-log hotkey** — Superseded by `agenthud report` which produces the same activity dump as a one-shot CLI invocation. `logDir` config field and `~/.agenthud/logs/` directory references removed alongside.

### Fixed
- **CI also runs `tsc --noEmit`** — Catches type errors that tsup transpilation alone would ship (e.g., the `tree.sessions` regression in v0.9.0).

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

[Unreleased]: https://github.com/neochoon/agenthud/compare/v0.7.4...HEAD
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
