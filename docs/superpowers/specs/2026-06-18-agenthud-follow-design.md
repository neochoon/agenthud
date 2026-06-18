# `agenthud follow` — live merged event stream

> Status: design approved (2026-06-18). Issue #183.

## Context

agenthud already shows, in a live TUI, *what every agent is doing right
now*. But that signal is trapped in the terminal UI — nothing can **consume**
it programmatically. The motivating use case is a higher-level supervisor (a
"meta-claude") that watches all running agents, notifies the user when one
needs attention, and acts on its behalf via `tmux send-keys`. That supervisor
needs **eyes**: a real-time, machine-consumable stream of what's happening
across every session.

`agenthud follow` is those eyes. It is **only** the stream — the supervisor,
the user-notification, and the tmux control loop are a **separate project**
built on top. agenthud's single responsibility here is to emit a clean,
chronologically-merged event feed.

It also stands on its own as a humane `tail -f` for "what are all my agents
doing," independent of any supervisor.

## Goal / non-goals

**Goal:** a `follow` subcommand that streams, line by line, every new
**event** across all sessions/sub-agents — **activity** (Read/Edit/Bash/
Response/…) and **state transitions** (working↔waiting) and **lifecycle**
(session/sub-agent start/end, error, compact) — as a human-readable colored
stream by default, or NDJSON with `--json`. Optionally backfill from a start
time, then follow live.

**Non-goals (explicitly out):**
- The meta-claude / orchestrator / notifier / tmux control loop. Separate.
- Any control surface in agenthud (it stays read-only; it observes, never
  acts).
- A new TUI. `follow` is a plain line stream, not a curses view.

## User-facing shape

```
agenthud follow [--since SPEC] [--json] [--include TYPES] [--cwd PATH]
```

- `--since SPEC` — where the stream starts (default `now`):
  - `now` — only events from this moment on (pure tail -f).
  - `<N>h` / `<N>m` — relative: backfill the last N hours/minutes, then follow.
  - `HH:MM` — today at that clock time (local), then follow.
  - ISO `YYYY-MM-DDTHH:MM` — absolute instant, then follow.
  - `last` — the timestamp agenthud last ran `follow` (persisted), then follow.
- `--json` — emit NDJSON (the supervisor contract) instead of the human line.
- `--include TYPES` — comma list filtering **activity** event subtypes, same
  vocabulary as `report.include` (`response,bash,edit,thinking,read,glob,user`).
  `state`/`lifecycle` events are always emitted (they are the supervisor's
  trigger signal); `--include` only narrows the activity firehose.
- `--cwd PATH` — restrict to the project containing PATH (reuse
  `findContainingProject` / the watch `--cwd` scoping).

Name: `follow` (intent-clear). Wire as a new entry in `KNOWN_SUBCOMMANDS` and
the `mode` union in `cli.ts`, dispatched from `main.ts` **before** importing
Ink (no TUI needed — keep the boot path light, like `report`/`summary`).

## Event model (the NDJSON contract)

One JSON object per line. Stable, additive-only — the supervisor pins to it.

```ts
interface FollowEvent {
  ts: number;                 // event time, epoch ms (activity ts, or detection time for state/lifecycle)
  type: "activity" | "state" | "lifecycle";
  provider: "claude" | "codex" | "kiro" | "kiro-ide" | "opencode";
  project: string;            // project name (basename of cwd)
  projectPath: string;        // absolute cwd
  session: string;            // the owning TOP-LEVEL session's full id
  subagent: string | null;    // the sub-agent's own id/label when the event is the sub-agent's; else null
  // type-specific:
  // activity:
  label?: string;             // "Edit" | "Bash" | "Read" | "Response" | "Thinking" | "User" | "Commit" | ...
  detail?: string;            // one-line detail (file path, command, first line of text)
  // state:
  from?: "working" | "waiting" | null;
  to?: "working" | "waiting" | null;
  // lifecycle:
  kind?: "session_start" | "session_end" | "subagent_spawn" | "subagent_done" | "error" | "compact";
}
```

- **activity** — a new `ActivityEntry` appeared in a session's history.
- **state** — a session's (or interactive session's) `liveState` changed
  (working↔waiting↔null). `working→waiting` is the headline supervisor
  trigger ("this agent is now waiting on the user").
- **lifecycle** — session first seen / gone, sub-agent appears / finishes,
  an error/compaction surfaced. Derive from what discovery already exposes
  (new/removed session ids, sub-agent set deltas); start with the cheap,
  reliably-detectable subset and defer the rest (YAGNI).

Human line format (default, no `--json`):

```
[14:32:05] agenthud/cbe5773f/code-reviewer   ~ Edit      src/ui/App.tsx
[14:32:07] launcher/4888                      ⇄ waiting   (was working)
[14:32:09] agenthud/cbe5773f                  ◆ done      session ended
```

