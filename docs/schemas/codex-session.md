# Codex CLI Session Files — On-Disk Schema

Empirical schema from a live OpenAI Codex CLI install on macOS,
including a parent session that spawned three sub-agents.
Verification commands at the bottom.

## File layout

Sessions are date-partitioned JSONL "rollout" files:

```
~/.codex/sessions/YYYY/MM/DD/rollout-<ISO8601>-<uuid>.jsonl
```

- `<ISO8601>` is the start time with `:` replaced by `-`
  (e.g. `2026-06-12T16-08-36`).
- `<uuid>` is the session id (UUIDv7 — time-ordered).
- No override env var observed; the root is hardcoded to
  `~/.codex/sessions`.

Sub-agents are **separate rollout files** in the same date tree
(see "Sub-agents" below). Codex also keeps several SQLite stores in
`~/.codex/` (`logs_2.sqlite`, `state_5.sqlite`, `memories_1.sqlite`,
`goals_1.sqlite`) — these are caches / app state, not the
conversation source of truth. The rollout JSONL holds full content.

## Record envelope

Every line: `{ type, timestamp, payload }`.

```ts
interface CodexRecord {
  type: "session_meta" | "turn_context" | "event_msg" | "response_item";
  timestamp: string; // ISO 8601, e.g. "2026-06-12T06:08:56.130Z"
  payload: object;   // shape depends on `type`
}
```

| `type` | Count (sample) | Purpose |
|---|---|---|
| `session_meta` | 1 (first line) | session identity, cwd, model provider, git, sub-agent linkage |
| `turn_context` | per turn | model, approval/sandbox policy, collaboration mode |
| `event_msg` | many | UI-facing events (user/agent messages, token counts, task start/complete) |
| `response_item` | many | the raw LLM transcript (messages, tool calls, reasoning) |

## `session_meta` — session identity (first line)

```ts
interface SessionMeta {
  id: string;            // session uuid (matches filename)
  timestamp: string;
  cwd: string;           // project dir — used for grouping
  originator: string;    // "codex-tui"
  cli_version: string;   // "0.121.0"
  source: "cli" | { subagent: { thread_spawn: ThreadSpawn } };
  model_provider: string; // "openai"
  base_instructions: { text: string }; // the full system prompt
  git?: {
    commit_hash: string;
    branch: string;
    repository_url: string;
  };
  // sub-agent files ONLY (see below):
  parent_thread_id?: string;
  agent_nickname?: string;     // "Hubble"
  agent_role?: string;         // "explorer"
  multi_agent_version?: string;
  thread_source?: unknown;
}

interface ThreadSpawn {
  parent_thread_id: string;  // the spawning session's uuid
  depth: number;             // 1 for a direct child
  agent_path: string | null;
  agent_nickname: string;    // "Hubble"
  agent_role: string;        // "explorer"
}
```

**Top-level vs sub-agent is decided here:**
- Top-level session: `source: "cli"`, no `parent_thread_id`.
- Sub-agent session: `source.subagent.thread_spawn` present AND a
  top-level `parent_thread_id` field pointing at the parent's uuid.

Note: `session_meta` does NOT carry the model — that lives in
`turn_context` (it can change per turn).

## `turn_context` — per-turn settings

```ts
interface TurnContext {
  turn_id: string;
  cwd: string;
  current_date: string;       // "2026-06-12"
  timezone: string;           // "Australia/Sydney"
  model: string;              // "gpt-5.4" — THE model for this turn
  personality: string;        // "pragmatic"
  approval_policy: string;    // "on-request"
  sandbox_policy: {
    type: string;             // "workspace-write"
    writable_roots: string[];
    network_access: boolean;
    // ...
  };
  collaboration_mode: { mode: string; settings: object }; // "default" | "plan"
  summary: string;            // "none"
  truncation_policy: { mode: string; limit: number };
  realtime_active: boolean;
}
```

The latest `turn_context.model` is the session's current model.

## `event_msg` — UI-facing events

`payload.type` is the discriminator:

| `payload.type` | Carries |
|---|---|
| `user_message` | `{ message, images, local_images, text_elements }` — the user's prompt text |
| `agent_message` | `{ message }` — assistant's natural-language reply |
| `reasoning` | (encrypted reasoning summaries) |
| `token_count` | `{ info: { total_token_usage, last_token_usage, model_context_window }, rate_limits }` |
| `task_started` | `{ turn_id, started_at, model_context_window, collaboration_mode_kind }` |
| `task_complete` | `{ turn_id, last_agent_message, completed_at, duration_ms }` |
| `error` | error surfaced to the UI |

### Context-window usage (for a gauge)

`token_count.info` has everything needed, no inference required:

```jsonc
{
  "total_token_usage":  { "total_tokens": 2282060, ... },
  "last_token_usage":   { "total_tokens": 112590, ... },
  "model_context_window": 258400
}
```

Gauge percent = `last_token_usage.total_tokens / model_context_window`
(the LAST turn's prompt size against the window — the live
"how full is the context" number; `total_token_usage` is the
cumulative bill, not the window occupancy).

### Row description (title)

There's no title field. Use the first `event_msg.user_message`
whose `message` is not a synthetic `<environment_context>…` block
(Codex injects one as the first user turn). The first real human
message is the session's intent.

## `response_item` — raw transcript

`payload.type` discriminator:

