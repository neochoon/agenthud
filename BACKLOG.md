# Backlog

Things we've discussed or flagged but deliberately deferred. Not a
roadmap — order is rough priority / likelihood, not commitment.

Active work uses GitHub Issues + PRs. This file is for ideas that
don't yet warrant an issue, plus known internal-quality items that
surfaced during reviews.

---

## Quality / refactors

### data → ui layer violation: time constants

`src/data/sessions.ts` and `src/data/sessionLiveness.ts` import
`THIRTY_MINUTES_MS` / `ONE_HOUR_MS` from `src/ui/constants.ts`.
Flagged in the file headers of all four files. Time constants
shouldn't live in the UI layer — move them to
`src/utils/timeConstants.ts` (or onto `types/index.ts` alongside
`ICONS`).

- **Effort:** ~30 min. Pure mechanical move + update imports.
- **When:** Any quiet PR window. Doesn't gate anything.
- **Risk:** None — name-only change, no behavior shift.

### Viewer cursor: track by activity index, not screen row

`viewerCursorLine` (`src/ui/App.tsx:424`) is a screen-row index
counted from the live edge. PR #127 hacked content-anchoring on
top via a delta-bump useEffect. The cleaner long-term fix is to
track selection by activity index (mirroring `selectedId` in the
project tree) and recompute the screen position on render.

- **Effort:** ~1-2 hours. Touches every j/k/scroll handler.
- **When:** If the current bump+anchor approach starts showing
  edge cases (filter toggle while paused, e.g.).
- **Risk:** Medium — full sweep of input handlers and viewport
  math. Needs careful test coverage.

### App.tsx is under-tested (0.34× ratio)

App.tsx is 1203 LOC, tests are 405 LOC. Most other modules are
1.5–2.9× tested. The complex state machine (cold expansion,
tracking, fileChanged race, etc.) lives here and review velocity
suffers from poor coverage.

- **Effort:** Open-ended. Suggest tackling
  `appendSubAgentRows` / `flattenSessions` first (pure-ish
  helpers extractable for unit test).
- **When:** Before any major App.tsx refactor.

---

## Features

### Selection mode for mouse copy-paste

Mouse drag-to-copy fails in the TUI because the 150ms spinner +
fs.watch debounce re-renders wipe the partial selection. Workaround
today is `tmux` copy mode or `agenthud report > file.md`.

Possible fix: an `s` key that pauses *all* re-renders until pressed
again. Status bar shows `[SEL]` so it's visible. Releases on any
nav key.

- **Effort:** ~30 min. Two useState gates + status bar tweak.
- **When:** If users complain. Today's `tmux` workaround is
  adequate.
- **Open question:** Does pause-all also pause fs.watch buffering
  or let events queue? Probably let them queue and apply on resume.

### Bash output in summary report (opt-in)

PR #129 surfaces Bash stdout in the TUI detail view only. The
markdown report path (LLM summary input) deliberately skips Bash
output because typical commands are very high-volume
(`npm test`, `find /`). But for low-output Bash (`git status`,
`ls`, `whoami`) including the result might help the LLM
synthesize better.

Possible shape: `--with-bash-output` flag on `report` and
`summary`, gated by output length (skip if > N chars).

- **Effort:** ~1 hour. Flag plumbing + `formatBashBody` reuse in
  reportGenerator + length gate + tests.
- **When:** If LLM summary quality plateaus and Bash context
  proves to be the missing piece.

### Bash tail mode for long output

Current `formatBashBody` shows all of stdout. For `npm test` runs
or `find` invocations, this can be thousands of lines in the
detail view. A tail mode (show last N lines + "... (M more lines
elided)") would be more scannable.

- **Effort:** ~30 min. Optional limit param + ellipsis line.
- **When:** Pairs naturally with the opt-in summary feature
  above — same length-aware threshold.

---

## Docs

### README ↔ FEATURES.md cross-link

`README.md` still has feature summaries that duplicate FEATURES.md.
Sync them: README becomes intro + quickstart + "see FEATURES.md
for the full surface"; FEATURES.md stays the reference. Flagged
as out-of-scope in PR #120.

- **Effort:** ~20 min.
- **When:** Next doc pass.

### Auto-sync getHelp() / HelpPanel.SECTIONS / FEATURES.md

Three sources of truth for keybindings and CLI flags:
- `cli.ts:getHelp()` (`--help` output)
- `HelpPanel.tsx:SECTIONS` (`?` overlay)
- `FEATURES.md` (web/repo reference)

Today these are manually kept in sync. Possible: a build-time
script that extracts the structured data and renders the others.
But this is premature for a project this size — flagged
out-of-scope in PR #120.

- **Effort:** ~2-3 hours for a robust generator.
- **When:** If/when FEATURES.md drifts again within a release cycle.

---

## Closed (for reference)

These were discussed and decided against — kept here briefly so the
decisions don't get re-litigated:

- **`o` key to open file in detail view** — declined 2026-06-09.
  Reasons: detail view is "inspection mode" not "actor", race
  with concurrent Claude edits, default-app association is
  fragile across platforms (especially WSL).
- **Separate test catalog doc** — replaced by FEATURES.md rewrite
  (PR #120). The `vitest list` output is the canonical spec.
- **Architecture audit doc** — discussed but not produced. File
  headers (PRs #121-#125) cover the per-module rationale; if a
  cross-cutting view is needed later, the headers are the
  starting material.
