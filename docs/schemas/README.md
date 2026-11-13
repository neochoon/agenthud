# Session File Schemas

Per-provider on-disk schemas for the CLIs agenthud reads. Each doc
is grounded in actual session files (the fields listed are those
observed via `jq` against real corpora) and includes verification
commands at the bottom so you can re-run them against your own
sessions to catch anything we missed.

| Provider     | Doc                                             | Source                                                |
|--------------|-------------------------------------------------|-------------------------------------------------------|
| Claude Code  | [claude-session.md](./claude-session.md)        | `~/.claude/projects/{encoded-path}/{uuid}.jsonl`      |
| Kiro CLI     | [kiro-session.md](./kiro-session.md)            | `~/.kiro/sessions/cli/{uuid}.{json,jsonl,history,lock}` |
| Kiro IDE     | [kiro-ide-session.md](./kiro-ide-session.md)    | `<app-storage>/Kiro/User/globalStorage/kiro.kiroagent/workspace-sessions/` |
| Codex CLI    | [codex-session.md](./codex-session.md)          | `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` |
| opencode     | [opencode-session.md](./opencode-session.md)    | `${XDG_DATA_HOME:-~/.local/share}/opencode/opencode.db` (SQLite, not files) |
| DSH          | [dsh-session.md](./dsh-session.md)              | `<DSH_HOME>/sessions/{encoded-cwd}/{sessionId}/session.v4.jsonl.zstd` (zstd frames) |

> Implemented as providers today: **Claude Code, Kiro CLI, Kiro IDE,
> Codex CLI, opencode, DSH.** DSH needs Node 22.15+ (`node:zlib`
> zstd); on Node 20 it reports itself unavailable rather than
> crashing. opencode needs Node 22 for the same reason (`node:sqlite`).

## How to keep these in sync

When a provider rev drops a new tool, field, or record kind, the
parser in `src/data/providers/<name>.ts` notices it (icon table
miss, type assertion failure, etc.). When that happens, update the
matching doc:

1. Run the verification commands listed at the bottom of the doc
   against your latest session pile.
2. Diff the output against the tables in the doc.
3. Add the new entry, keeping the format (field name, type,
   example, notes).

The verification commands ARE the canonical schema check —
prose tables may drift; `jq | sort -u` doesn't.
