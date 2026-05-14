# Report Command Design

## Goal

Add `agenthud report` subcommand that outputs a Markdown summary of all Claude Code activity on a given date to stdout. Output is intended for consumption by scripts that feed it to an LLM.

## CLI Interface

```bash
# Today (default)
agenthud report

# Specific date
agenthud report --date 2026-05-14

# All activity types
agenthud report --date 2026-05-14 --include all

# Specific types
agenthud report --date 2026-05-14 --include response,edit
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `--date` | today | `YYYY-MM-DD` or `today` |
| `--include` | `response,bash,edit,thinking` | Comma-separated activity types, or `all` |

**Valid activity types:** `response`, `bash`, `edit`, `thinking`, `read`, `glob`, `user`

## Output Format

Plain text, Markdown-compatible, written to stdout.

```markdown
# AgentHUD Report: 2026-05-14

## agenthud (10:23 – 14:45)

[10:23] $ npm test
[10:35] ~ src/ui/App.tsx
[11:02] … Thinking about the layout bug...
[11:15] < Added spinner hook to make the UI feel alive.

## dotfiles (09:15 – 09:42)

[09:15] ~ .zshrc
[09:22] < Updated git aliases.
```

**Rules:**
- Sessions sorted by first activity timestamp (ascending)
- Sub-agents rendered under their parent as `### sub-agent: {taskDescription}`
- Each line: `[HH:MM] {icon} {detail truncated to 120 chars}`
- If no sessions match the date, print a single line: `No activity found for {date}.`
- Time range in session header = first to last activity timestamp on that date

## Architecture

### New file: `src/data/reportGenerator.ts`

Single responsibility: given sessions + config, produce a Markdown string.

```typescript
export interface ReportOptions {
  date: Date;           // start of target day (UTC midnight)
  include: string[];    // activity types to include
}

export function generateReport(
  sessions: SessionNode[],
  options: ReportOptions,
): string
```

Internally:
1. Filter sessions: include if JSONL mtime is on target date OR any activity timestamp is on target date
2. For each matching session, call `parseSessionHistory(filePath)`
3. Filter activities to target date + included types
4. Sort sessions by first activity timestamp
5. Format as Markdown

### Modified: `src/cli.ts`

Add `report` to `CliOptions`:

```typescript
export interface CliOptions {
  mode: "watch" | "once" | "report";
  command?: "version" | "help";
  reportDate?: Date;        // UTC midnight of target day
  reportInclude?: string[]; // activity types
}
```

Parsing rules:
- `agenthud report` → `mode: "report"`, date = today UTC midnight
- `--date YYYY-MM-DD` → parse to UTC midnight Date
- `--date today` → today UTC midnight
- `--include all` → all known activity types
- `--include response,bash` → `["response", "bash"]`
- Invalid date → print error to stderr, exit 1

### Modified: `src/main.ts`

Add report mode branch:

```typescript
if (opts.mode === "report") {
  const config = loadGlobalConfig();
  const sessions = discoverSessions(config);  // returns all sessions (no hidden filter needed)
  const markdown = generateReport(sessions.sessions, {
    date: opts.reportDate!,
    include: opts.reportInclude!,
  });
  process.stdout.write(markdown + "\n");
  process.exit(0);
}
```

Note: `discoverSessions` respects `hiddenSessions` config. For the report, hidden sessions are still excluded (consistent with what the user sees in the UI).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Path to Claude Code projects directory. Use for backups or mounted volumes. |

`getProjectsDir()` in `src/data/sessions.ts` reads this variable first and falls back to the default. Applies to all modes (watch, once, report).

The help text (`--help`) should document this variable.

## Date Filtering Logic

A session is included in the report if **either**:
- The JSONL file's mtime falls on the target date (local timezone, since mtime is local)
- At least one activity's timestamp falls on the target date (UTC, since JSONL timestamps are UTC)

Activity-level date filter uses UTC to match JSONL timestamp format.

## Testing

- `src/data/reportGenerator.ts`: unit tests for date filtering, type filtering, Markdown output format
- `src/cli.ts`: unit tests for `--date` and `--include` parsing, error cases
- No integration tests needed (uses already-tested `parseSessionHistory`)
