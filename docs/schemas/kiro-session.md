# Kiro CLI Session Files — On-Disk Schema

Empirical schema reconstructed from real Kiro CLI session files on
macOS. Field inventories were derived with `jq` (commands at the
bottom of this doc — run them against your own sessions to confirm
nothing new has appeared).

## File layout

Each Kiro session is a **four-file bundle** in a single flat
directory:

```
~/.kiro/sessions/cli/
├── {session-id}.json       # metadata sidecar (cwd, title, model, parent link)
├── {session-id}.jsonl      # conversation log (one record per line)
├── {session-id}.history    # plain-text user-prompt log
└── {session-id}.lock       # present only while the session process is alive
```

- `{session-id}`: UUIDv4. The same UUID for all four files.
- Override location with `KIRO_SESSIONS_DIR` env var.
- Sub-agents live in the **same** directory; the parent link is
  the `parent_session_id` field inside `.json`, NOT path structure.
  (Contrast with Claude, which uses a `subagents/` subdirectory.)

There is also a global SQLite store at
`~/Library/Application Support/kiro-cli/data.sqlite3` (tables:
`conversations`, `conversations_v2`, `history`, ...). It mirrors
some of the JSONL content but the four-file bundle is the source of
truth used by agenthud.

## `.json` — metadata sidecar

```ts
interface KiroSessionMeta {
  session_id: string;                       // uuidv4, matches filenames
  cwd: string;                              // absolute project path
  created_at: string;                       // ISO 8601, e.g. "2026-06-11T23:26:46.269062Z"
  updated_at: string;                       // ISO 8601
  title: string;                            // auto-set to first user prompt
  session_created_reason: "subagent";       // **value is always "subagent" — useless as a signal**
  parent_session_id?: string | null;        // null on top-level sessions, uuid on sub-agents
  session_state: {
    version: "v1";
    agent_name: string | null;              // "kiro_default" on top-level, null on sub-agent
    conversation_metadata: {
      user_turn_metadatas: UserTurnMetadata[];
      user_turn_start_request: unknown | null;
      last_request: unknown | null;
    };
    rts_model_state: {
      conversation_id: string;              // matches session_id
      model_info: { model_id: string; context_window_tokens: number } | null;
      context_usage_percentage: number | null;
    };
    permissions: {
      filesystem: {
        allowed_read_paths: string[];
        allowed_write_paths: string[];
        denied_read_paths: string[];
        denied_write_paths: string[];
      };
      trusted_tools: string[];
      denied_tools: string[];
      allowed_commands: string[];
    };
  };
}

interface UserTurnMetadata {
  loop_id: {
    agent_id: {
      name: string;        // "kiro_default" etc.
      parent_id: string | null;
      rand: number | null;
    };
    rand: number;
  };
  result: { Ok: AssistantTurnResult } | { Err: unknown };
  message_ids: string[];
  builtin_tool_uses: unknown[];
  context_usage_percentage: number | null;
  end_reason: string;
  end_timestamp: number;        // unix seconds
  input_token_count: number;
  output_token_count: number;
  total_request_count: number;
  number_of_cycles: number;
  metering_usage: unknown;
  turn_duration: number;        // seconds
}
```

**Important: `session_created_reason: "subagent"` is set on every
session — including fresh top-level ones started from scratch.
Don't use it to detect sub-agents. Use `parent_session_id`
(null = top-level, uuid = child).** Verified empirically.

## `.jsonl` — conversation log

Each line:

```ts
interface KiroRecord {
  version: "v1";
  kind: "Prompt" | "AssistantMessage" | "ToolResults";
  data: PromptData | AssistantData | ToolResultsData;
}
```

There are only three record kinds:

| Kind               | Frequency in sample | Purpose |
|--------------------|---------------------|---------|
| `Prompt`           | per user turn       | user input |
| `AssistantMessage` | 1–N per turn        | model response (text + tool calls) |
| `ToolResults`      | per assistant turn that called tools | results bundled together |

### `Prompt`

```ts
interface PromptData {
  message_id: string;
  content: PromptContentBlock[];
  meta: { timestamp: number }; // unix SECONDS (not ms)
}
type PromptContentBlock =
  | { kind: "text"; data: string }
  | { kind: "image"; data: { source: { type: "base64"; media_type: string; data: string } } };
```

### `AssistantMessage`

```ts
interface AssistantData {
  message_id: string;
  content: AssistantContentBlock[];
  // No top-level meta.timestamp — use the preceding Prompt's timestamp
  // when ordering. agenthud's parser inherits forward.
}

type AssistantContentBlock =
  | { kind: "text"; data: string }
  | {
      kind: "toolUse";
      data: {
        toolUseId: string;     // referenced later by toolResult.toolUseId
        name: string;          // RAW Kiro name — see "Tool names" below
        input: Record<string, unknown>;
      };
    };
```

### `ToolResults`

```ts
interface ToolResultsData {
  message_id: string;
  content: { kind: "toolResult"; data: ToolResultData }[];
  results: Record<string, unknown>; // toolUseId → richer result detail (Kiro-internal)
}

interface ToolResultData {
  toolUseId: string;
  content: { kind: "text"; data: string }[];
  status: "success" | "error" | string;
}
```

### Tool names

