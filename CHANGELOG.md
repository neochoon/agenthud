# Changelog

## [Unreleased]

## [0.18.6] - 2026-06-15

### Fixed
- **Giant-session freeze.** The live viewer fully read and parsed the
  selected session; with today's large sessions (100MB+) that spiked
  ~700MB RSS on selection and froze the TUI (unresponsive to Ctrl+C/q).
  It now loads only a recent window (the last 8MB, snapped to a turn
  boundary) of a session file — bounded memory regardless of file size
  (104MB session: ~700MB → 40MB transient, ~200MB → 17MB retained). Full
  history is unchanged in `report` / `summary`; the viewer's scrollback
  is bounded to the recent window. Completes the v0.18.5 cache fix, which
  only addressed multi-session accumulation.

## [0.18.5] - 2026-06-15

### Fixed
- **Long-run freeze / memory bloat in the live viewer.** Leaving the TUI
  open for hours with a busy session selected grew it to hundreds of MB
  of RSS and eventually froze it — unresponsive to Ctrl+C / q. The
  per-session history cache was unbounded (it kept the full parsed
  activity array of every session ever selected) and returned a fresh
  array on every cache hit, so the viewer re-rendered on every 2s
  refresh even when nothing changed. The cache is now LRU-bounded and
  returns a stable reference on a hit, so memory stays flat and an
  unchanged refresh does no work.

## [0.18.4] - 2026-06-15

### Fixed
- **Finished sub-agents no longer show `[waiting]`.** A sub-agent that
  produced its result and terminated ended its tail with a text-only
  turn, which the liveness classifier read as "waiting" — a verdict that
  only makes sense for an interactive top-level session. Sub-agents are
  one-shot, so a yielded turn now reads as done (the time-based badge),
  while a pending tool call still reads as `[working]`.
- **The tree selection no longer vanishes.** When the selected session
  cooled and folded under the `... N cold` row it dropped out of the
  nav list, leaving "No session selected" and silent `j`/`k`. The cursor
  now snaps to the nearest visible ancestor (sub-agent → session →
  project) whenever its row disappears, so navigation never freezes.

## [0.18.3] - 2026-06-13

### Fixed
- **`summary` now reports the file path at the end of its output.** On a
  cache hit the path was printed before the content, so a long summary
  scrolled it off the top. It now prints last, with wording that says
  whether the file was freshly written (`summary written to <path>`) or
  served from cache (`summary read from cache: <path>`) — no more
  ambiguous "saved to" on a read.

### Changed
- **Docs:** README repositioned around the three layers (live HUD /
  daily digest / machine report), supported agents named up front, and
  the demo GIF re-recorded as a three-layer walkthrough.

## [0.18.2] - 2026-06-13

### Fixed
- **No more `--trust-tools` warning on Kiro summaries.** `kiro-cli`
  documents `--trust-tools=` as "trust no tools" (the guard that keeps a
  headless summary run from silently executing filesystem/shell tools)
  but then warns that the empty value looks like a custom MCP tool. That
  benign stderr line is now stripped from the passed-through output while
  real diagnostics still surface.

### Changed
- **CI actions moved off the deprecated Node 20 runtime.**
  `actions/checkout` v4→v6, `actions/setup-node` v4→v6, and
  `softprops/action-gh-release` v2→v3 — all now on Node 24, ahead of
  GitHub forcing the switch on 2026-06-16. No user-facing change.

## [0.18.1] - 2026-06-12

### Fixed
- **Kiro summary engine now actually summarizes.** `summary --engine
  kiro` previously fed the activity report to `kiro-cli` on stdin while
  passing the prompt as a positional argument — but Kiro reads stdin
  only when no positional question is given, so it ignored the report
  and replied that the log was empty. The prompt and report are now
  combined onto stdin (no positional), so the model sees both. Claude
  and Codex are unaffected.
- **No more EPIPE crash when an engine closes stdin early.** Writing the
  large report to a child that had already closed its input surfaced as
  an unhandled `EPIPE` error and aborted the process; the stdin pipe now
  has an error handler, so the run degrades gracefully.

## [0.18.0] - 2026-06-12

