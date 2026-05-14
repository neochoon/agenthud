# Report Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `agenthud report` subcommand that prints a Markdown summary of Claude Code activity for a given date to stdout, and support `CLAUDE_PROJECTS_DIR` env var for custom projects directory.

**Architecture:** Three independent changes: (1) `getProjectsDir()` reads `CLAUDE_PROJECTS_DIR` env var, (2) `reportGenerator.ts` filters sessions by date and formats Markdown, (3) `cli.ts` + `main.ts` wire up the `report` subcommand.

**Tech Stack:** TypeScript, Node.js, Vitest. No new dependencies.

---

## File Structure

| File | Change |
|------|--------|
| `src/data/sessions.ts` | Modify `getProjectsDir()` to read `CLAUDE_PROJECTS_DIR` |
| `src/data/reportGenerator.ts` | **Create** — date filtering + Markdown generation |
| `src/cli.ts` | Add `report` mode + `--date` / `--include` parsing |
| `src/main.ts` | Add report mode branch |
| `tests/data/sessions.test.ts` | Add env var test |
| `tests/data/reportGenerator.test.ts` | **Create** — unit tests |
| `tests/cli.test.ts` | Add report parsing tests |

---

## Task 1: CLAUDE_PROJECTS_DIR env var

**Files:**
- Modify: `src/data/sessions.ts:13-15`
- Modify: `tests/data/sessions.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/data/sessions.test.ts` inside `describe("discoverSessions")`:

```typescript
it("uses CLAUDE_PROJECTS_DIR env var when set", () => {
  const customDir = "/custom/projects";
  process.env.CLAUDE_PROJECTS_DIR = customDir;

  vi.mocked(existsSync).mockReturnValue(false);

  const tree = discoverSessions(mockConfig);
  // existsSync should have been called with the custom dir
  expect(vi.mocked(existsSync)).toHaveBeenCalledWith(customDir);
  expect(tree.sessions).toHaveLength(0);

  delete process.env.CLAUDE_PROJECTS_DIR;
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/data/sessions.test.ts
```

Expected: FAIL — `existsSync` called with default path, not `/custom/projects`.

- [ ] **Step 3: Implement**

In `src/data/sessions.ts`, replace:

```typescript
export function getProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
}
```

With:

```typescript
export function getProjectsDir(): string {
  return process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/data/sessions.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/data/sessions.ts tests/data/sessions.test.ts
git commit -m "feat: support CLAUDE_PROJECTS_DIR env var for custom projects directory"
```

---

## Task 2: reportGenerator — date filtering and Markdown output