Kiro uses lowercase snake_case tool names, distinct from Claude's
CamelCase. Observed in the sample corpus:

```
read, write, edit, shell, grep, glob, web_fetch, web_search,
subagent, todo, introspect
```

agenthud maps these to canonical names via
`src/data/providers/toolLabels.ts`:

| Kiro raw                  | Canonical |
|---------------------------|-----------|
| `read`, `introspect`      | `Read` |
| `shell`, `bash`           | `Bash` |
| `write`                   | `Write` |
| `edit`                    | `Edit` |
| `grep`                    | `Grep` |
| `glob`                    | `Glob` |
| `web_fetch`, `fetch`      | `WebFetch` |
| `web_search`, `search`    | `WebSearch` |
| `task`, `subagent`        | `Task` |
| `todo`, `todowrite`       | `TodoWrite` |
| `ask`, `askuserquestion`  | `AskUserQuestion` |

### Kiro tool input convention

Tool inputs frequently include a `__tool_use_purpose` field — that's
a Kiro-UI annotation, not part of the tool's real parameters. Strip
it before showing the input to the user. agenthud does this in
`summarizeToolInput`.

## `.history` — plain-text user prompt log

Newline-separated list of every prompt the user typed, in order.
Includes slash commands (`/model`, `/quit`, ...). Not JSON.

```text
이 프로젝트 분석해봐.
이걸 kiro-cli가 만드는 세션도 지원하고 싶은데.. 어떻게 생각
/model
너 사용하는 llm 모델이 딐야
```

Handy for summary input — gives a denormalized "what was the user
trying to do" stream without parsing the full JSONL. agenthud
doesn't read this yet.

## `.lock` — process liveness signal

Tiny JSON file present iff the Kiro process for this session is
alive. Removed on clean exit, sometimes survives a crash (stale).

```json
{"pid": 12927, "started_at": "2026-06-11T23:26:46.268779Z"}
```

agenthud uses `existsSync(<id>.lock)` as the `liveState: "waiting"`
signal. A future tightening: also check the lock's `pid` is alive
(`process.kill(pid, 0)`) to drop stale locks.

## Example record stream

```jsonl
{"version":"v1","kind":"Prompt","data":{"message_id":"p1","content":[{"kind":"text","data":"이 프로젝트 분석해봐."}],"meta":{"timestamp":1781220419}}}
{"version":"v1","kind":"AssistantMessage","data":{"message_id":"a1","content":[{"kind":"text","data":"프로젝트 구조 살펴볼게요."},{"kind":"toolUse","data":{"toolUseId":"tu1","name":"read","input":{"__tool_use_purpose":"프로젝트 구조 파악","operations":[{"mode":"Directory","path":"/Users/neo/proj","depth":2}]}}}]}}
{"version":"v1","kind":"ToolResults","data":{"message_id":"t1","content":[{"kind":"toolResult","data":{"toolUseId":"tu1","content":[{"kind":"text","data":"…directory listing…"}],"status":"success"}}],"results":{"tu1":{"tool":{"kind":{"BuiltIn":{"FileRead":{"operations":[…]}}}}}}}
```

## Verify the schema yourself

Run any of these against your own sessions to catch missed fields:

```bash
DIR=~/.kiro/sessions/cli

# All JSONL kinds
cat $DIR/*.jsonl | jq -r '.kind' | sort | uniq -c

# All AssistantMessage content kinds
cat $DIR/*.jsonl | jq -r 'select(.kind=="AssistantMessage")
                          | .data.content[]?.kind' | sort -u

# All distinct tool names
cat $DIR/*.jsonl | jq -r 'select(.kind=="AssistantMessage")
                          | .data.content[] | select(.kind=="toolUse")
                          | .data.name' | sort | uniq -c

# All `.json` top-level keys
cat $DIR/*.json | jq -r 'keys[]' | sort -u

# All `session_state` keys
cat $DIR/*.json | jq -r '.session_state | keys[]' | sort -u

# All `rts_model_state.model_info.model_id` values (what models people pin)
cat $DIR/*.json | jq -r '.session_state.rts_model_state.model_info.model_id // "null"' | sort | uniq -c

# Distribution of `session_created_reason`
cat $DIR/*.json | jq -r '.session_created_reason' | sort | uniq -c
# → "subagent" on everything. The reason this field is useless.

# All `parent_session_id` patterns (null vs uuid)
cat $DIR/*.json | jq -r '.parent_session_id // "null"' | head
```

If any output line surprises you, this doc is wrong — open an issue.

## Notes / caveats

- The `.json` is rewritten on every turn (not append-only). Don't
  tail it for live updates — watch `.jsonl` mtime instead.
- `meta.timestamp` is **unix seconds**, not milliseconds. Multiply
  by 1000 before passing to `new Date(...)`.
- `agent_name` is `null` on sub-agents — they don't get their own
  persona, they inherit the parent's. Don't rely on `agent_name`
  to distinguish sub-agents (use `parent_session_id`).
- The `.history` file is a convenience denormalization. If you
  want all user prompts including slash commands, it's faster than
  scanning the JSONL.
- `data.sqlite3` at `~/Library/Application Support/kiro-cli/` is a
  cache / secondary index, not the source of truth — ignore it
  for now.
