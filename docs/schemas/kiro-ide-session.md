# Kiro IDE Session Files — On-Disk Schema

Empirical schema from a live Kiro IDE (VSCode fork) install on
macOS, including a completed `invokeSubAgent` run. Verification
commands at the bottom.

## File layout

```
<storage-root>/                                  # see platform table
└── User/globalStorage/kiro.kiroagent/
    ├── workspace-sessions/
    │   └── <base64-of-workspace-path>/
    │       ├── sessions.json                    # per-workspace index
    │       └── <session-uuid>.json              # full session, ONE JSON doc
    ├── <profile-hash>/
    │   ├── <index-hash>                         # executions index
    │   └── <dir-hash>/
    │       └── <execution-hash>                 # one file per execution
    └── dev_data/
        └── tokens_generated.jsonl               # token usage log
```

| Platform | `<storage-root>` |
|---|---|
| macOS    | `~/Library/Application Support/Kiro` |
| Windows  | `%APPDATA%\Kiro` |
| Linux    | `~/.config/Kiro` |

agenthud override: `KIRO_IDE_SESSIONS_DIR` (points directly at the
`workspace-sessions` directory).

The base64 directory name decodes to the absolute workspace path
(e.g. `L1VzZXJzL25lby96aXBzYQ==` → `/Users/neo/zipsa`), but the
`workspaceDirectory` field inside the files is authoritative.

## `sessions.json` — per-workspace index

```json
[
  {
    "sessionId": "cb1a6b5b-c21a-4519-becf-7743cce6b546",
    "title": "Clean State",
    "dateCreated": "1781225776989",
    "workspaceDirectory": "/Users/neo/zipsa"
  }
]
```

`dateCreated` is unix **milliseconds as a string**.

## `<session-uuid>.json` — session state

Single JSON document (not JSONL), rewritten at turn end — its mtime
is stale while a turn is in flight. Key fields:

```ts
interface KiroIdeSession {
  sessionId: string;
  title: string;
  workspaceDirectory: string;
  selectedModel: string;            // "auto" or a pinned model id
  contextUsagePercentage: number;   // float 0..100; no window size in file
  active: boolean;                  // session-open flag; STALE during a run
  sessionType: string;              // "vibe" observed
  history: HistoryEntry[];
  // also: contextItems, config, activeTabs, autonomyMode ("Autopilot"),
  // perSessionModelSelection, contextUsagePercentageBySession,
  // initialContextEstimate, sessionStartHookResultsBySession, ...
}

interface HistoryEntry {
  message: {
    role: "user" | "assistant";
    content: UserContentBlock[] | string;
    // user → array of {type: "text", text} blocks (+ images)
    // assistant → PLAIN STRING
    id: string;
  };
  executionId?: string;     // assistant turns link to an execution
  promptLogs?: unknown;     // assistant-side prompt/tool telemetry
  contextItems?: unknown[];
  editorState?: unknown;    // rich-text editor doc of the prompt
}
```

**No per-entry timestamps in `history[]`.** Real timestamps live in
the execution files.

## Execution files — live tool activity + sub-agents

The executions index (`<profile-hash>/<index-hash>`) lists every run:

```json
{ "executions": [
  { "executionId": "ec90b8bc-…", "type": "chat-agent",
    "status": "succeed" | "running", "startTime": 1781239893081,
    "endTime": 1781240381000 }
] }
```

Each execution's own file (`<dir-hash>/<execution-hash>` — the file
name is a hash, NOT the executionId; you must read the file to map)
contains:

```ts
interface KiroIdeExecution {
  executionId: string;
  workflowType: "chat-agent";
  status: "running" | "succeed";
  startTime: number;                // unix ms
  chatSessionId: string;            // ← joins back to the session uuid
  autonomyMode: string;             // "Autopilot"
  contextUsagePercentage: number;
  usageSummary: { usedTools: string[]; usage: number; unit: "credit" }[];
  input: { data: { messages: [...] } };  // full prompt replay
  actions: AgentExecutionAction[];
}

interface AgentExecutionAction {
  type: "AgentExecutionAction";
  executionId: string;
  actionId: string;
  actionType:
    | "readFiles" | "runCommand" | "say" | "model"
    | "invokeSubAgent" | "subagent_response" | string;
  actionState: "PendingAction" | "Accepted" | "Running" | "Success";
  subExecutionId?: string;   // present on actions belonging to a sub-agent
  input?: unknown;           // e.g. {command, cwd} for runCommand
  output?: unknown;          // e.g. {response, subExecutionId} for invokeSubAgent
  emittedAt?: number;
  endTime?: number;
}
```

### Sub-agents — actions, not files

Unlike Kiro CLI (separate session bundle + `parent_session_id`),
IDE sub-agents live INSIDE the parent's execution file:

1. Parent emits an `invokeSubAgent` action; its `output` carries
   `subExecutionId` and (on completion) the sub-agent's full
   markdown report in `response`.
2. The sub-agent's own steps (`model`, `runCommand`, `say`, ...)
   appear as further actions tagged with that `subExecutionId`.
3. A terminal `subagent_response` action closes the group.

### `PendingAction` — the approval gate

Even in Autopilot mode, `runCommand` actions can park at
`actionState: "PendingAction"` until the user approves in the IDE
UI. Observed live: a sub-agent stuck on `which uv` while the user
thought nothing was happening. Surfacing this state is the planned
follow-up for agenthud's liveness badge.

## What agenthud currently consumes (MVP)

| Signal | Source |
|---|---|
| Project grouping | `workspaceDirectory` |
| Row description | `title` |
| Model | `selectedModel` |
| Context gauge | `contextUsagePercentage` (window unknown → 200K assumed for used/total; only percent rendered) |
| Recency | session `.json` mtime |
| Activities | `history[]` user/assistant text (timestamps unavailable → epoch placeholder) |

Not yet consumed: execution files (tool-level activity, sub-agent
nesting, `PendingAction` badge, real timestamps), `tokens_generated
.jsonl`.

## Verify the schema yourself

```bash
ROOT="$HOME/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent"

# Decode workspace dir names
for d in "$ROOT/workspace-sessions"/*/; do basename "$d" | base64 -d; echo; done

# Index fields
cat "$ROOT/workspace-sessions"/*/sessions.json | jq -r '.[0] | keys[]'

# Session file top-level keys
cat "$ROOT/workspace-sessions"/*/<uuid>.json | jq -r 'keys[]'

# History roles + content types
jq -r '.history[] | "\(.message.role) \(.message.content | type)"' \
  "$ROOT/workspace-sessions"/*/<uuid>.json | sort | uniq -c

# Execution index statuses
jq -r '.executions[] | "\(.type) \(.status)"' "$ROOT"/<profile-hash>/<index-hash> | sort | uniq -c

# Action types + states across an execution file
jq -r '.actions[] | "\(.actionType) \(.actionState)"' \
  "$ROOT"/<profile-hash>/<dir-hash>/<exec-hash> | sort | uniq -c
```

If any output line surprises you, this doc is wrong — open an issue.

## Notes / caveats

- The session `.json` is rewritten wholesale at turn end. Watching
  its mtime misses in-flight activity; the execution file is the
  live signal.
- `active: false` while a turn is running (stale flag). Don't use
  it for liveness; use the executions index `status == "running"`.
- `session_created_reason` does not exist here (that's a CLI field).
- The `<profile-hash>` / `<dir-hash>` directory names are opaque;
  semantics unconfirmed (suspected account/workspace digests).
  Globbing over them works regardless.