| `payload.type` | Shape |
|---|---|
| `message` | `{ role: "user"\|"assistant"\|"developer", content: [{ type: "input_text"\|"output_text", text }] }` |
| `function_call` | `{ name, call_id, arguments }` (arguments is a JSON STRING) |
| `function_call_output` | `{ call_id, output }` (output is a string; for exec it embeds wall-time + exit code + captured stdout) |
| `reasoning` | `{ summary, encrypted_content }` |
| `tool_search_call` / `tool_search_output` | tool-discovery RPC |

### Tool names (`function_call.name`)

Observed: `exec_command` (the workhorse — runs shell), plus the
multi-agent trio `spawn_agent` / `wait_agent` / `close_agent`.
`exec_command` arguments: `{ cmd, workdir, yield_time_ms,
max_output_tokens }`.

## Sub-agents — separate rollout files, linked by id

Codex spawns sub-agents as full, independent sessions:

1. Parent emits a `function_call` `spawn_agent` with
   `arguments: { agent_type, message, fork_context }`.
2. Its `function_call_output` returns
   `{ "agent_id": "<uuid>", "nickname": "Hubble" }`.
3. `<agent_id>` is the UUID of a **separate rollout file** in the
   same `YYYY/MM/DD/` tree
   (`rollout-…-<agent_id>.jsonl`).
4. That file's `session_meta` carries `parent_thread_id` (= the
   parent's uuid) and `source.subagent.thread_spawn` with
   `agent_role` ("explorer") and `agent_nickname` ("Hubble").
5. Parent later issues `wait_agent { targets: [uuid…], timeout_ms }`
   and `close_agent { target: uuid }`.

So linkage is bidirectional and file-based (like Kiro CLI, unlike
Kiro IDE which embeds sub-agents in the parent's execution log):
- parent → child: `spawn_agent` output `agent_id`
- child → parent: `session_meta.parent_thread_id`

### Version drift (verified)

The sub-agent shape changed between Codex releases:

- **Current (0.121, June 2026):**
  `source: { subagent: { thread_spawn: { parent_thread_id, depth,
  agent_role, agent_nickname } } }` AND a top-level
  `parent_thread_id`.
- **Older (Jan 2026):** `source: { subagent: "review" }` (the role
  as a bare string) and NO `parent_thread_id`.

Robust classification rule:
- A session is a **sub-agent** if `source` is an object whose key
  is `subagent` (either shape).
- A session is **top-level** if `source === "cli"`.
- Use `parent_thread_id` for nesting when present; an older
  sub-agent without it is an orphan (surface it at top level rather
  than dropping it).

## What the agenthud `codex` provider consumes

Implemented in `src/data/providers/codex.ts`.

| Signal | Source |
|---|---|
| Discovery | walk `~/.codex/sessions/YYYY/MM/DD/*.jsonl` (override `CODEX_SESSIONS_DIR`) |
| Top-level vs sub-agent | `session_meta.source` (object-with-`subagent` = child) / `parent_thread_id` |
| Project grouping | `session_meta.cwd` |
| Model | latest `turn_context.model` |
| Context gauge | `token_count.info.last_token_usage.total_tokens / model_context_window` |
| Row description | first non-`<environment_context>` `user_message.message` |
| Recency | file mtime |
| Activities | `event_msg.user_message`/`agent_message`, `response_item.function_call` (exec_command → Bash, spawn_agent → Task) |
| Per-file parse cache | keyed by (path, mtime) — cold rollouts never re-read |

## Verify the schema yourself

```bash
ROOT=~/.codex/sessions
F=$(ls -t "$ROOT"/*/*/*/*.jsonl | head -1)

# Top-level record types
jq -r '.type' "$F" | sort | uniq -c

# event_msg subtypes
jq -r 'select(.type=="event_msg") | .payload.type' "$F" | sort | uniq -c

# response_item subtypes
jq -r 'select(.type=="response_item") | .payload.type' "$F" | sort | uniq -c

# tool names used
jq -r 'select(.payload.type=="function_call") | .payload.name' "$F" | sort | uniq -c

# session source (cli vs subagent) across ALL sessions
for f in "$ROOT"/*/*/*/*.jsonl; do
  jq -rc 'select(.type=="session_meta")
          | (.payload.source | if type=="string" then . else "subagent" end)
            + " " + (.payload.parent_thread_id // "-")' "$f"
done | sort | uniq -c

# context window + last-turn tokens
jq -c 'select(.payload.type=="token_count")
       | {win: .payload.info.model_context_window,
          last: .payload.info.last_token_usage.total_tokens}' "$F" | tail -1
```

If any output surprises you, this doc is wrong — open an issue.

## Notes / caveats

- Rollout files are append-only; `timestamp` is per-record and
  chronological.
- `model` is per-turn (`turn_context`), not per-session — a session
  can switch models mid-conversation.
- The first `user_message` is usually a synthetic
  `<environment_context>` block; skip it for the title.
- `function_call.arguments` and some `function_call_output.output`
  fields are JSON encoded as STRINGS — double-parse.
- `reasoning` items carry `encrypted_content`; the plaintext
  reasoning is not recoverable from the rollout.
- Sub-agent depth can exceed 1 (`thread_spawn.depth`); a child
  could spawn its own children. A discovery pass should handle
  arbitrary depth via `parent_thread_id` chains.
