# DSH (DeepSeek Harness) session schema

How `agenthud` reads sessions written by **DeepSeek Harness** (`dsh`).

Everything below is grounded in a real corpus (171 sessions across 25
projects / ~67 MB of logs) and re-verified by the commands at the
bottom — run those against your own `~/.dsh` when a DSH release
changes the format.

## Where sessions live

```
<DSH_HOME>/sessions/<encoded-cwd>/<sessionId>/session.v4.jsonl.zstd
<DSH_HOME>/sessions/<encoded-cwd>/<sessionId>/session.v3.jsonl.zstd   (older builds)
<DSH_HOME>/sessions/<encoded-cwd>/<sessionId>/session.jsonl.zstd      (legacy: v0 records)
```

- `DSH_HOME` defaults to `~/.dsh` (`%USERPROFILE%\.dsh` on Windows).
  `DSH_SESSIONS_DIR` overrides the sessions root outright.
- `<encoded-cwd>` is the working directory with path separators and
  the drive colon replaced by `-`
  (`C:\file\sometime\agenthud` → `--C-file-sometime-agenthud--`). It is
  **only** a grouping hint: the authoritative `cwd` is in the session
  header record, which is what agenthud groups by.
- `<sessionId>` is the session id, usually `session-<uuid>`; delegated
  (sub-agent) sessions sometimes have a bare `<uuid>` directory name.
  The id in the header is authoritative.
- A session directory holds exactly one log. If several are present,
  agenthud picks the highest format version, preferring the
  compressed file at the same version.

## Container format: concatenated zstd frames

The log is JSONL **compressed with zstd**, appended **one frame per
commit batch**. Two consequences:

1. `node:zlib`'s zstd decoder stops after the **first** frame —
   `zstdDecompressSync` *and* `createZstdDecompress` (a 67-frame log
   decodes to 163 of its 825,000 characters). The provider therefore
   walks the frame structure itself (`zstdFrameEnd` in
   `src/data/providers/dsh.ts`, per RFC 8878 §3.1) and decodes each
   frame separately.
2. Frames are **record-aligned**: every one of the 53,321 frames in
   the corpus ends with `\n`, so a decode window that starts on a
   frame boundary starts on a record boundary. A half-written trailing
   frame (a live session mid-append) is detected as "incomplete" and
   skipped until the next poll.

zstd support in `node:zlib` starts at Node 22.15 / 23.8. On Node 20
the provider reports itself unavailable instead of crashing — the same
contract opencode uses for `node:sqlite`.

## Record 1: the session header

Always the first record, always alone in the first frame — that is why
discovery reads only the first frame (~80 ms for the whole corpus,
versus ~3 s to decompress everything).

```json
{
  "type": "session",
  "version": 4,
  "id": "session-9760ce18-7fa0-4d64-ac03-465733b5eed6",
  "createdAt": 1794475253569,
  "cwd": "C:\\file\\sometime\\agenthud",
  "isSeeded": false,
  "delegationDepth": 0,
  "agentPreset": "standard"
}
```

| Field | Type | Notes |
|---|---|---|
| `version` | number | Log format version: `4` today, `3` on older builds, `0` on legacy files. Captured onto `SessionNode.version` as `v<n>` |
| `id` | string | Session id — the tree row's id |
| `createdAt` | number | Epoch **ms** |
| `cwd` | string | Absolute working directory — becomes the project path |
| `parentSession` | string? | Present on delegated sessions; the parent's `id` |
| `origin` | string? | `"subagent"` on delegated sessions |
| `delegationDepth` | number | `0` top-level, `≥1` delegated |
| `agentPreset` | string? | `standard` / `minimal` / … Not used for display |
| `isSeeded` | boolean | Not used |

### How sub-agents are detected

`origin === "subagent"` **or** `delegationDepth > 0`, then nested under
the session whose `id` equals `parentSession`. A child whose parent is
not discoverable (parent deleted, or scoped out by `--cwd`) surfaces at
top level rather than being dropped — same rule as Codex.

## Event records

Every record after the header is `{ type, seq, time, data }` — `time`
is epoch ms, `seq` a monotonically increasing sequence number.

| `type` | Meaning | agenthud maps it to |
|---|---|---|
| `turn/start`, `turn/end` | Turn boundaries (one user prompt = one turn) | skipped |
| `step/start`, `step/end` | Step boundaries inside a turn | skipped |
| `user/message` | A message in the transcript — **not always the human** | `User` when `data.source.kind` is `user` / `user-approval` / `goal` |
| `system/message` | System prompt | skipped |
| `assistant/message` | Model output: `content[]` of `reasoning` / `text` / `tool-call` blocks, plus `usage` | `Thinking`, `Response` |
| `tool/call` | A tool invocation (`name`, `arguments` as a JSON **string**) | `tool` row (canonical label + detail) |
| `tool/result` | The tool's output, linked by `toolCallId` | enriches the matching `tool` row (body, error text) |
| `request/header` | Per-request header: `config.model`, tool list, limits | `modelName` |
| `request/context` | `provider`, `model`, `contextWindow` | (context window fallback) |
| `session/title` | Cached session title | (title comes from the projection cache) |
| `permission/preset`, `sandbox/mode`, `approval/policy` | Runtime policy changes | skipped |
| `command/run`, `command/done` | Slash commands (`/permission …`) | skipped |
| `job/registered`, `job/settled` | Background job lifecycle (pwsh etc.) | skipped |
| `agent/inbox/spliced` | Parent → child message injection | skipped (the same text arrives as `user/message`) |
| `session/end-seed` | Seeding bookkeeping on old sessions | skipped |

