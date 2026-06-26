# AgentHUD — Major Feature History

A curated, highest-level timeline of the **headline features** in each minor
version — the arc of how AgentHUD grew from a git/test HUD into a multi-agent
live monitor. For the complete per-release record (every fix, change, and
patch) see [CHANGELOG.md](./CHANGELOG.md); for the current feature reference
see [FEATURES.md](./FEATURES.md).

## Unreleased (post-0.19.0)

- **agenthud follow**: live merged event stream (activity + state + lifecycle)
  across all sessions and sub-agents, as human-readable lines or NDJSON
  (`--json`); `--since`, `--include`, and `--once` for backfill control — the
  machine-readable substrate for supervisors and scripts.
- **Persistent in-pane search (`/`)**: text search scoped to the focused pane
  (Tree / Viewer / Detail). The list search bar stays open after Enter and
  survives Viewer → Detail → back round-trips, with navigate-to-activity vs
  filter-confirm behaviour; composes (AND) with the `f` type-filter.
- **Tree UX**: scroll within a tall live project instead of freezing at the
  top; sub-agents use a 5-minute hot window (was 30 min); collapse a revealed
  session from its child via `←` / Enter; only running sub-agents shown
  individually, finished (warm) ones grouped under the summary.

## 0.19 — 2026-06-17

- **opencode provider**: reads opencode's SQLite database read-only (Node 22+),
  surfacing sessions, sub-agents, model, context gauge, and the full activity
  timeline alongside the other providers.
- **Sticky live projects**: active projects stay pinned at the top of the
  Projects panel so the live monitor never scrolls running work out of view.

## 0.18 — 2026-06-12 → 06-16

- **Pluggable summary engine** (`--engine claude|codex|kiro|auto`): `agenthud
  summary` is no longer hard-wired to Claude; Codex CLI and Kiro CLI are
  first-class alternatives, auto-detected by installed CLI.
- (0.18.5–0.18.8: memory and freeze fixes for giant sessions — no new features.)

## 0.17 — 2026-06-12

- **OpenAI Codex CLI as a fourth provider**: reads `~/.codex/sessions/`, groups
  by cwd, nests sub-agents via `parent_thread_id`, shows a `codex` label + gauge.
- **Repositioned as a multi-agent monitor**: the same project worked across
  Claude Code, Codex CLI, Kiro CLI, and Kiro IDE merges into one tree row.
- **Major performance overhaul**: discovery cached by (path, mtime); the viewer
  no longer re-parses unchanged files; growing JSONL parses only the appended
  tail (~150 ms → ~12 ms on a 25 MB session).

## 0.16 — 2026-06-12

- **Kiro IDE sessions**: reads the IDE's VSCode-fork storage, groups by
  workspace, nests IDE sub-agents (from `invokeSubAgent` logs), shows
  `[waiting]` for IDE approval gates.
- **Provider abstraction**: Claude, Kiro CLI, and Kiro IDE are independent
  providers merged into one tree via a `SessionProvider` interface.

## 0.15 — 2026-06-12

- **Kiro CLI as a second provider**: reads `~/.kiro/sessions/cli/`, merges with
  Claude into one project tree, shows a `kiro` label.
- **Context-window usage gauge**: colored `NN%` on every session row
  (green/yellow/red), from Kiro's sidecar or inferred from Claude usage fields.
- **Canonical tool labels across providers**: raw provider tool names map to
  Claude-style labels at the parser boundary so filters/viewer stay uniform.

## 0.14 — 2026-06-11

- **Tree-wide census in the Projects title**: total + visible-active counts at
  every level (projects, sessions, sub-agents, hidden).
- **Show-hidden toggle (`a`) + unhide (`H`)**: full hide → reveal → unhide
  cycle inside the TUI without editing `state.yaml`.
- **Cold sessions collapse to a `... N cold` sentinel** (Enter to expand).

## 0.13 — 2026-06-08 → 06-10

- **`task` activity type, default-on**: Task delegations and their sub-agent
  results show in `report`/`summary` — delegated work is no longer invisible.
- **Bash stdout/stderr in the Detail View** (Enter on a Bash row).

## 0.12 — 2026-06-07

- **Config-driven defaults for `report`/`summary`** (`report:` / `summary:`
  sections in `config.yaml`; summary inherits report keys).
- **`summary --open` + auto-managed `index.md` hub** linking every daily and
  range summary with navigation backlinks.
- **`←` jump-to-parent** in the tree: sub-agent → session → project.

## 0.11 — 2026-06-04 → 06-05

- **`--cwd` flag**: scope the watch view to the project containing the current
  directory.
- **Read content in the Detail View**: Enter on a `Read` activity shows the
  file content with line numbers and syntax coloring.

## 0.10 — 2026-05-25

- **Session liveness badges** (`[working]` / `[waiting]`): derived from JSONL
  tail structure, not just mtime.
- **Rich tool activity details**: Edit line range + `+/-` counts and full
  unified diff on Enter; Write content; structured TaskUpdate/TaskCreate.

## 0.9 — 2026-05-17 → 05-21

- **Project-grouped session tree** (sessions nest under their project; cold
  projects collapse).
- **`agenthud summary`**: LLM daily digest via `claude -p`, cached, editable
  prompt, multi-day ranges (`--last Nd`, `--from`/`--to`).
- **`agenthud report`**: Markdown/JSON activity dump with `--include`,
  `--with-git`, `--detail-limit`, `--format`.
- **Tracking mode (`t`)**: auto-follow the newest live sub-agent across the tree.
- Alternate screen buffer, min-size guard, scrollable help (`?`), tail-feed
  viewer.

## 0.8 — 2026-05-14 → 05-16

- **Detail View** (Enter on any activity → full scrollable content).
- **Thinking blocks** parsed and displayed.
- **Git commits** in the viewer + `--with-git` for `report`.
- **Activity type filter (`f`)** cycling configurable presets.

## 0.7 — 2025-01-17 → 01-23

- **Responsive 2-column layout** (side-by-side at ≥ 102 cols).
- **Other Sessions panel** surfaced prominently.

## 0.6 — 2025-01-14 → 01-16

- **Live todo/task progress** with animated icons.
- **Sub-agent activity nesting** under Task entries.
- **Token usage** in the panel title.

## 0.5 — 2025-01-04 → 01-13

- **Claude Panel**: live view of the active session (files read/written,
  commands, tokens).
- **Other Sessions panel** (sessions from other project folders).

## 0.4 — 2025-01-02

- **Custom panels** backed by your own shell scripts in `.agenthud/panels/`.

## 0.3 — 2024-12-31

- **Git panel + Test panel**: branch, today's commits, lines changed, test
  results — the original HUD, with watch mode for live updates.
