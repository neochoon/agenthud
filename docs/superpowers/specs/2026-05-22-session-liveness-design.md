# Session Liveness Design (working / waiting)

## Goal

Surface, at a glance, which sessions are **actively working** versus **waiting on the user**, so someone juggling multiple agents knows where their attention is needed. Today's status badges (`hot/warm/cool/cold`) are derived purely from file mtime (`getSessionStatus` in `sessions.ts`); they tell you *when* a session was last touched, not *what state* it is in.

This adds a second, orthogonal dimension — **live state** — derived from the structure of the session JSONL's tail, and renders it as a badge that replaces `[hot]` for recently-active sessions.

Scope for this work: **detection + badge display only.** Notifications, sort-to-top, and tracking-mode integration are explicit follow-ups (see Out of Scope).

---

## State Model

Two live states, plus "no opinion":

| State | Meaning | Badge | Color |
|-------|---------|-------|-------|
| `working` | Claude is mid-turn (tool executing, or about to respond) | `[working]` | green |
| `waiting` | Claude yielded the turn — the ball is in the user's court (incl. an explicit `AskUserQuestion`) | `[waiting]` | magenta |
| `null` | Cannot determine, or session is older than the recency window | falls back to existing `[hot/warm/cool/cold]` | unchanged |

There is intentionally **no `done` state**: from the JSONL, "done" and "waiting" are the same condition (the turn was yielded). Distinguishing them reliably is not possible from the file alone, so older yielded sessions simply fall back to the time-based badge.

---

## Architecture

### New module: `src/data/sessionLiveness.ts`

A pure, dependency-free module — easily unit-testable with line fixtures, matching the existing `parseActivitiesFromLines(lines)` pattern.

```ts
export type LiveState = "working" | "waiting";

export function detectLiveState(
  tailLines: string[], // last N JSONL lines, chronological order
  mtimeMs: number,
  now: number,
): LiveState | null;
```

### Detection heuristic

The **tail structure is the primary signal** — not mtime. (A long-running Bash/test leaves mtime stale for minutes while the session is genuinely working; the pending `tool_use` in the tail still resolves correctly to `working`.)

Scan `tailLines` from the end, find the **last meaningful entry** (`type === "user"` or `"assistant"`; skip `system` entries and unparseable lines). Then:

| Last meaningful entry | Condition | Result |
|-----------------------|-----------|--------|
| `assistant` | no `tool_use` block (ends with text) | `waiting` |
| `assistant` | has pending `tool_use`, any block named `AskUserQuestion` | `waiting` |
| `assistant` | has pending `tool_use` (other tools) | `working` |
| `user` | prompt or `tool_result` | `working` |
| none found / all unparseable | — | `null` |

Because we examine the tail, any `tool_use` in the last assistant entry is by definition pending (no following `tool_result` has been appended yet).

### Recency gate

If `now - mtimeMs > THIRTY_MINUTES_MS` (the existing `hot` threshold from `constants.ts`), return `null` regardless of tail content.

Consequence: **`working`/`waiting` only ever replace the `[hot]` badge.** `warm/cool/cold` sessions are untouched. This keeps the feature honest — after 30 minutes idle we stop asserting a live state and fall back to time-based status. Long-running tools (rare to exceed 30 min) stay `working` because the gate is on elapsed time, not append frequency, and 30 min comfortably covers them.

### Integration into discovery

`discoverSessions` already reads each session file's tail in `readModelName` (last ~50 lines). Combine that read with liveness detection into a single helper so the tail is read once per session:

```ts
// replaces readModelName
function readSessionTail(filePath: string): {
  modelName: string | null;
  liveState: LiveState | null;
};
```

This removes one redundant file read per session and keeps the per-refresh cost effectively unchanged. Applied to both top-level sessions and sub-agents (both are `SessionNode`s).

### Non-interactive sessions