### Added
- **Pluggable summary engine.** `agenthud summary` is no longer hard-wired
  to `claude` — it can now run through Claude Code, OpenAI Codex CLI, or
  Kiro CLI. Pick one per run with `--engine <claude|codex|kiro|auto>`, or
  set a default with `summary.engine` in `~/.agenthud/config.yaml`. The
  default is `auto`, which detects the first installed CLI in
  claude → codex → kiro order. This lets Codex- or Kiro-only users
  generate summaries without installing Claude.

### Changed
- **Summary cache is now keyed by engine and model, not just date.** Each
  cached daily/range summary records which (engine, model) produced it via
  an inert HTML-comment marker; switching the engine or model regenerates
  the summary instead of serving the previous engine's stale text. Caches
  written before this release are treated as Claude output and reused for
  Claude requests, so existing summaries are not needlessly regenerated on
  upgrade.

## [0.17.0] - 2026-06-12

### Added
- **OpenAI Codex CLI as a fourth session provider.** Reads
  `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (override
  `CODEX_SESSIONS_DIR`). Sessions group by `cwd`, show the model
  (`turn_context.model`), a context-window gauge (taken directly
  from the `token_count` event — no inference), and a cyan `codex`
  provider label. Sub-agents are separate rollout files linked by
  `parent_thread_id` and nest under their parent; older
  (`source: { subagent: "<role>" }`, no parent link) sub-agents
  surface at top level instead of being dropped.
- **Per-agent session-file schemas** for all four providers under
  `docs/schemas/` (Claude, Kiro CLI, Kiro IDE, Codex), each with
  the `jq` commands used to derive it.

### Changed
- **Repositioned as a multi-agent monitor.** README, npm
  description/keywords, and FEATURES now cover Claude Code + Codex
  CLI + Kiro IDE + Kiro CLI rather than Claude-only. The same
  project worked from multiple agents merges into one tree row.
- **Consistent session-row titles across providers.** Every
  provider now shows the latest substantial user message (skipping
  slash commands), matching Claude. Previously Codex/Kiro CLI
  showed the first prompt and Kiro IDE showed an auto-generated
  label (`"Clean State"`) the user never typed.
- **Cool sessions render dim.** The active count is hot + warm, but
  cool sessions used to render bright like active ones — visually
  contradicting the count. Cool now dims (still expanded/visible,
  unlike collapsed cold); only hot/warm render bright.

### Performance
- **Discovery is cached per file by (path, mtime).** The Claude
  provider re-read every session + sub-agent file's tail on each
  ~2 s poll; with hundreds of mostly-cold files this was ~1.4 s and
  blocked navigation. Cold files now read once — warm discovery
  ~1450 ms → ~6 ms.
- **The activity viewer no longer re-parses unchanged files.**
  Parsed history is cached by (path, mtime), so reading or
  navigating a stable session costs nothing.
- **Growing JSONL parses only the appended tail.** When a session
  file grows, agenthud re-parses just the new bytes (bounded-tail,
  with the seam aligned to a turn boundary so nothing cross-line
  straddles it) instead of the whole file. On a 25 MB session a new
  response went from ~150 ms to ~12 ms, and stays bounded as the
  session keeps growing. Kiro IDE (single JSON document) still
  parses whole, gated by mtime.

## [0.16.0] - 2026-06-12

### Added
- **Kiro IDE sessions appear alongside Claude Code and Kiro CLI.**
  Reads the IDE's VSCode-fork storage
  (`<app-storage>/Kiro/User/globalStorage/kiro.kiroagent/`,
  override: `KIRO_IDE_SESSIONS_DIR`). Sessions group by
  `workspaceDirectory`, the `title` becomes the row description,
  `selectedModel` the model, and `contextUsagePercentage` the
  context gauge. Rows carry a magenta `kiro-ide` provider label.
- **Kiro IDE sub-agents nest under their parent.** Unlike the CLI,
  IDE sub-agents live as `invokeSubAgent` actions inside the
  parent's execution log (tagged `subExecutionId`), not as
  separate files. agenthud parses those execution documents,
  surfaces each sub-agent as a tree row, and renders its tool
  stream (`runCommand` → Bash, `readFiles` → Read, etc.) in the
  activity viewer.
- **`waiting` badge for IDE approval gates.** A sub-agent parked on
  a `PendingAction` (the IDE's run-command approval prompt) shows
  `[waiting]` — answering the "is it even running?" question
  directly.
- **`AGENTHUD_HOME` env override** for the app data directory
  (`~/.agenthud`), mirroring `CLAUDE_PROJECTS_DIR` /
  `KIRO_SESSIONS_DIR`. Used for test isolation and mounted/synced
  setups.

### Changed
- **Live badges are recency-gated across all providers.** A `.lock`
  file (Kiro CLI) or a `running` execution (Kiro IDE) only drives a
  `[working]`/`[waiting]` badge when the session was touched in the
  last 30 minutes — the same rule Claude already used. A terminal
  left open for hours now falls back to the time-based
  `[cool]`/`[cold]` badge instead of looking perpetually active.
- **Session-row description shows the latest user message of any
  length.** The previous 10-character minimum dropped short
  follow-ups ("ok", "go", "yes") in favor of a stale older
  message; now the literal latest non-slash-command message wins.

### Fixed
- **`agenthud report` truncated piped output.** `process.exit(0)`
  fired before the async stdout pipe drained, silently cutting
  ~40% of a long report (`| grep`/`| less` lost trailing session
  blocks while a file redirect kept everything). All exits after a
  stdout write now flush first.
- **Kiro IDE sessions were missing from reports** — history
  entries carried no timestamps, so the same-day filter dropped
  them. Activities now inherit the session file's mtime.
- **macOS/Windows watch mode never refreshed on non-Claude
  activity.** Polling was Linux-only; `fs.watch` only covers the
  Claude projects dir, so Kiro CLI/IDE changes never triggered an
  update. Polling is now always primary on every platform.
- **`KIRO_SESSIONS_DIR` overrides routed to the wrong parser.**
  Activity from an overridden Kiro root was parsed as Claude JSONL
  (and came back empty). Routing now prefix-matches each provider's
  actual configured root.
- **`summary --last Nd --force` rebuilt ranges from stale daily
  caches.** `--force` now regenerates the per-day summaries too.
- **`--with-git` duplicated commits** once per session of the same
  project; commits are now fetched once per project.
- **`--date 2026-02-31` was accepted** (JS silently normalized it
  to Mar 3); impossible dates are now rejected.
- **`--help` / `--version` / `-V` created `~/.agenthud/config.yaml`**
  as a side effect; read-only commands now short-circuit before
  loading config.
- **Summary cache could be left partial on a crash.** Output now
  streams to a temp file and renames into place on success.
- **`task` activity type was inconsistent** between the default
  include set, `--include all`, and the generated config template —
  all three now agree, so first-run and later-run payloads match.
- **Multi-provider project order depended on provider registration
  order**; merged trees are now re-sorted by status/mtime.

### Internal
- Provider abstraction (`src/data/providers/`) with `SessionProvider`
  interface; Claude / Kiro CLI / Kiro IDE are independent providers
  merged into one tree.
- Per-provider session-file schemas under `docs/schemas/`.
- CI gained a lint gate; the publish workflow now refuses tags
  whose commit is not an ancestor of `main`.
- `@types/node` pinned to the lowest supported runtime (^20);
  publish builds on Node 20.

## [0.15.0] - 2026-06-12

### Added
- **Kiro CLI sessions appear alongside Claude Code.** agenthud now
  reads `~/.kiro/sessions/cli/` (override: `KIRO_SESSIONS_DIR`) as
  a second session source. Both providers merge into one tree —
  the same project worked from both CLIs renders as a single row
  with combined counts. Discovery uses Kiro's `.json` sidecar
  (`cwd` for grouping, `title` as the row description,
  `parent_session_id` for sub-agent nesting) and the `.lock` file
  as the liveness signal. The Kiro JSONL record format
  (`Prompt` / `AssistantMessage` / `ToolResults`) is parsed into
  the same activity stream the viewer, report, and summary
  consume.
- **Provider label on session rows.** Top-level sessions show
  which CLI created them — `claude` (yellow) or `kiro`
  (magenta) — between elapsed time and model name.
- **Context-window usage gauge on session rows.** A colored `NN%`
  (green < 60%, yellow 60–85%, red ≥ 85%) shows how full each
  session's context is. Kiro reports the percentage directly in
  its sidecar; Claude derives it from the last assistant turn's
  usage fields with an adaptive window inference (usage > 200K ⇒
  the session must be on the 1M long-context window). Verified
  against `/context` output.
- **Report headers carry provenance.** Markdown session blocks
  now read `## project (start – end) · provider · model`; the
  JSON format gains `provider` and `model` keys per session. The
  summary LLM sees the provenance for free.