### `tool-call` blocks are duplicated

`assistant/message` content contains a `tool-call` block **for every
tool call**, and a separate `tool/call` event mirrors it with the same
`callId`. agenthud parses the **events** only — reading both would
double every tool row in the viewer.

### `user/message` `source.kind`

The human's input is a minority of `user/message` records: DSH also
stores injected context in the same shape.

| `data.source.kind` | Count in the corpus | Shown as `User` |
|---|---|---|
| `user` | 655 | yes |
| `user-approval` | 22 | yes |
| `goal` | 3 | yes |
| `time-context` | 310 | no |
| `runtime-context` | 202 | no |
| `agent-instructions` | 161 | no |
| `skill-catalog` | 137 | no |
| `subagent-settled` | 35 | no |
| `plugin` | 31 | no |
| `agent-message` | 30 | no |
| `tool-jobs` | 18 | no |
| `compact-checkpoint` | 14 | no |
| `model-selection` | 10 | no |
| `instruction-hint` | 9 | no |
| `tool-goal` | 2 | no |
| `working-directory` | 1 | no |

A record with **no** `source` at all is treated as human input (the
plain-prompt case).

### Tool names

DSH's native tool names are snake_case and PowerShell-first:
`pwsh` (5484 calls in the corpus), `read`, `edit`, `write`, `grep`,
`read_image`, `run_code`, `job_output`, `web_search`, `glob`,
`ask_user_question`, `todo_write`, `present`, `subagent`, `web_fetch`,
`send_message`, `bash`, `skill`, …

`toolLabels.ts` canonicalizes them (`pwsh`/`bash`/`exec_command`/
`run_code` → `Bash`, `read_image` → `Read`, `todo_write` → `TodoWrite`,
`ask_user_question` → `AskUserQuestion`, `str_replace_editor` → `Edit`,
`skill` → `Skill`, …) so filters, icons and the report pipeline see the
same taxonomy as every other provider. Unknown names pass through
unchanged.

`read` results wrap the file body:

```
<path>C:\work\a.ts</path>
<type>file</type>
<content>
41: const a = 1;
42: const b = 2;
</content>
```

Each content line already carries a `NN: ` gutter, so the provider
unwraps the block and recovers `startLine` (`readResultFile`) before
handing it to the shared detail-body builder — otherwise the Detail
view would print the line numbers twice.

## Where titles / context gauge / live state come from

DSH keeps a per-session projection cache as **plain JSON**, which is far
cheaper to read than the logs:

```
<DSH_HOME>/storages/session_projcache/sessions/<sessionId>.json
```

| JSON path | Used for |
|---|---|
| `record.rows.title.val` | `firstUserPrompt` (session title, in the user's own language — this corpus is largely CJK) |
| `record.rows.modelSelection.val.lastUsed.model` | `modelName` |
| `record.rows.contextPressure.val.surfaceTokens` ÷ `contextWindow` | `contextUsage` (the context-window gauge) |
| `record.rows.sessionStats.val.openStep` | `liveState`: non-null → `working` |
| `record.rows.sessionStats.val.turns` | (informational) |

It is a **cache**: a session missing from it still renders — just
without title, model or gauge, falling back to the time-based status
ladder. In this corpus 166 of 171 sessions had a cache file.

`liveState` is only assigned inside the same 30-minute recency window
the other providers use. A sub-agent never reports `waiting` (it is
one-shot), so it falls back to the time ladder unless a step is open.

## Verification commands

Run these against your own corpus. On Windows, `Get-Content` cannot
read the compressed logs — use the Node one-liners, which work
everywhere and are the canonical check:

```bash
# 1. Every log's header record (id / cwd / parent / depth)
node -e '
const fs=require("node:fs"),path=require("node:path"),zlib=require("node:zlib");
const root=process.env.DSH_HOME+"/sessions";
for(const p of fs.readdirSync(root))for(const s of fs.readdirSync(path.join(root,p))){
  const dir=path.join(root,p,s);let f;try{f=fs.readdirSync(dir).find(x=>x.endsWith(".jsonl.zstd"))}catch{continue}
  if(!f)continue;
  const b=fs.readFileSync(path.join(dir,f)),i=b.indexOf(Buffer.from([0x28,0xb5,0x2f,0xfd]));
  const j=b.indexOf(Buffer.from([0x28,0xb5,0x2f,0xfd]),i+4);
  const t=zlib.zstdDecompressSync(b.subarray(i,j<0?b.length:j)).toString().split("\n")[0];
  console.log(t);
}'

# 2. Event-type census (catches a new record kind)
#    Decode with `node -e` frame-by-frame — see src/data/providers/dsh.ts
#    `listZstdFrames` for the exact walk — then count `JSON.parse(l).type`.

# 3. Which messages are the human's
grep -c . # (after decoding) tally `data.source.kind` on `user/message`

# 4. Projection-cache keys
node -e '
const fs=require("node:fs");
const d=process.env.DSH_HOME+"/storages/session_projcache/sessions";
const j=JSON.parse(fs.readFileSync(d+"/"+fs.readdirSync(d)[0],"utf8"));
console.log(Object.keys(j.record.rows));'
```

What to check when a DSH release changes something:

1. Step 1 still prints a `{"type":"session",…}` line for every log —
   if it does not, the first frame no longer holds the header and
   `readDshSessionHead` needs a new strategy.
2. Step 2's census matches the event table above. A new `type` is
   either harmless (skip it) or needs a mapping.
3. Step 4's row names still match the projection-cache table — DSH
   bumps `version` on the cache file (7 today) when these change.