**Files:**
- Create: `src/data/reportGenerator.ts`
- Create: `tests/data/reportGenerator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/data/reportGenerator.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "../../src/types/index.js";
import type { SessionNode } from "../../src/types/index.js";

vi.mock("../../src/data/sessionHistory.js", () => ({
  parseSessionHistory: vi.fn(),
}));
vi.mock("node:fs", () => ({
  statSync: vi.fn(),
  existsSync: vi.fn(),
}));

const { parseSessionHistory } = await import("../../src/data/sessionHistory.js");
const { statSync } = await import("node:fs");
const { generateReport } = await import("../../src/data/reportGenerator.js");

const DAY = new Date("2026-05-14T00:00:00.000Z"); // UTC midnight

function makeSession(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: "abc123",
    hideKey: "myproject/abc123",
    filePath: "/home/.claude/projects/-myproject/abc123.jsonl",
    projectPath: "/Users/neo/myproject",
    projectName: "myproject",
    lastModifiedMs: new Date("2026-05-14T10:00:00Z").getTime(),
    status: "hot",
    modelName: null,
    subAgents: [],
    ...overrides,
  };
}

function makeActivity(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    timestamp: new Date("2026-05-14T10:23:00Z"),
    type: "tool",
    icon: "$",
    label: "Bash",
    detail: "npm test",
    ...overrides,
  };
}

describe("generateReport", () => {
  it("returns no-activity message when no sessions match the date", () => {
    vi.mocked(statSync).mockReturnValue({ mtimeMs: new Date("2026-05-13T10:00:00Z").getTime() } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([]);

    const result = generateReport([makeSession()], { date: DAY, include: ["response", "bash", "edit", "thinking"] });
    expect(result).toBe("No activity found for 2026-05-14.");
  });

  it("includes session with activity on target date", () => {
    vi.mocked(statSync).mockReturnValue({ mtimeMs: new Date("2026-05-14T10:00:00Z").getTime() } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({ type: "response", icon: "<", label: "Response", detail: "Did the thing." }),
    ]);

    const result = generateReport([makeSession()], { date: DAY, include: ["response"] });
    expect(result).toContain("## myproject");
    expect(result).toContain("[10:23] < Response: Did the thing.");
  });

  it("excludes activities not on target date", () => {
    vi.mocked(statSync).mockReturnValue({ mtimeMs: new Date("2026-05-14T10:00:00Z").getTime() } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({ timestamp: new Date("2026-05-13T09:00:00Z"), type: "response", icon: "<", label: "Response", detail: "Yesterday." }),
      makeActivity({ timestamp: new Date("2026-05-14T11:00:00Z"), type: "response", icon: "<", label: "Response", detail: "Today." }),
    ]);

    const result = generateReport([makeSession()], { date: DAY, include: ["response"] });
    expect(result).not.toContain("Yesterday.");
    expect(result).toContain("Today.");
  });

  it("excludes activity types not in include list", () => {
    vi.mocked(statSync).mockReturnValue({ mtimeMs: new Date("2026-05-14T10:00:00Z").getTime() } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({ type: "tool", icon: "○", label: "Read", detail: "some/file.ts" }),
      makeActivity({ type: "response", icon: "<", label: "Response", detail: "Done." }),
    ]);

    const result = generateReport([makeSession()], { date: DAY, include: ["response"] });
    expect(result).not.toContain("Read");
    expect(result).toContain("Done.");
  });

  it("truncates detail to 120 chars", () => {
    vi.mocked(statSync).mockReturnValue({ mtimeMs: new Date("2026-05-14T10:00:00Z").getTime() } as ReturnType<typeof statSync>);
    const longDetail = "x".repeat(200);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({ type: "response", icon: "<", label: "Response", detail: longDetail }),
    ]);

    const result = generateReport([makeSession()], { date: DAY, include: ["response"] });
    expect(result).toContain("x".repeat(120));
    expect(result).not.toContain("x".repeat(121));
  });

  it("includes report header with date", () => {
    vi.mocked(statSync).mockReturnValue({ mtimeMs: new Date("2026-05-14T10:00:00Z").getTime() } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({ type: "response", icon: "<", label: "Response", detail: "Done." }),
    ]);

    const result = generateReport([makeSession()], { date: DAY, include: ["response"] });
    expect(result).toContain("# AgentHUD Report: 2026-05-14");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/data/reportGenerator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/data/reportGenerator.ts`**