- **Canonical tool labels across providers.** Kiro's raw tool
  names (`shell`, `subagent`, `introspect`, `web_fetch`) map to
  the Claude-style canonical taxonomy (`Bash`, `Task`, `Read`,
  `WebFetch`) at the parser boundary, so report include-filters
  and the activity viewer treat both providers uniformly.
  Unknown names pass through visibly instead of being mislabeled.
- **Per-provider session-file schema docs** at `docs/schemas/`
  (claude-session.md, kiro-session.md), each ending with the jq
  commands used to derive the field inventory — re-run them to
  falsify the doc against your own sessions.

### Changed
- **Census is now the single source of truth for per-project
  counts.** `computeCensus` builds a per-project map in the same
  walk as the tree-wide totals and ProjectRow reads from it, so
  the panel title and row counts can no longer disagree.
- **Fable/Mythos model ids shorten like other families**
  (`claude-fable-5` → `fable-5`).

### Fixed
- **Windows: Kiro session history routed to the wrong parser.**
  The path check hardcoded `/` separators; backslash paths now
  normalize first.

## [0.14.1] - 2026-06-12

### Changed
- **ProjectRow name renders dim when no session or sub-agent is
  active.** Previously every non-hidden project name was bold
  bright white regardless of activity, so a tree full of
  cool/cold projects with one genuinely hot one all looked
  equally "alive" at a glance. New rule: bold + bright only when
  `isProjectAlive(project)` — at least one session or sub-agent
  is hot or warm. Otherwise dim, non-bold. Hidden projects still
  dim with `⊘`; selection background still wins.