For `nonInteractive` sessions (`entrypoint === "sdk-cli"`, e.g. `agenthud summary`, headless `claude -p`), `waiting` is meaningless — they never wait on a human. **Suppress `liveState` entirely** for these (leave `null`); they keep their existing dimmed/parenthesized rendering.

---

## Data Model

`src/types/index.ts`:

```ts
export type LiveState = "working" | "waiting";

export interface SessionNode {
  // ...existing fields...
  liveState: LiveState | null; // NEW
}
```

Sorting is **not** changed in this work. Sessions continue to sort interactive → status → mtime. (Sort-to-top for `waiting` is a follow-up.)

---

## UI / Badge Rendering (`src/ui/SessionTreePanel.tsx`)

Add a badge-deriving helper with clear precedence:

```ts
function getBadge(session: SessionNode): { text: string; color: string } {
  if (session.liveState === "working") return { text: "[working]", color: "green" };
  if (session.liveState === "waiting") return { text: "[waiting]", color: "magenta" };
  return { text: `[${session.status}]`, color: getStatusColor(session.status) };
}
```

`SessionRow` uses `getBadge(session)` instead of constructing `[${session.status}]` and calling `getStatusColor` directly. Layout/width math is unchanged (badge is still a single bracketed token; `[working]`/`[waiting]` are wider than `[hot]` but the existing width-aware truncation handles it).

Static badge for now — animating `working` with the existing spinner glyph is a follow-up.

Example:

```
┌─ Projects ──────────────────────────────────────┐
│ > agenthud  ~/WestbrookAI/agenthud          2m  │
│     #864f [working] Fix the auth bug in login   │
│     #398c [waiting] Add OAuth support           │
│   myproject  ~/work/myproject               5m  │
│     #def4 [hot]     Investigate flaky test      │
└─────────────────────────────────────────────────┘
```

---

## Testing (TDD)

1. **`tests/data/sessionLiveness.test.ts`** — pure unit tests over `detectLiveState` with JSONL line fixtures:
   - assistant ends with text → `waiting`
   - assistant with pending non-question `tool_use` → `working`
   - assistant with pending `AskUserQuestion` tool_use → `waiting`
   - last entry is a `user` prompt → `working`
   - last entry is a `user` tool_result → `working`
   - `system` / unparseable trailing lines are skipped to find the last meaningful entry
   - empty / all-unparseable input → `null`
   - `mtimeMs` older than 30 min → `null` regardless of tail
2. **`tests/data/sessions.test.ts`** (extend) — `discoverSessions` populates `liveState` from fixture files; `nonInteractive` sessions get `null`; sub-agents get `liveState`.
3. **`tests/ui/SessionTreePanel.test.tsx`** (extend) — `[working]` renders green, `[waiting]` renders magenta, and `liveState: null` falls back to the time-based badge.

Write tests first, confirm they fail for the right reason, then implement.

---

## Edge Cases

- **Empty file / unparseable tail** → `null` → time-based badge.
- **Long-running tool (stale mtime, < 30 min)** → tail shows pending `tool_use` → `working`.
- **Question asked >30 min ago and unanswered** → falls back to `[warm]`/`[cool]` (we stop nagging after the hot window). Accepted tradeoff for simplicity.
- **Parallel tool_use blocks** in the last assistant entry → if any is `AskUserQuestion` → `waiting`; otherwise `working`.
- **Sub-agent waiting** → unusual (sub-agents rarely prompt the user) but harmless; `working` is the common and useful case.

---

## Out of Scope (Follow-ups)

- Desktop / terminal-bell **notifications** when a session enters `waiting`.
- **Sort `waiting` sessions to the top** of the tree.
- **Tracking-mode (`t`) integration** — auto-follow/jump to `waiting` sessions.
- **Animated `working` badge** using the existing spinner.
- A richer 5-state model (`question` / `permission` / `stuck`) — deferred due to unreliable detection from JSONL alone.
