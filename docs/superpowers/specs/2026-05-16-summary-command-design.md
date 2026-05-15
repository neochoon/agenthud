# Summary Command Design

## Goal

Add `agenthud summary` subcommand that generates a daily activity summary via the `claude` CLI. The result is cached per date so weekly/monthly aggregation later can re-summarize daily summaries instead of feeding raw activity logs (huge token cost) to the LLM.

## CLI Interface

```bash
agenthud summary                          # today (always regenerate)
agenthud summary --date 2026-05-14        # past date (use cache if exists)
agenthud summary --date 2026-05-14 --force # past date, force regenerate
agenthud summary --prompt "커밋만 요약"   # override prompt for this run
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--date` | today | `YYYY-MM-DD` or `today` |
| `--prompt` | file / built-in | Override prompt for this invocation only |
| `--force` | false | Ignore cache and regenerate |

## Prompt Management

**Priority (highest to lowest):**

1. `--prompt "..."` CLI option
2. `~/.agenthud/summary-prompt.md` (user-editable file)
3. Built-in template at `src/templates/summary-prompt.md`

On first `summary` invocation, copy the built-in template to `~/.agenthud/summary-prompt.md` so users can edit it without needing to know about the template's location.

## Caching

Daily summaries are stored at `~/.agenthud/summaries/YYYY-MM-DD.md`.

| Date | Cache exists | `--force` | Action |
|------|--------------|-----------|--------|
| today | – | – | Always regenerate |
| past | yes | no | Return cached |
| past | yes | yes | Regenerate |
| past | no | – | Regenerate |

Rationale:
- Today's activity is still growing, so caching it would return stale results.
- Past dates are immutable, so caching saves tokens and time.
- Future weekly/monthly aggregation can read `summaries/*.md` files directly to compose meta-summaries.

## File Layout

```
~/.agenthud/
├── config.yaml
├── summary-prompt.md         ← user-editable; auto-created from template
└── summaries/
    ├── 2026-05-14.md
    ├── 2026-05-15.md
    └── ...
```

## Internal Data Source

`summary` calls `generateReport()` with LLM-friendly fixed defaults — these are not user-configurable, because the goal is to feed the LLM the most useful representation:

- `detailLimit: 0` (full content, no truncation)
- `withGit: true` (include commits in the timeline)
- `format: "markdown"`
- `include`: default types (`response`, `bash`, `edit`, `thinking`)

## Architecture

### New file: `src/templates/summary-prompt.md`

Built-in default prompt. Korean, suited for daily activity summarization. Bundled into `dist/templates/` at build time so npm-installed users have access.

### New file: `src/data/summaryRunner.ts`

```typescript
export interface SummaryOptions {
  date: Date;       // local midnight
  prompt?: string;  // override
  force: boolean;
}

export async function runSummary(options: SummaryOptions): Promise<number>;
// Returns the exit code to use for the process.
```

Single responsibility: orchestrate the summary pipeline.

Internal helpers (same file):
- `resolvePrompt(override?: string): string` — prompt priority chain
- `ensureUserPromptFile(): void` — copy template to `~/.agenthud/summary-prompt.md` on first run if missing
- `summariesDir(): string` — returns `~/.agenthud/summaries/`, creates it if missing
- `cachePath(date: Date): string`
- `isToday(date: Date): boolean`

### Modified: `src/cli.ts`

Add `summary` to `CliOptions`:

```typescript
export interface CliOptions {
  mode: "watch" | "once" | "report" | "summary";
  // existing fields
  summaryDate?: Date;
  summaryPrompt?: string;
  summaryForce?: boolean;
  summaryError?: string;
}
```

Parsing rules:
- `agenthud summary` → `mode: "summary"`, date = today local midnight
- `--date YYYY-MM-DD|today` → same logic as `report`
- `--prompt "..."` → set `summaryPrompt`
- `--force` → set `summaryForce: true`
- Unknown flags → `summaryError`

### Modified: `src/main.ts`

Add a `summary` mode branch that calls `runSummary(options)` and uses its return value as the process exit code.

## Data Flow

```
parseArgs() → mode: "summary", date, prompt?, force?
  ↓
main.ts: summary mode
  ↓
runSummary(options)
  │
  ├─ ensureUserPromptFile()         // first-run copy
  │
  ├─ cache hit? (not today AND file exists AND !force)
  │   ├─ yes → write cache to stdout, exit 0
  │   └─ no → continue
  │
  ├─ loadGlobalConfig() + discoverSessions()
  ├─ generateReport(sessions, { detailLimit: 0, withGit: true, ... })
  ├─ resolvePrompt(options.prompt)
  ├─ spawn("claude", ["-p", prompt], { stdio: ["pipe", "pipe", "inherit"] })
  ├─ write report to claude.stdin, close stdin
  ├─ tee claude.stdout → process.stdout + cache file write stream
  └─ on claude exit:
        if exit code 0 → exit 0
        else → detect auth error in stderr, print hint, exit claude's code
```

## Error Handling

| Condition | Detection | Message |
|-----------|-----------|---------|
| `claude` not found | spawn `ENOENT` | `Error: claude CLI not found. Install: npm i -g @anthropic-ai/claude-code` (stderr, exit 1) |
| `claude` not authenticated | exit ≠ 0 + stderr contains `not authenticated` / `login` / `auth` | `Error: claude is not authenticated. Run: claude` (stderr, exit code from claude) |
| Other claude failure | exit ≠ 0 | Pass through claude's stderr; exit with same code |
| Prompt file write fails | EACCES, EPERM | Ignore — fall back to built-in. Continue summary. |
| Cache file write fails | EACCES, EPERM | Print warning to stderr; still emit to stdout. Exit 0 if claude succeeded. |
| Cache file read fails | EACCES, ENOENT | Treat as cache miss, regenerate. |

## Output Behavior

- Streams `claude -p` stdout in real-time (no buffering)
- Simultaneously writes to cache file via tee pattern
- On error path, stdout gets nothing partial (we only commit to cache once claude exits successfully)

## Help Text

`agenthud --help` gains a new section:

```
Commands:
  report [...]            (existing)
  summary [--date DATE] [--prompt TEXT] [--force]
                          Generate LLM summary of daily activity
    --date YYYY-MM-DD|today  Date to summarize
    --prompt TEXT            Override built-in prompt
    --force                  Regenerate even if cached
```

## Testing

- `tests/data/summaryRunner.test.ts`
  - Cache hit returns cached content without spawning claude
  - Today always bypasses cache
  - `--force` bypasses cache for past dates
  - Prompt resolution: `--prompt` > file > template
  - Builds report with correct LLM-friendly options (mock generateReport, assert call args)
  - Spawn claude with correct args (mock child_process)
  - Tee writes to both stdout and cache file
  - `claude` ENOENT → friendly error
  - claude exit ≠ 0 with auth keywords → auth hint
- `tests/cli.test.ts`
  - `summary` subcommand parsing for all options
  - Error cases (invalid date, unknown flag)
- No integration test calling real `claude`; only mocked spawn.

## Out of Scope (Future Work)

- `--since` / `--from/--to` for multi-day summary
- Weekly/monthly meta-summary that reads `summaries/*.md`
- Non-claude LLM providers
- Custom output paths for cache
