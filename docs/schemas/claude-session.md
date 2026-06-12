# Claude Code Session Files — On-Disk Schema

Empirical schema reconstructed from real session files. Field
inventories were derived with `jq` (commands at the bottom of this
doc — run them against your own sessions to confirm nothing new has
appeared since this was written).

## File layout

```
~/.claude/projects/{encoded-path}/
├── {session-id}.jsonl              # top-level session
└── {session-id}/
    └── subagents/
        └── {subagent-id}.jsonl     # one file per spawned sub-agent
```

- `{encoded-path}`: project absolute path with `/` replaced by `-`
  (e.g. `/Users/neo/agenthud` → `-Users-neo-agenthud`). Windows
  drives use a different prefix (`C--Users-neo-...`).
- `{session-id}`, `{subagent-id}`: UUIDv4.
- Override location with `CLAUDE_PROJECTS_DIR` env var.

The top-level `.jsonl` and the per-subagent `.jsonl` share the same
record schema. There are no sidecar files — everything lives inline.

## Record envelope

Each line is one JSON object with a `type` discriminator. Top-level
keys observed across the corpus (frequency notes are illustrative;
exact distribution depends on session size and tool mix):

| Field                              | Type     | Required by | Notes |
|------------------------------------|----------|-------------|-------|
| `type`                             | string   | every line  | discriminator — see below |
| `timestamp`                        | ISO 8601 | every conversational line | `"2026-06-11T05:24:00.000Z"` |
| `uuid`                             | uuidv4   | conversational | line identity |
| `parentUuid`                       | uuidv4 \| null | conversational | DAG within a session |
| `sessionId`                        | uuidv4   | every line  | session UUID (matches filename) |
| `cwd`                              | string   | conversational | absolute path |
| `gitBranch`                        | string   | conversational | branch at time of write |
| `version`                          | string   | conversational | Claude Code version |
| `entrypoint`                       | string   | conversational | `cli` \| `sdk-cli` \| ... |
| `userType`                         | string   | conversational | `external` (only value observed) |
| `isSidechain`                      | boolean  | conversational | true on sub-agent files |
| `slug`                             | string   | conversational | short kebab tag derived from the prompt |
| `message`                          | object   | `user` / `assistant` | message envelope |
| `requestId`                        | string   | `assistant` | LLM request id |
| `promptId`                         | string   | `user` (top-level prompt) | groups user→assistant turn |
| `toolUseResult`                    | object \| string | `user` (tool result) | structured result from a tool |
| `sourceToolUseID` / `sourceToolAssistantUUID` | string | `user` (tool result) | back-pointer to the originating `tool_use` |
| `permissionMode`                   | string   | conversational (sometimes) | `default` / `bypass` / ... |
| `subtype`                          | string   | `system`    | system-event tag — see SystemEntry |
| `attachment` / `attributionPlugin` / `attributionSkill` | object | sporadic | metadata side-channels |
| `leafUuid`                         | uuidv4   | `attachment`, some others | |
| `aiTitle` / `customTitle`          | string   | title records | session display title |
| `prUrl` / `prRepository` / `prNumber` | string/int | `pr-link` | GitHub PR association |

## `type` values

| Value                    | Purpose |
|--------------------------|---------|
| `user`                   | user prompt OR tool result |
| `assistant`              | Claude response (text + tool_use + thinking) |
| `system`                 | session-level event (init, away summary, ...) — see subtypes below |
| `attachment`             | file attached to the session |
| `agent-name` / `agent-setting` | sub-agent provisioning records |
| `ai-title` / `custom-title` | session title set by Claude / user |
| `file-history-snapshot`  | snapshot of a watched file's content |
| `last-prompt`            | denormalized copy of the most recent prompt |
| `permission-mode`        | tool-permission policy change |
| `pr-link`                | GitHub PR association written when a PR is opened |
| `queue-operation`        | background job manipulation |
| `worktree-state`         | git worktree status capture |

## `system.subtype` values

| Subtype                | Purpose |
|------------------------|---------|
| `api_error`            | LLM API error surfaced into the log |
| `away_summary`         | summary of work done while user was AFK |
| `compact_boundary`     | marker where the session was compacted |
| `local_command`        | a `!`-prefixed shell-out from the user |
| `scheduled_task_fire`  | a scheduled task ran |
| `stop_hook_summary`    | stop-hook output summary |
| `turn_duration`        | wall-clock duration of a turn |

## `user.message` shapes

```ts
interface UserEntry {
  type: "user";
  message: {
    role: "user";
    content: string | UserContentBlock[];
    // string for free-typed text; array for structured (tool results, mixed prompts)
  };
  toolUseResult?: object | string; // present when this entry IS a tool result; see below
  sourceToolUseID?: string;        // tool_use_id the result belongs to
  sourceToolAssistantUUID?: string;
  promptId?: string;               // present only on real user prompts (not on tool results)
  /* + envelope fields from the table above */
}

type UserContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string | { type: "text"; text: string }[];
      is_error?: boolean;
    };
```

### `toolUseResult` variants

`toolUseResult` is the **structured** result payload (vs. the
text-only one carried inside `content[]`). Different tools produce
different shapes. Five clusters observed in this corpus:

| Tool family    | Keys |
|----------------|------|
| `Bash`         | `interrupted`, `isImage`, `noOutputExpected`, `stderr`, `stdout` |
| `Edit`         | `filePath`, `newString`, `oldString`, `originalFile`, `replaceAll`, `structuredPatch`, `userModified` |
| `Read` (small) | `file`, `type` |
| `Read` (large) | `content`, `filePath`, `originalFile`, `structuredPatch`, `type`, `userModified` |
| `TodoWrite`    | `statusChange`, `success`, `taskId`, `updatedFields` |

