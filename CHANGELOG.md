# Changelog

## [Unreleased]

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