`[HH:MM:SS] project/session[/subagent]  <type-glyph> <label>  <detail>`,
colored by type/status (reuse `ICONS` and the status colors). Width-naive
(it's a stream, not a panel) — no padding/borders.

## Engine — reuse the watch refresh loop, emit deltas

The watch TUI already: discovers sessions every `refreshIntervalMs` (poll +
an fs.watch accelerator), parses each session's activity history, and detects
`liveState`. `follow` runs **the same engine headless** and, instead of
rendering, **diffs each tick against the previous tick** and emits the new
events.

Per refresh:
1. `discoverSessions(config, {scopeToProject?})` → the current tree (all
   providers, incl. opencode's SQLite).
2. For each session/sub-agent node, get its activity list
   (`parseSessionHistory(node.filePath)` — already cached/bounded; for
   opencode the synthetic path routes to the DB query).
3. **Delta vs the previous tick:**
   - New activities past a per-node cursor (the **count of activities
     already emitted** for that session; since `parseSessionHistory`
     returns the full chronological list, the new ones are simply
     `activities.slice(cursor)`) → `activity` events (honoring `--include`).
   - `liveState` changed vs the remembered value → `state` event.
   - Session id newly present / absent → `lifecycle` `session_start` /
     `session_end`. Sub-agent set delta → `subagent_spawn` / `subagent_done`.
4. Sort the tick's new events by `ts` and write them in order.

**Cursor / "last emitted" state** lives in memory for the process lifetime
(a `Map<sessionId, {emittedCount, lastLiveState}>`). Backfill seeds these
cursors: on start, for each session emit the activities with `ts >= since`,
then set `emittedCount` to the session's full activity count (so the next
tick only emits genuinely new tail entries) and follow.

Latency = refresh interval (default 2s, `--interval`/config overridable).
Acceptable for supervision; documented.

### `--since last`

Persist the last `follow` start (or last-emitted) timestamp to
`${agenthudHome()}/follow-state.json` (reuse `src/utils/agenthudHome.ts`,
honoring `AGENTHUD_HOME` for tests). `--since last` reads it; every run
updates it on exit/periodically.

## Components / files

- **`src/data/followStream.ts` (new)** — the pure-ish engine: given two
  successive discovery snapshots (+ activity lists) and the cursor state,
  produce the ordered `FollowEvent[]` delta. **This is the unit-test heart**
  — feed it synthetic before/after snapshots, assert the emitted events. No
  I/O, no timers.
- **`src/data/followRunner.ts` (new)** — the loop: parse `--since`, seed
  backfill, set the interval, call discovery + the diff engine, format and
  write lines, handle the persisted `last` state and clean shutdown
  (SIGINT). Thin; orchestration only.
- **`src/data/followFormat.ts` (new)** — `formatHuman(event)` and
  `formatJson(event)`. Pure, unit-tested.
- **`src/cli.ts`** — add `follow` to `KNOWN_SUBCOMMANDS` + `mode` union; parse
  `--since` / `--json` / `--include` / `--cwd`; help text.
- **`src/main.ts`** — dispatch `follow` before importing Ink (fast path).

### Reuse (don't reinvent)

- `discoverSessions` (`src/data/sessions.ts`) + `DiscoverOptions.scopeToProject`.
- `parseSessionHistory` (`src/data/sessionHistory.ts`) — already routes
  per-provider, incl. opencode DB.
- `ActivityEntry` shape + `activityMatchesInclude` (lift/share from
  `reportGenerator.ts`) for `--include` filtering.
- `detectLiveState` / the `liveState` already on each `SessionNode`.
- `ICONS` (`src/types/index.ts`) + status colors for the human format.
- `agenthudHome()` for `follow-state.json`; the `--since` relative/date
  parsing can borrow `cli.ts`'s existing `--date -Nd` / midnight parsing.

## Error handling

- A provider/parse failure for one session must not kill the stream — skip
  that node this tick (the engine already degrades to empty per node).
- Bad `--since` → friendly error + exit 2 (like other CLI arg errors).
- Broken pipe (consumer closed, e.g. `| head`) → exit 0 quietly.
- SIGINT → flush, persist `last`, exit 0.

## Testing

- **`followStream` (unit, the core):** synthetic snapshot pairs →
  - new activity → `activity` event(s), ordered by ts, `--include` honored;
  - liveState working→waiting → one `state` event;
  - new/removed session → `lifecycle` start/end; sub-agent set delta →
    spawn/done;
  - no change → no events; a node that errors → skipped, others still emit.
- **`followFormat` (unit):** human line + NDJSON shape for each `type`;
  null subagent omitted/handled; NDJSON round-trips `JSON.parse`.
- **`--since` parsing (unit):** `now` / `2h` / `30m` / `14:00` / ISO /
  `last`, incl. invalid input.
- **Integration (no live agents):** point `CLAUDE_PROJECTS_DIR` (+
  `AGENTHUD_HOME`) at temp fixtures, run one diff cycle, assert the emitted
  NDJSON; grow a fixture file and assert only the new tail emits.
- Each step: `vitest run`, `tsc --noEmit`, whole-repo `biome check`.

## Phasing (shippable slices)

1. **MVP:** `follow` + `--json` + `--since now|<N>h|<N>m`, **activity +
   state** events, the diff engine + format + tests. Lifecycle limited to
   `session_start/end` and `subagent_spawn/done`.
2. `--since HH:MM | ISO | last` (backfill + persisted state).
3. `--include` / `--cwd` filtering.
4. Richer lifecycle (`error`, `compact`) if the signals prove reliable.

Phase 1 alone delivers the supervisor's core feed.
