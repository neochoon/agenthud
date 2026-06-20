# Backlog

Things we've discussed or flagged but deliberately deferred. Not a
roadmap — order is rough priority / likelihood, not commitment.

Active work uses GitHub Issues + PRs. This file is for ideas that
don't yet warrant an issue, plus known internal-quality items that
surfaced during reviews.

---

## Quality / refactors

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

## Distribution / discoverability

npm + GitHub metadata SEO was done in v0.13.2 (#132) plus the
direct `gh repo edit` for description / homepage / 20 topics.
Remaining levers are external — they need outbound work, not
just metadata tweaks.

### Submit to `awesome-claude-code` (and similar curated lists)

Direct backlinks + traffic from people specifically browsing
"things to use with Claude Code". Highest expected ROI for the
effort.

- **Effort:** ~30 min. Fork the awesome-list repo, add an entry
  in the right section, open PR. Each list has its own format
  rules — read CONTRIBUTING first.
- **Candidates:**
  - [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)
    (or whoever the current canonical maintainer is — check
    GitHub topic `awesome-claude-code`)
  - [steipete/awesome-claude-cli](https://github.com/steipete/awesome-claude-cli)
    if it exists at submission time
  - Generic `awesome-cli-apps` for the TUI/CLI angle
- **When:** Any time. Sooner = compound effect from more
  inbound traffic.

### GitHub social preview image

Repo's "About" sidebar and any social share (HN, Reddit, X
links) currently show GitHub's default placeholder. A custom
1280×640 PNG with the agenthud TUI screenshot + one-line
tagline lifts click-through from share posts substantially.

- **Effort:** ~1 hour. Design (Figma or even Apple's Keynote
  works), upload via repo Settings → Social preview. Iterate
  if it looks bad small.
- **When:** Before any external promotion push (HN launch,
  etc.). After is too late — first impression set by the
  default placeholder.

### External promotion: HackerNews, Reddit, X

Stars + downloads compound into search ranking over months,
but the first hundred users come from outbound posts. Plan
once metadata, social preview, and a polished README are all in
place (we have those now).

- **Channels:**
  - HN "Show HN" post — single shot, do it right
  - r/ClaudeAI, r/Anthropic, r/commandline subreddits
  - X / Mastodon developer-tools accounts
- **Don't until:** all the inbound landing surfaces are polished.
  npm page is the most-clicked destination from these posts;
  CHANGELOG and FEATURES.md are the second click.
- **Effort:** Half a day to write the HN post well + monitor +
  respond. The actual posting is 5 minutes; the prep is most of
  it.

---

## Closed (for reference)

These were discussed and decided against — kept here briefly so the
decisions don't get re-litigated:

- **data → ui layer violation: time constants** — done 2026-06-20
  (#192). The four time constants moved from `ui/constants.ts` to
  `src/utils/timeConstants.ts`; the six data-layer importers repointed.
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
- **README ↔ FEATURES.md cross-link** — done in PR #131 (v0.13.2).
  README slimmed to 94 lines, links to FEATURES.md as the
  reference.
- **npm + GitHub search metadata** — done in PR #132 (v0.13.2)
  plus repo description / homepage / 20 topics set via
  `gh repo edit`. Effect surfaces on next npm crawl (~24h).