`toolUseResult` can also be a plain string (legacy path / simple
text result). Always check `type` before destructuring.

## `assistant.message` shape

```ts
interface AssistantEntry {
  type: "assistant";
  message: {
    role: "assistant";
    id: string;             // LLM message id
    model: string;          // e.g. "claude-opus-4-20250514"
    type: "message";
    stop_reason: string | null;
    stop_sequence: string | null;
    stop_details?: object;
    content: AssistantContentBlock[];
    usage?: TokenUsage;
    container?: object;     // sandbox container state when sandboxing is on
    context_management?: object;
    diagnostics?: object;
  };
  requestId: string;
  isApiErrorMessage?: boolean;
  /* + envelope fields */
}

type AssistantContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | {
      type: "tool_use";
      id: string;            // referenced later by tool_result.tool_use_id
      name: string;          // canonical tool name, see below
      input: object;         // tool-specific shape
    };

interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number };
  output_tokens_details?: object;
  server_tool_use?: { web_search_requests?: number };
  service_tier?: string;
  inference_geo?: string;
}
```

### Tool names

The `name` field on `tool_use` blocks uses CamelCase. Names observed
in the user's actual session pile (run the jq command below to
regenerate this list against your own corpus):

```
Agent, AskUserQuestion, Bash, Edit, EnterWorktree, ExitPlanMode,
ExitWorktree, Monitor, Read, ScheduleWakeup, Skill, TaskCreate,
TaskList, TaskOutput, TaskStop, TaskUpdate, ToolSearch, WebSearch,
Write
```

Additional tools that exist in Claude Code but didn't show up in
this user's recent sessions (kept in `providers/toolLabels.ts` and
the `ICONS` table because they appear on other machines): `Glob`,
`Grep`, `WebFetch`, `TodoWrite`, `NotebookEdit`, `SlashCommand`,
`Task` (legacy name, may have been superseded by `Agent` —
verify if you care).

#### MCP-namespaced tools

Tools provided by MCP servers carry a namespaced name:

```
mcp__<server>__<tool>
e.g. mcp__plugin_Notion_notion__notion-fetch
```

agenthud's parser treats these as opaque labels (passes through to
`ICONS.Default` since the inner tool semantics vary by server).
There's no fixed list — every MCP server the user installs adds
more.

agenthud's `providers/toolLabels.ts` treats Claude's names as the
canonical taxonomy that other providers (Kiro, ...) map into.

## Example record stream

```jsonl
{"type":"system","subtype":"init","timestamp":"2026-06-11T05:00:00.000Z","sessionId":"...","cwd":"...","gitBranch":"main"}
{"type":"user","uuid":"u1","parentUuid":null,"sessionId":"...","message":{"role":"user","content":"Fix the auth bug"},"timestamp":"2026-06-11T05:00:01.000Z","promptId":"p1"}
{"type":"assistant","uuid":"a1","parentUuid":"u1","sessionId":"...","message":{"id":"msg_…","model":"claude-opus-4-20250514","role":"assistant","content":[{"type":"text","text":"Looking at auth.ts."},{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/src/auth.ts"}}],"usage":{"input_tokens":1500,"output_tokens":50}},"timestamp":"2026-06-11T05:00:02.000Z","requestId":"…"}
{"type":"user","uuid":"u2","parentUuid":"a1","sessionId":"...","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"…file contents…"}]},"toolUseResult":{"file":"…","type":"text"},"sourceToolUseID":"t1","timestamp":"2026-06-11T05:00:03.000Z"}
```

## Verify the schema yourself

Run any of these against your own session pile to catch fields this
doc missed:

```bash
# All top-level `type` values observed
cat ~/.claude/projects/*/*.jsonl | jq -r '.type' | sort -u

# All top-level keys
cat ~/.claude/projects/*/*.jsonl | jq -r 'keys[]' | sort -u

# All `system.subtype` values
cat ~/.claude/projects/*/*.jsonl \
  | jq -r 'select(.type=="system") | .subtype // "(none)"' | sort -u

# All assistant content block types
cat ~/.claude/projects/*/*.jsonl \
  | jq -r 'select(.type=="assistant") | .message.content[]?.type' | sort -u

# All distinct `name` values on tool_use blocks (= every tool used)
cat ~/.claude/projects/*/*.jsonl \
  | jq -r 'select(.type=="assistant") | .message.content[]
           | select(.type=="tool_use") | .name' | sort -u

# All `toolUseResult` key combinations (= structured result shapes)
cat ~/.claude/projects/*/*.jsonl \
  | jq -c 'select(.toolUseResult != null
                  and (.toolUseResult | type == "object"))
           | .toolUseResult | keys' | sort -u
```

If any output line surprises you, this doc is wrong — open an issue.

## Notes / caveats

- Files are append-only during a session. Lines are chronological
  by `timestamp`.
- Total token cost = sum of `usage.{input_tokens, output_tokens,
  cache_creation_input_tokens, cache_read_input_tokens}` across
  every assistant line (including subagents).
- A subagent file's `isSidechain: true` distinguishes it from a
  top-level session file (in addition to the path).
- The `lastPrompt` / `slug` / `customTitle` records are
  denormalizations — agenthud doesn't currently consume them.