```typescript
import { statSync } from "node:fs";
import type { ActivityEntry, SessionNode } from "../types/index.js";
import { parseSessionHistory } from "./sessionHistory.js";

export interface ReportOptions {
  date: Date;       // UTC midnight of target day
  include: string[]; // activity types: "response" | "bash" | "edit" | "thinking" | "read" | "user" | "glob"
}

// Map activity label to type bucket for --include filtering
function activityMatchesInclude(activity: ActivityEntry, include: string[]): boolean {
  const label = activity.label.toLowerCase();
  const type = activity.type;
  if (include.includes("response") && type === "response") return true;
  if (include.includes("thinking") && type === "thinking") return true;
  if (include.includes("user") && type === "user") return true;
  if (include.includes("bash") && label === "bash") return true;
  if (include.includes("edit") && (label === "edit" || label === "write" || label === "todowrite")) return true;
  if (include.includes("read") && (label === "read" || label === "glob" || label === "grep")) return true;
  if (include.includes("glob") && (label === "glob" || label === "grep")) return true;
  return false;
}

function isSameUTCDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function formatTime(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function formatActivity(activity: ActivityEntry): string {
  const time = formatTime(activity.timestamp);
  const detail = activity.detail.length > 120
    ? activity.detail.slice(0, 120)
    : activity.detail;
  const suffix = detail ? `: ${detail}` : "";
  return `[${time}] ${activity.icon} ${activity.label}${suffix}`;
}

function formatDateString(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function sessionIsOnDate(session: SessionNode, date: Date, activities: ActivityEntry[]): boolean {
  // Check file mtime (local time comparison via UTC day)
  try {
    const mtime = new Date(statSync(session.filePath).mtimeMs);
    if (isSameUTCDay(mtime, date)) return true;
  } catch {
    // ignore stat errors
  }
  // Check any activity timestamp
  return activities.some((a) => isSameUTCDay(a.timestamp, date));
}

export function generateReport(sessions: SessionNode[], options: ReportOptions): string {
  const { date, include } = options;
  const dateStr = formatDateString(date);

  type SessionBlock = { session: SessionNode; activities: ActivityEntry[]; firstTime: number };
  const blocks: SessionBlock[] = [];

  for (const session of sessions) {
    const allActivities = parseSessionHistory(session.filePath);
    if (!sessionIsOnDate(session, date, allActivities)) continue;

    const dayActivities = allActivities
      .filter((a) => isSameUTCDay(a.timestamp, date))
      .filter((a) => activityMatchesInclude(a, include));

    if (dayActivities.length === 0) continue;

    blocks.push({
      session,
      activities: dayActivities,
      firstTime: dayActivities[0].timestamp.getTime(),
    });
  }

  if (blocks.length === 0) {
    return `No activity found for ${dateStr}.`;
  }

  blocks.sort((a, b) => a.firstTime - b.firstTime);

  const lines: string[] = [`# AgentHUD Report: ${dateStr}`, ""];

  for (const { session, activities } of blocks) {
    const first = formatTime(activities[0].timestamp);
    const last = formatTime(activities[activities.length - 1].timestamp);
    lines.push(`## ${session.projectName} (${first} – ${last})`);
    lines.push("");
    for (const activity of activities) {
      lines.push(formatActivity(activity));
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/data/reportGenerator.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/data/reportGenerator.ts tests/data/reportGenerator.test.ts
git commit -m "feat: add reportGenerator — date filtering and Markdown output"
```

---

## Task 3: CLI parsing for report subcommand

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Write failing tests**

Open `tests/cli.test.ts` and add inside the existing `describe("parseArgs")` block:

```typescript
describe("report subcommand", () => {
  it("returns report mode with today when no date given", () => {
    const opts = parseArgs(["report"]);
    expect(opts.mode).toBe("report");
    expect(opts.reportDate).toBeDefined();
    // should be today UTC midnight
    const today = new Date();
    expect(opts.reportDate!.getUTCFullYear()).toBe(today.getUTCFullYear());
    expect(opts.reportDate!.getUTCMonth()).toBe(today.getUTCMonth());
    expect(opts.reportDate!.getUTCDate()).toBe(today.getUTCDate());
  });

  it("parses --date YYYY-MM-DD", () => {
    const opts = parseArgs(["report", "--date", "2026-05-14"]);
    expect(opts.mode).toBe("report");
    expect(opts.reportDate!.getUTCFullYear()).toBe(2026);
    expect(opts.reportDate!.getUTCMonth()).toBe(4); // May = 4
    expect(opts.reportDate!.getUTCDate()).toBe(14);
  });

  it("parses --date today", () => {
    const opts = parseArgs(["report", "--date", "today"]);
    expect(opts.mode).toBe("report");
    const today = new Date();
    expect(opts.reportDate!.getUTCDate()).toBe(today.getUTCDate());
  });

  it("uses default include types when --include not given", () => {
    const opts = parseArgs(["report"]);
    expect(opts.reportInclude).toEqual(["response", "bash", "edit", "thinking"]);
  });

  it("parses --include all", () => {
    const opts = parseArgs(["report", "--include", "all"]);
    expect(opts.reportInclude).toEqual(["response", "bash", "edit", "thinking", "read", "glob", "user"]);
  });

  it("parses --include response,edit", () => {
    const opts = parseArgs(["report", "--include", "response,edit"]);
    expect(opts.reportInclude).toEqual(["response", "edit"]);
  });

  it("returns error for invalid date", () => {
    const opts = parseArgs(["report", "--date", "not-a-date"]);
    expect(opts.mode).toBe("report");
    expect(opts.reportError).toContain("Invalid date");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/cli.test.ts
```

Expected: FAIL — `reportDate`, `reportInclude`, `reportError` not on `CliOptions`.

- [ ] **Step 3: Implement**

Replace `src/cli.ts` entirely:

```typescript
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ALL_TYPES = ["response", "bash", "edit", "thinking", "read", "glob", "user"];
const DEFAULT_TYPES = ["response", "bash", "edit", "thinking"];

export interface CliOptions {
  mode: "watch" | "once" | "report";
  command?: "version" | "help";
  reportDate?: Date;
  reportInclude?: string[];
  reportError?: string;
}

export function getHelp(): string {
  return `Usage: agenthud [options]

Monitors all running Claude Code sessions in real-time.

Options:
  -w, --watch                   Watch mode (default) — live updates
  --once                        Print once and exit
  -V, --version                 Show version number
  -h, --help                    Show this help message

Commands:
  report [--date DATE] [--include TYPES]
                                Print activity report for a date (default: today)
    --date YYYY-MM-DD|today     Date to report on
    --include TYPES             Comma-separated types or "all"
                                Types: response,bash,edit,thinking,read,glob,user
                                Default: response,bash,edit,thinking

Environment:
  CLAUDE_PROJECTS_DIR           Path to Claude projects directory
                                (default: ~/.claude/projects)

Config: ~/.agenthud/config.yaml
Logs:   ~/.agenthud/logs/
`;
}

export function getVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const packageJson = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
  );
  return packageJson.version;
}

export function clearScreen(): void {
  console.clear();
}

function parseUTCMidnight(dateStr: string): Date | null {
  if (dateStr === "today") {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function todayUTCMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function parseArgs(args: string[]): CliOptions {
  if (args.includes("--help") || args.includes("-h")) {
    return { mode: "watch", command: "help" };
  }
  if (args.includes("--version") || args.includes("-V")) {
    return { mode: "watch", command: "version" };
  }
  if (args.includes("--once")) {
    return { mode: "once" };
  }

  if (args[0] === "report") {
    const rest = args.slice(1);
    let reportDate = todayUTCMidnight();
    let reportInclude = DEFAULT_TYPES;
    let reportError: string | undefined;

    const dateIdx = rest.indexOf("--date");
    if (dateIdx !== -1) {
      const dateStr = rest[dateIdx + 1];
      if (!dateStr) {
        reportError = "Invalid date: missing value for --date";
      } else {
        const parsed = parseUTCMidnight(dateStr);
        if (!parsed) {
          reportError = `Invalid date: "${dateStr}". Use YYYY-MM-DD or "today".`;
        } else {
          reportDate = parsed;
        }
      }
    }

    const includeIdx = rest.indexOf("--include");
    if (includeIdx !== -1) {
      const includeStr = rest[includeIdx + 1];
      if (includeStr === "all") {
        reportInclude = ALL_TYPES;
      } else if (includeStr) {
        reportInclude = includeStr.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }

    return { mode: "report", reportDate, reportInclude, reportError };
  }

  return { mode: "watch" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/cli.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "feat: add report subcommand parsing to CLI"
```

---

## Task 4: Wire report mode in main.ts

**Files:**
- Modify: `src/main.ts`

No new tests needed — `main.ts` is a thin orchestrator that composes already-tested functions. Manual verification suffices.

- [ ] **Step 1: Add report mode branch to `src/main.ts`**

Add the following imports at the top of `src/main.ts` (after existing imports):

```typescript
import { loadGlobalConfig } from "./config/globalConfig.js";
import { discoverSessions } from "./data/sessions.js";
import { generateReport } from "./data/reportGenerator.js";
```

Then add this block **before** the `if (options.mode === "watch")` line:

```typescript
if (options.mode === "report") {
  if (options.reportError) {
    process.stderr.write(`agenthud: ${options.reportError}\n`);
    process.exit(1);
  }
  const config = loadGlobalConfig();
  const tree = discoverSessions(config);
  const markdown = generateReport(tree.sessions, {
    date: options.reportDate!,
    include: options.reportInclude!,
  });
  process.stdout.write(`${markdown}\n`);
  process.exit(0);
}
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Smoke test manually**

```bash
npm run build && node dist/index.js report --date today
```

Expected: Markdown output to stdout with today's activity, or `No activity found for YYYY-MM-DD.`

```bash
node dist/index.js report --date 2026-05-14
```

Expected: Markdown output for that date.

```bash
node dist/index.js report --date bad
```

Expected: stderr `agenthud: Invalid date: "bad"...` and exit code 1.

```bash
CLAUDE_PROJECTS_DIR=/tmp node dist/index.js report
```

Expected: `No activity found for ...` (empty dir).

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire report mode in main.ts"
```

---

## Task 5: Update help text and README

**Files:**
- Modify: `src/cli.ts` (help already updated in Task 3)
- Modify: `README.md`

- [ ] **Step 1: Add report command section to README**

In `README.md`, find the `## Usage` section and add after the existing options table:

```markdown
## Report

Print a Markdown summary of all activity on a given date, suitable for piping to scripts or LLMs:

```bash
agenthud report                          # today
agenthud report --date 2026-05-14        # specific date
agenthud report --date today --include all  # all activity types
```

Output is written to stdout in Markdown format:

```
# AgentHUD Report: 2026-05-14

## myproject (10:23 – 14:45)

[10:23] $ npm test
[10:35] ~ src/ui/App.tsx
[11:15] < Added spinner hook to make the UI feel alive.
```

**`--include` types:** `response`, `bash`, `edit`, `thinking`, `read`, `glob`, `user`  
Default: `response,bash,edit,thinking`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Path to Claude Code projects directory. Useful for backups or mounted volumes. |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add report command and CLAUDE_PROJECTS_DIR to README"
```