## [0.14.0] - 2026-06-11

### Changed (BREAKING)
- **Hide moved from `h` to `Shift+H`. Lowercase `h` is now the
  vim-left alias for `←` (jump to parent).** The old binding
  (`h` = hide) was a footgun: vim users coming for navigation
  hit `h` and silently hid whichever item was selected. The
  user wouldn't even remember pressing it. Capital `H` keeps the
  mutation behind a deliberate keystroke.

### Added
- **Tree-wide census in the Projects panel title.** Each level
  shows total + visible-active count:
  `12p (3) · 68 sessions (5) · 142 sub-agents (2) · ⊘ 14 hidden (1)`.
  The `(N)` parentheticals are green so the eye lands on the
  actionable count. The hidden `(M)` is yellow — the alert for
  content you can't see. Narrow terminals fall back to short
  form (`68s (5)`, `142a (2)`), then drop segments from the
  right; the hidden alert is the last thing to go.
- **`a` key toggles "show hidden items" in the tree.** Hidden
  projects and sessions render dim with a `⊘` marker so they're
  recognizable at a glance. Combined with the `H` change below,
  a full hide → toggle → unhide cycle now lives inside the TUI —
  no more state.yaml editing to recover an accidentally-hidden
  item.
- **`H` is now a toggle, not just hide.** Pressing `H` on a
  visible item hides it (same as before); pressing it on a
  hidden item unhides it. Combine with `a` to reveal hidden
  items in the tree, navigate to the one you want, and toggle
  with `H`.
- **Per-project session + sub-agent counts on the project row.**
  `> myproj  ~/path   5 sessions (2) · 142 sub-agents (3)   3m`.
  Totals are dim; active subset `(N)` is mid-tone green
  (non-bold, softer than the panel-title census so it doesn't
  compete with the row's own `[hot]`/`[warm]` badge). Width-
  aware: short form `5s (2) · 142a (3)`, dropped entirely on
  very narrow terminals.
- **Status bar surfaces hidden-but-still-active items.** A hidden
  session producing live activity used to be completely
  invisible — combined with the `h` footgun above, that broke
  discovery in a way that took a `state.yaml` edit to recover.
  Now the title bar shows the count: ` · ⊘ N hidden` (dim) or
  ` · ⊘ M active in N hidden` (yellow `M`) when something hot
  or warm is hidden.
- **Cold sessions under active projects collapse to a
  `... N cold` sentinel.** Active projects often hold a long
  tail of historical cold sessions that bury the live work;
  pressing `↵` on the sentinel reveals them.

### Changed (layout)
- **Census moved to the Projects panel title bar; branding +
  keybindings moved to a single bottom row.** The top status
  bar was wasted space (just "AgentHUD vX · ⊘ N hidden …"
  floating above the panels) and the Projects title was equally
  wasted (just "Projects"). Both fixed: census now sits where
  it belongs — directly above the tree it describes — and the
  bottom row carries the brand + keys.
- **Session row description = latest substantial user request.**
  Was: first natural-language user prompt (often stale by hour
  3 of a long session). Now: the most recent user message that
  is ≥ 10 chars and doesn't start with `/` (so trivial
  follow-ups like "ok", "go", "yes" and slash commands like
  `/compact`, `/clear` are skipped). Falls back to first prompt
  when no later message qualifies.
