# opencode Session Store — On-Disk Schema

Empirical schema from a live [opencode](https://opencode.ai) **1.17.3**
install on macOS. Verification commands at the bottom.

> **This provider is different from every other one.** Claude, Codex,
> and Kiro store each session as JSON/JSONL **files** that agenthud
> scans. opencode stores **everything in a single SQLite database** —
> there are no per-session files to walk. A provider must open the DB
> **read-only** and query it. See "Access model" below before writing
> any code.

## Storage location

One global SQLite database, XDG data dir:

```
${XDG_DATA_HOME:-~/.local/share}/opencode/opencode.db   (+ -wal, -shm)
```

- Single DB for ALL projects/sessions (grouping is a column, not a
  directory). The sibling `opencode.db-wal` / `opencode.db-shm` are the
  WAL and shared-memory files — present because opencode keeps the DB
  open in WAL mode while running.
- Other files in that dir (`auth.json`, `account.json`, `models` cache,
  `log/`, `repos/`) are app state, not the conversation source.
- Per-model context-window sizes live in `~/.cache/opencode/models.json`
  (a mirror of models.dev) — needed to turn token counts into a gauge.

## Legacy storage (pre-SQLite) — file-per-entity JSON

Before the SQLite store, opencode persisted to **many small JSON files**
(one JSON object per file, NOT line-delimited JSONL), under
`${XDG_DATA_HOME:-~/.local/share}/opencode/storage/`:

```
storage/
  project/{projectID}.json              # one object per project
  session/{projectID}/{sessionID}.json  # one object per session
  message/{sessionID}/{messageID}.json  # one file PER message
  part/{messageID}/{partID}.json        # one file PER part (tool call, text…)
  session_diff/{sessionID}.json
  share/{sessionID}.json
  migration                             # migration version marker
```

A file per message and per part is why a short session could leave
thousands of files on disk — the churn that motivated the move to
SQLite. A migration engine bulk-inserts these into the DB (tracked by
the `migration` / `data_migration` tables), so on a current install the
DB is authoritative and `storage/` is usually absent or stale. A
provider targeting **un-migrated older installs** could fall back to
walking `storage/{session,message,part}/**.json`, but that is out of
scope for the SQLite-first implementation — document, don't build.

## Access model (read this first)

- Open **read-only**, e.g. `sqlite3 "file:<path>?mode=ro"`, or in Node
  `new DatabaseSync(path, { readOnly: true })` (`node:sqlite`, Node 22+)
  / `new Database(path, { readonly: true, fileMustExist: true })`
  (`better-sqlite3`). Never open read-write — opencode owns the file.
- WAL mode (`journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`,
  single writer / many readers): a read-only connection sees the last
  committed state; an in-flight (uncommitted) opencode write is simply
  invisible until it commits. That's fine — agenthud polls. Multiple
  opencode instances share this one DB, so read-only is the only safe
  posture (concurrent writers have caused corruption reports — not our
  concern as a reader, but a reason never to open read-write).
- **Schema is migration-versioned** (`migration` / `data_migration`
  tables). Column set WILL drift across opencode releases (note how many
  `session` columns below are `ALTER TABLE` add-ons). Treat columns as
  optional and feature-detect; pin behavior to the verification queries.

## Tables that matter

| Table | Purpose |
|---|---|
| `session` | one row per session (top-level or child) — identity, grouping, model, token totals, timestamps |
| `message` | one row per turn message; `data` is a JSON blob (role, tokens, time, finish) |
| `part` | message sub-parts; `data` JSON discriminated by `type` (text / tool / reasoning / step-*) — the activity timeline |
| `project` | worktree → project identity (name, vcs) |
| `todo` | per-session todo list (status, priority, position) |
| `permission` | pending permission prompts |

(Other tables — `account*`, `event*`, `workspace`, `session_share`,
`session_context_epoch`, `migration` — are app/sync state.)

## `session` table — identity & grouping

```sql
session(
  id            TEXT PK,    -- "ses_12fad7a2…"
  project_id    TEXT,       -- FK → project.id
  parent_id     TEXT,       -- non-null ⇒ this is a CHILD session (sub-agent)
  slug          TEXT,
  directory     TEXT,       -- absolute cwd — primary grouping key
  title         TEXT,       -- human title, e.g. "Repository explanation"
  version       TEXT,       -- opencode version that wrote it
  agent         TEXT,       -- agent profile, e.g. "build"
  model         TEXT,       -- JSON: {"id":"gpt-5.5","providerID":"openai","variant":"default"}
  cost          REAL,
  tokens_input, tokens_output, tokens_reasoning,
  tokens_cache_read, tokens_cache_write  INTEGER,  -- cumulative session totals
  time_created  INTEGER,    -- epoch MILLISECONDS
  time_updated  INTEGER,    -- epoch ms — recency / hot-cold
  time_archived INTEGER,    -- non-null ⇒ archived
  metadata      TEXT,       -- JSON, optional
  ...
)
```

- **Top-level vs sub-agent:** `parent_id IS NULL` ⇒ top-level;
  `parent_id` set ⇒ child of that session (opencode "sub-sessions"/
  task agents). Nest via the `session_parent_idx` index.
- **Project grouping:** use `session.directory` (the cwd). `project_id`
  → `project.name`/`worktree` gives a friendly label.
- **Model:** `session.model` is a **JSON object**, not a string — parse
  and take `.id` (e.g. `gpt-5.5`). It can also be read per-message
  (`message.data.modelID`), which is authoritative per turn.
- **Recency:** `time_updated` (epoch **ms** — divide is unnecessary,
  compare against `Date.now()`).

## `message` table — turns

`message.data` is a JSON blob. Assistant message keys observed:

```ts
interface OpencodeMessageData {
  role: "user" | "assistant";
  modelID?: string;        // "gpt-5.5"
  providerID?: string;     // "openai"
  agent?: string;          // "build"
  mode?: string;
  path?: { cwd: string; root: string };
  cost?: number;
  tokens?: {               // assistant only
    total: number;         // 53300
    input: number;         // 9121
    output: number;        // 1660
    reasoning: number;     // 23
    cache: { read: number; write: number };  // read 42496
  };
  time?: { created: number; completed?: number };  // epoch ms
  finish?: string;         // "stop" when the turn ended
}
```

### Liveness signal

A turn is **in progress** when the latest assistant message has
`time.completed` absent/null (and no `finish`). Once it streams to
completion, `time.completed` is set and `finish` becomes `"stop"`.
Map: latest assistant message still open ⇒ `working`; otherwise fall
back to time-based hot/cold on `session.time_updated`. (No explicit
"waiting for user/permission" flag in the message itself — a pending
row in the `permission` table is the closest signal for `waiting`.)

### Context-window gauge

`message.data.tokens` has the occupancy directly — no inference:

```jsonc
{ "total": 53300, "input": 9121, "output": 1660,
  "reasoning": 23, "cache": { "read": 42496, "write": 0 } }
```

Window occupancy = the prompt size of the latest assistant turn ≈
`input + cache.read` (= 51 617 here), divided by the model's context
window (from `~/.cache/opencode/models.json`, keyed by `modelID`).
`tokens.total` is the per-turn sum (input+output+reasoning+cache), and
the `session.tokens_*` columns are the cumulative session bill — neither
is window occupancy; use the last assistant turn's prompt tokens.

## `part` table — activity timeline

`part.data` is JSON discriminated by `type`. Observed:

| `type` | Shape | agenthud activity |
|---|---|---|
| `text` | `{ text, time:{start,end}, metadata }` | `response` (assistant text) |
| `tool` | `{ tool, callID, state:{status,input,output,metadata,title,time}, metadata }` | `tool` |
| `reasoning` | `{ text, time:{start,end}, metadata }` | `thinking` |
| `step-start` | `{ snapshot }` | turn boundary — skip |
| `step-finish` | `{ reason, snapshot, tokens:{…}, cost }` | turn boundary (carries per-step token totals) |

### Tool parts

```ts
interface OpencodeToolPart {
  type: "tool";
  tool: string;        // observed: "read", "glob"; opencode's set also has "edit", "bash", "grep", "write", …
  callID: string;
  state: {
    status: "pending" | "running" | "completed" | "error";
    title?: string;    // best one-line label, e.g. "tsup.config.ts"
    input?: object;    // tool arguments
    output?: string;   // tool result
    metadata?: object;
    time?: { start: number; end?: number };
  };
}
```

- `state.title` is the cleanest detail for the row (e.g. the file for
  `read`/`edit`). Fall back to `tool` + a field from `state.input`.
- `state.status` drives whether the tool call is still running.
- Order the timeline by `part.time_created` (or `message.time_created`
  then part order); `part` rows carry both `message_id` and `session_id`
  and an index on `session_id`.

### Row description (title)

Prefer `session.title` (opencode auto-generates a real one, e.g.
"Repository explanation"). Fall back to the first `user` message's text
part if a session has no title yet.

## Sub-sessions (`parent_id`)

opencode child sessions (task/sub-agents) are **rows in the same
`session` table** with `parent_id` pointing at the parent — not separate
files (contrast Codex/Kiro CLI) and not embedded in the parent's log
(contrast Kiro IDE). Discovery is a single query grouped by `parent_id`.
Depth can exceed 1; resolve nesting via `parent_id` chains.

## What an agenthud `opencode` provider would consume

(Not yet implemented — `src/data/providers/opencode.ts` is the target.)

| Signal | Source |
|---|---|
| Discovery | one read-only SQLite connection to `opencode.db`; `SELECT … FROM session` (override via `XDG_DATA_HOME` / an `OPENCODE_DB` env) |
| Top-level vs sub-agent | `session.parent_id` (null = top-level) |
| Project grouping | `session.directory` (+ `project.name`) |
| Title | `session.title` |
| Model | `json_extract(session.model,'$.id')` or latest `message.data.modelID` |
| Context gauge | latest assistant `message.data.tokens` (input+cache.read) ÷ model window from `models.json` |
| Recency | `session.time_updated` (epoch ms) |
| Liveness | latest assistant message `time.completed` null ⇒ working; `permission` row ⇒ waiting |
| Activities | `part` rows: `text`→response, `tool`→tool (`state.title`), `reasoning`→thinking |
| Parse cache | keyed by `(session.id, session.time_updated)` — unchanged sessions skip the part re-read |

## Verify the schema yourself

```bash
DB="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/opencode.db"
RO="file:${DB}?mode=ro"

# tables
sqlite3 "$RO" ".tables"

# session rows: id, parent, dir, title, agent, model
sqlite3 "$RO" "SELECT substr(id,1,12), COALESCE(parent_id,'-'),
  directory, title, agent, json_extract(model,'\$.id') FROM session
  ORDER BY time_updated DESC LIMIT 10;" -header

# part types in use (the activity vocabulary)
sqlite3 "$RO" "SELECT json_extract(data,'\$.type'), COUNT(*)
  FROM part GROUP BY 1 ORDER BY 2 DESC;"

# tool names used
sqlite3 "$RO" "SELECT json_extract(data,'\$.tool'), COUNT(*) FROM part
  WHERE json_extract(data,'\$.type')='tool' GROUP BY 1 ORDER BY 2 DESC;"

# latest assistant turn's tokens (gauge input)
sqlite3 "$RO" "SELECT json_extract(data,'\$.tokens') FROM message
  WHERE json_extract(data,'\$.role')='assistant'
  ORDER BY time_created DESC LIMIT 1;"
```

If any output surprises you, this doc is wrong — open an issue.

## Notes / caveats

- **SQLite, not files.** Needs a SQLite reader: `node:sqlite`
  (`DatabaseSync`, Node 22+, no dependency) or `better-sqlite3` (a
  native dependency). Pick before implementing the provider.
- Open **read-only**; opencode owns the live WAL DB.
- Timestamps are epoch **milliseconds** everywhere (`time_*` columns and
  `message.data.time.*`).
- `session.model` and `message.data` / `part.data` are JSON encoded as
  TEXT — `json_extract` in SQL or parse in JS.
- The schema is migration-versioned and several `session` columns are
  late `ALTER TABLE` additions — feature-detect columns; expect drift
  between opencode releases.
- Context-window size is NOT in the DB; it comes from the models catalog
  (`~/.cache/opencode/models.json`) keyed by `modelID`.
- Sample install was small (2 sessions, 43 parts); a larger corpus may
  surface more `part.type` / `tool` values and a populated `parent_id`.
- **No auto-pruning:** opencode never prunes, size-caps, or cleans up old
  sessions, so the DB (and the session count) grows unbounded over time.
  A discovery pass should expect an ever-growing `session` table and lean
  on recency (`time_updated`) ordering / hot-cold status rather than
  assuming a small set.