- **`t` (toggle tracking) now requires tree focus.** It moves
  the tree cursor — accidentally pressing it while reading the
  viewer used to yank focus away. The `TRK ●` indicator still
  appears on both tree and viewer banners while the mode is on.
- **`t: track` and `r: refresh` hints dropped from the status
  bar.** Tracking is a niche mode; refresh is automatic via the
  2s poll + fs.watch. Both keys still work and are documented
  in the `?` help.

### Fixed
- **Hidden sub-agents are now MARKED, not filtered, in the data
  layer.** Previously hidden sub-agents were silently dropped
  before the tree was built, so the panel-title census
  undercounted sub-agent totals, the yellow hidden-active alarm
  was silent for them, and the `a` (show hidden) + `H` (unhide)
  round-trip couldn't reach them at all. Now they ride along
  with `hidden: true` and the show-hidden/unhide flow works
  end-to-end.
- **`H` no longer teleports selection when `showHidden` is on.**
  In show-hidden mode the row stays rendered (dimmed with `⊘`)
  after hiding, so jumping selection away made no sense — the
  user just acted on that row and expects to remain on it. Now
  selection only advances when the row is about to disappear
  (`showHidden` off).
- **Cold session rows render dim instead of bold-bright.** The
  cold IDs used to compete visually with the active rows in the
  same project.

## [0.13.3] - 2026-06-10

### Changed
- **README install section split into "Try without installing" /
  "Install for daily use", each showing both `npm` and `bun`.**
  The previous structure mixed an `npx agenthud` install hint with
  bare `agenthud …` Quickstart commands — copy-paste failed for
  anyone who took the trial path. Two clearly-labeled H2 sections
  now exist side-by-side; the Quickstart still targets the
  daily-use form, and `bun` users are first-class instead of
  "check the docs". Doc-only; no behavior changes.

## [0.13.2] - 2026-06-09

### Changed
- **Package description and keywords optimized for npm search
  ranking.** Description rewritten to compress every realistic
  search query — "Claude Code", "TUI", "dashboard", "live
  monitor", "parallel sessions", "sub-agents", "LLM", "digest" —
  into one natural sentence without keyword-stuffing reading.
  Keywords expanded from 7 to 26 across the Claude/Anthropic /
  agent / TUI / observability / session-monitor / LLM-summary
  clusters, with phrase keywords like `claude-code-tui` and
  `claude-code-cli` for multi-word query matches. Pure metadata
  change, no code or behavior shift; surfaces in npm's search
  index on next crawl.

## [0.13.1] - 2026-06-09

### Added
- **Bash stdout / stderr in TUI detail view.** Pressing `↵` on a
  Bash row now shows the command's stdout and stderr (with a
  `--- stderr ---` divider when both are present), plus an
  `[interrupted]` marker for user-cancelled commands. Previously
  only the one-line command label was visible. TUI-only — Bash
  output stays out of the `report` / `summary` markdown payload
  so the LLM input doesn't balloon on `npm test`-style runs.

### Fixed
- **Activity viewer cursor stayed at the same screen row when new
  entries arrived in LIVE mode, silently sliding the highlight to
  a newer activity.** Now the cursor anchors to its activity:
  walks up the screen as new entries push the live edge forward,
  and when it would scroll off the top, auto-pauses and freezes
  the view on the same snapshot (so `[PAUSED ↑N +M↓]` reflects
  exactly where you are and how many you've missed). Per-render
  scroll bump moved from `refresh` into a centralized useEffect
  on `mergedActivities.length` so it fires regardless of which
  code path updates activities.

### Docs
- **FEATURES.md rewritten from scratch for v0.13.0.** The
  original was last touched in early January 2026 and every H2
  section referenced code that no longer exists. Replaced with a
  feature-centric reference matching what ships today: overview
  matrix at the top, one H2 per user-facing feature, plus
  cross-cutting sections for keybindings, files, and env vars.
  954 lines → 451.
- **README slimmed to a landing page; FEATURES.md is the
  reference.** 314 lines → 94. README keeps the pitch, install,
  platform note, quickstart, ASCII screenshot, and brief config
  overview; everything else links to FEATURES.md anchors.
- **File-header convention applied across all 31 source files**
  (purpose / design decisions / gotchas). Convention itself
  documented in global `~/.claude/CLAUDE.md`. Documents
  non-obvious decisions in place so future-me / others don't
  re-litigate them.
- **`BACKLOG.md`** for items flagged or discussed but deliberately
  deferred. Issues stay for actionable work; the file is for the
  "noted but parked" pile.
- **Daily summary prompt refined.** Explicit icon legend so the
  LLM doesn't have to guess `○ ~ $ * @ » < > … ◆`, multi-project
  awareness, first-person retro voice, light-day fallback to a
  short paragraph instead of padding empty sections, sharper "do
  NOT" list.

## [0.13.0] - 2026-06-08

### Added
- **`task` activity type, default-on.** Task tool delegations to
  subagents are now visible in `report` and `summary` output. The
  subagent's returned text is surfaced as a `<task-result>…</task-result>`
  XML block below the row, so the LLM summary pipeline can see what the
  subagent actually did instead of only the parent's task description.
  Previously Task activities were filtered out of every report — work
  delegated to subagents was invisible to the daily summary. Use
  `--include` (e.g. `--include user,response,bash,edit`) to opt out
  per-invocation, or omit `task` from `report.include` in
  `~/.agenthud/config.yaml` to opt out by default. The XML tag form
  matches the range meta-input change below — content can't forge
  the delimiter.

### Changed
- **Range summary input format: XML-tag delimited.** Each daily summary
  is now wrapped in `<day date="YYYY-MM-DD">…</day>` instead of a
  `# YYYY-MM-DD` heading + `---` separator. Two reasons: (1) the date
  travels as a structured attribute so the LLM can't conflate it with
  date headings *inside* a summary; (2) the `---` separator collided
  with markdown horizontal rules and yaml frontmatter that a daily
  summary might legitimately contain. The bundled
  `src/templates/summary-range-prompt.md` was updated to match. **If
  you have a customized `~/.agenthud/summary-range-prompt.md`,
  agenthud will keep using yours unchanged** — sync your edits against
  the new template if you want the XML-aware instructions, or delete
  the file and agenthud will regenerate it on next run.

## [0.12.4] - 2026-06-08

### Fixed
- **Don't propose deleting the Windows-side global config when
  running from WSL.** From inside WSL, `homedir()` returns the
  Linux home (`/home/<X>`), but the user's effective cwd is often
  `/mnt/c/Users/<Y>` — the Windows-side home. The legacy-config
  migration prompt's "this is a project-level config" check only
  bailed when `cwd === home` literally, so on WSL it incorrectly
  offered to delete the Windows-native `.agenthud/config.yaml` —
  potential data loss. The check now also recognises
  `/mnt/<drive>/Users/<name>` as a user home **only when running
  inside WSL**, where `homedir()` is known to lie. Native
  Linux/macOS/Windows behavior is unchanged.
- **Internal: `isWSL()` moved to `src/utils/platform.ts`** so both
  `openInDefaultApp` and `legacyConfig` share one detector (env
  var + `/proc/version` markers, cached for the process).

## [0.12.3] - 2026-06-08

### Fixed
- **`summary` no longer writes a stub file on empty days.** v0.12.2
  added "skip claude on empty input" but compromised it by writing
  a `## Context\n\nNo activity recorded …` stub into
  `~/.agenthud/summaries/YYYY-MM-DD.md` every time — opposite of the
  "don't waste anything on nothing" intent. Now matches the range
  path: announce, return success, touch no disk.
- **`summary --open-index` / `-I` now works on empty days.** The
  flag is for navigating the past-summaries hub, so it shouldn't be
  gated by whether *today* produced a new file. `runSummary` now
  fires `regenerateIndex` and `openInDefaultApp(index.md)` whenever
  `-I` is set, independent of the daily result.
- **`summary --last Nd` on an all-empty range returns exit 0.** The
  whole rest of the codebase treats "no activity" as a normal state
  (`report`, daily summary). Range mode was returning 1 — fixed.
  The empty-range branch also honors `-I` now.
- **Clearer skip message in range mode.** Previously printed
  `<label> — skipped by user` even when claude was never asked
  (because the day was empty). Replaced with a neutral
  `<label> — skipped` since the two cases are indistinguishable at
  the result-shape level.

### Added
- **POSIX-style short-flag clusters.** `agenthud summary -oI` now
  parses as `-o -I`; `-yo` as `-y -o`; etc. The expander only
  triggers on `-` + two-or-more letters, so the documented `-Nd`
  date short-form (`--date -1d`) is left intact.

### Upgrade notes
- Empty-day stub files left over from v0.12.2 are not auto-deleted
  — `rm ~/.agenthud/summaries/<empty-date>.md` to clean them up.
  Future empty days will not create new files.

## [0.12.2] - 2026-06-07

### Fixed
- **`--open` no longer fails silently on WSL.** Spawning the OS
  opener with `stdio: "ignore"` + immediate `process.exit()` meant
  the user never saw the spawn error when `xdg-open` was missing
  (typical on a headless WSL) or exited non-zero. `openInDefaultApp`
  now (1) sync-checks the command is on PATH, (2) prefers `wslview`
  when WSL is detected and the binary is installed, (3) waits up to
  200ms for the spawned child to fail fast and surfaces both `error`
  events and non-zero exit codes on stderr.
- **`summary` on a day with zero activity no longer spends LLM
  tokens.** `report --date today` already returns "No activity
  found"; `summary` was happily piping that empty payload to claude
  for a useless answer (and `-o` opened an empty page). The daily
  path now matches the range path's "no activity → skip" behavior:
  writes a stub to the cache, prints a clear stderr line, returns
  success without spawning claude.

### Added
- **`Smoke (Windows)` workflow.** Manual-trigger CI job that
  exercises the real CLI on a Windows runner (`agenthud --version /
  --help / --once / --cwd / report / summary` against a faked
  session and a pre-seeded cache file). The unit-test matrix already
  covered Windows, but it can't catch path-separator regressions in
  stderr labels, `cmd /c start` quoting, or the filesystem side of
  `regenerateIndex` — this one can. Trigger from the Actions tab.
- **README "Platform notes"** paragraph clarifying that macOS and
  Linux are the daily-driver targets, Windows is best on WSL2
  (Anthropic's recommendation for Claude Code itself), and native
  PowerShell may need an ExecutionPolicy adjustment for any
  npm-installed CLI.

### Fixed
- **Windows: `prompt = ...` stderr line used backslash separators.**
  `formatPromptSource` now normalises its output to forward slashes
  so the user-facing label reads as `~/.agenthud/summary-prompt.md`
  on every platform. (Pure cosmetic on POSIX; lets the Windows
  CI tests pass.)

v0.12.0 was tagged but never reached npm — the Windows test job in
CI caught this issue before the publish step ran. v0.12.1 is the
first 0.12 release on npm.

## [0.12.0] - 2026-06-07

### Added
- **Config-driven defaults for `report` and `summary`.** New
  `report:` and `summary:` sections in
  `~/.agenthud/config.yaml` carry the include set, detail limit,
  with-git toggle, and format. CLI flags still win per
  invocation. `summary:` keys inherit from `report:` when
  omitted, so most users can pin one shape under `report:` and
  have summary follow. Resolution order: `CLI flag → summary.* →
  report.* → built-in default`.
- **`summary` exposes the same option surface as `report`.** New
  `--include`, `--detail-limit`, `--with-git`, `--format` flags
  on the `summary` subcommand let you tune what feeds the LLM
  payload from the command line.
- **`summary --open` / `-o`.** Once the summary markdown is
  written (or returned from cache), launch it in the OS's default
  app — typically a browser with a markdown extension or VS Code.
  Native spawn, no extra dependency. Works across daily, range,
  and cache-hit paths.
- **`summary --open-index` / `-I` and the auto-managed
  `~/.agenthud/summaries/index.md`.** Every successful summary
  write regenerates a hub markdown file that lists every daily
  and range summary, grouped year → month, newest first, with a
  one-line first-paragraph snippet and `(Sun)`-style weekday tag
  on each row. Each summary file gets a backlink footer at the
  top (`← all summaries · ← prev · next →`) plus an H1 title
  (`# 2026-05-15 (Friday)`), so any markdown viewer is enough to
  navigate the whole corpus. `-oI` opens both the day's summary
  and the index in one go.
- **Left-arrow "jump to parent" in the project tree.** Pressing
  `←` climbs out of the current row: sub-agent → parent session,
  session → project sentinel, project / cold-projects sentinel →
  the row above. Vim/tree-UI convention; the `←: parent` hint
  shows in the status bar and the help overlay.
- **Effective-options line on stderr** at the start of every
  `report` / `summary` run, e.g.
  `summary → include=[user,response,bash,edit,thinking]
  detail-limit=∞ with-git=on`. Followed by `prompt = ...` so the
  template source is visible too. Tells you what was actually
  used; no surprises about hidden hardcodes.
- **Stderr ticker during the claude call** when stdout streaming
  is suppressed (e.g. `--open`). Writes one self-updating line
  like `sending to claude... 12s` so a 30–60-second LLM wait
  doesn't look like a frozen terminal.

### Fixed
- **`summary` daily payload no longer drops user prompts.** The
  hardcoded include set inside `summaryRunner.ts` missed `user`,
  so the LLM saw no prompts even after v0.11.2 added `user` to
  the `report` default. The include set is now shared via
  `DEFAULT_INCLUDE_TYPES` and both surfaces resolve it the same
  way.
- **Cold-only project tree was unusable at boot.** When every
  project's latest session was older than today, nothing was
  highlighted and j/k were silent no-ops. The cold group now
  expands by default and the boot selection lands on the
  cold-group sentinel so navigation works immediately.
- **Cold sub-agent rows were rendered but unreachable.** A cold
  session expanded via Enter wrote a `__expanded-session-<id>`
  key that the renderer respected but the navigation flat-list
  ignored — selection landed on a sub-agent that j/k/PgUp/PgDn
  couldn't move from. The flatten functions now agree.

### Changed
- **`agenthud:` prefix removed from routine info/progress lines.**
  Seven prefixed lines per summary run was visual noise; the
  prefix now only leads error and warning lines so a redirected
  log still reads as "this is from agenthud" when something
  goes wrong.

### Upgrade notes
- Existing config files are not migrated — the new `report:` and
  `summary:` sections are only written when the file does not
  exist. Behavior is unchanged for upgrading users (built-in
  defaults). To pin your preferences, add the sections by hand
  using the example block in the README.
- On the first `summary` after upgrading, the index and the
  per-file backlinks + H1 titles are written across every
  existing summary file in one pass. The originals are preserved
  below the header block; only the auto-managed top region
  changes.

## [0.11.4] - 2026-06-05

### Fixed
- **`--once` no longer wipes terminal scrollback.** The mode used to
  call `console.clear()` before rendering, which emits the
  clear-screen + clear-scrollback escape on modern terminals — the
  user's working context above the snapshot disappeared even though
  `--once` never entered an alt-screen. The snapshot now renders in
  place at the cursor like any other print-and-exit CLI tool.

## [0.11.3] - 2026-06-05

### Fixed
- **`report --date -1d` (and any `-Nd` value) was rejected as an
  unknown flag.** The report subcommand's unknown-flag scan didn't
  skip values after value-taking flags, so the documented `-Nd`
  shorthand tripped the check. Mirrors the `summary` subcommand's
  existing pattern.

### Changed
- **`watch` is now a first-class command in the help layout.** It
  used to live under `Options:` alongside `--version` / `--help`
  while less-central modes (report, summary) got the top-level
  `Commands:` billing. The help is restructured so watch sits in
  `Commands:` with `(default)` annotation; its flags (`-w/--watch`,
  `--once`, `--cwd`) sit under it the way report's and summary's
  flags do. `agenthud watch` is also accepted as an explicit
  positional now (it used to error as "Unknown command").

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
