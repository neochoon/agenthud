# AgentHUD v0.8 — Global Agent Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign AgentHUD as a global agent monitor — run it anywhere, auto-detect all Claude Code sessions system-wide, show parent/sub-agent trees, and provide a scrollable full-history viewer.

**Architecture:** Three new data modules (`activityParser.ts`, `sessions.ts`, `sessionHistory.ts`) and one config module (`globalConfig.ts`) feed two new UI panels (`SessionTreePanel`, `ActivityViewerPanel`) in a rewritten split-view `App.tsx`. All project-scoped panels and config are removed.

**Tech Stack:** Node.js ESM, TypeScript 5, Ink 6 (React for CLI), Vitest 4, ink-testing-library, yaml (already in deps)

---

## File Map

### Create
| File | Responsibility |
|---|---|
| `src/data/activityParser.ts` | Pure JSONL parsing utilities (extracted from claude.ts) |
| `src/data/sessions.ts` | Discover all sessions + sub-agent relationships from `~/.claude/projects/` |
| `src/data/sessionHistory.ts` | Parse full (untruncated) ActivityEntry[] from a JSONL file |
| `src/config/globalConfig.ts` | Parse `~/.agenthud/config.yaml`; return defaults if absent |
| `src/ui/SessionTreePanel.tsx` | Top pane: tree of all sessions with keyboard nav |
| `src/ui/ActivityViewerPanel.tsx` | Bottom pane: scrollable history with live/paused mode |
| `tests/data/activityParser.test.ts` | Unit tests for activity parsing |
| `tests/data/sessions.test.ts` | Unit tests for session discovery |
| `tests/data/sessionHistory.test.ts` | Unit tests for history parsing |
| `tests/config/globalConfig.test.ts` | Unit tests for config loading |
| `tests/ui/SessionTreePanel.test.tsx` | UI tests for tree panel |
| `tests/ui/ActivityViewerPanel.test.tsx` | UI tests for viewer panel |

### Rewrite
| File | Change |
|---|---|
| `src/types/index.ts` | Add `SessionNode`, `SessionTree`, `GlobalConfig`; remove old panel types |
| `src/ui/App.tsx` | Complete rewrite: split view, focus management, keyboard routing |
| `src/cli.ts` | Remove `init` command and `--dir` flag; simplify help text |
| `tests/ui/App.test.tsx` | Rewrite for new App |

### Delete (with their tests)
`src/data/git.ts`, `src/data/tests.ts`, `src/data/project.ts`, `src/data/otherSessions.ts`,
`src/data/detectTestFramework.ts`, `src/data/custom.ts`, `src/data/sessionAvailability.ts`,
`src/data/claude.ts`, `src/runner/command.ts`, `src/config/parser.ts`, `src/commands/init.ts`,
`src/ui/GitPanel.tsx`, `src/ui/TestPanel.tsx`, `src/ui/ProjectPanel.tsx`,
`src/ui/OtherSessionsPanel.tsx`, `src/ui/GenericPanel.tsx`, `src/ui/WelcomePanel.tsx`,
`src/ui/hooks/usePanelData.ts`, `src/ui/hooks/useVisualFeedback.ts`, `src/ui/hooks/useCountdown.ts`,
and all their corresponding test files.

### Keep Unchanged
`src/ui/constants.ts`, `src/utils/nodeVersion.ts`, `src/utils/performance.ts`,
`src/ui/hooks/useHotkeys.ts` (will be updated in Task 8)

---

## Task 1: Add new types to `src/types/index.ts`

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Replace the file contents with new types**

```typescript
// src/types/index.ts

// Session status
export type SessionStatus = "running" | "idle" | "done";

// A single Claude session node (top-level or sub-agent)
export interface SessionNode {
  id: string;               // UUID from JSONL filename (without .jsonl)
  filePath: string;         // absolute path to .jsonl file
  projectPath: string;      // decoded project path (e.g. /Users/neo/myproject)
  projectName: string;      // basename(projectPath)
  lastModifiedMs: number;   // file mtime in ms
  status: SessionStatus;
  modelName: string | null; // e.g. "sonnet-4.6", null if not yet known
  subAgents: SessionNode[]; // direct sub-agents of this session
}

// Full session tree returned by discoverSessions()
export interface SessionTree {
  sessions: SessionNode[];  // top-level sessions only (sub-agents are nested)
  totalCount: number;       // total including all sub-agents
  timestamp: string;        // ISO timestamp of discovery
}

// Global config (~/.agenthud/config.yaml)
export interface GlobalConfig {
  refreshIntervalMs: number;  // default: 2000
  sessionTimeoutMs: number;   // sessions older than this are "done"; default: 30 * 60 * 1000
  logDir: string;             // default: ~/.agenthud/logs
}

// Centralized icon definitions
export const ICONS = {
  User: ">",
  Response: "<",
  Edit: "~",
  Write: "~",
  Read: "○",
  Bash: "$",
  Glob: "*",
  Grep: "*",
  WebFetch: "@",
  WebSearch: "@",
  Task: "»",
  TodoWrite: "~",
  AskUserQuestion: "?",
  Default: "$",
} as const;

// Activity entry (single item in a session's history)
export interface ActivityEntry {
  timestamp: Date;
  type: "tool" | "response" | "user";
  icon: string;
  label: string;
  detail: string;
  count?: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles (no need to run tests yet — dependent modules don't exist yet)**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: errors about missing modules (git.ts, claude.ts, etc.) — that's fine. No errors in `types/index.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "refactor: replace types with SessionNode, SessionTree, GlobalConfig for v0.8"
```

---

## Task 2: Create `src/data/activityParser.ts`

Pure JSONL parsing utilities extracted from `claude.ts`. No file I/O side effects — takes file content as a string.

**Files:**
- Create: `src/data/activityParser.ts`
- Create: `tests/data/activityParser.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/data/activityParser.test.ts
import { describe, expect, it } from "vitest";
import {
  parseModelName,
  parseActivitiesFromLines,
  getToolDetail,
} from "../../src/data/activityParser.js";

describe("parseModelName", () => {
  it("parses sonnet model ID", () => {
    expect(parseModelName("claude-sonnet-4-20250514")).toBe("sonnet-4");
  });

  it("parses opus model ID", () => {
    expect(parseModelName("claude-opus-4-5-20251101")).toBe("opus-4.5");
  });

  it("parses haiku model ID", () => {
    expect(parseModelName("claude-3-5-haiku-20241022")).toBe("haiku-3.5");
  });

  it("strips date suffix as fallback", () => {
    expect(parseModelName("claude-unknown-20250101")).toBe("claude-unknown");
  });
});

describe("getToolDetail", () => {
  it("returns command for Bash", () => {
    expect(getToolDetail("Bash", { command: "npm test" })).toBe("npm test");
  });

  it("returns basename for file_path", () => {
    expect(getToolDetail("Read", { file_path: "/src/auth.ts" })).toBe("auth.ts");
  });

  it("returns empty string when no input", () => {
    expect(getToolDetail("Task", undefined)).toBe("");
  });
});

describe("parseActivitiesFromLines", () => {
  const lines = [
    JSON.stringify({
      type: "system",
      subtype: "init",
      timestamp: "2025-01-15T10:00:00.000Z",
    }),
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "Fix the bug" },
      timestamp: "2025-01-15T10:00:01.000Z",
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-sonnet-4-20250514",
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "/src/auth.ts" } },
        ],
        usage: { input_tokens: 100, output_tokens: 20 },
      },
      timestamp: "2025-01-15T10:00:02.000Z",
    }),
  ];

  it("parses user message", () => {
    const result = parseActivitiesFromLines(lines);
    const userActivity = result.activities.find((a) => a.type === "user");
    expect(userActivity?.detail).toBe("Fix the bug");
  });

  it("parses tool use", () => {
    const result = parseActivitiesFromLines(lines);
    const toolActivity = result.activities.find((a) => a.label === "Read");
    expect(toolActivity?.detail).toBe("auth.ts");
  });

  it("accumulates token count", () => {
    const result = parseActivitiesFromLines(lines);
    expect(result.tokenCount).toBe(120);
  });

  it("extracts model name", () => {
    const result = parseActivitiesFromLines(lines);
    expect(result.modelName).toBe("sonnet-4");
  });

  it("skips TodoWrite activities", () => {
    const todoLines = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "TodoWrite", input: {} }],
        },
        timestamp: "2025-01-15T10:00:00.000Z",
      }),
    ];
    const result = parseActivitiesFromLines(todoLines);
    expect(result.activities.filter((a) => a.label === "TodoWrite")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/data/activityParser.test.ts 2>&1 | tail -20
```

Expected: FAIL — `activityParser.ts` does not exist.

- [ ] **Step 3: Create `src/data/activityParser.ts`**

```typescript
// src/data/activityParser.ts
import { basename } from "node:path";
import type { ActivityEntry } from "../types/index.js";
import { ICONS } from "../types/index.js";

// Strip ANSI escape codes from text
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function parseModelName(modelId: string): string {
  const opusMatch = modelId.match(/claude-opus-(\d+)-(\d+)/);
  if (opusMatch) return `opus-${opusMatch[1]}.${opusMatch[2]}`;

  const sonnetMatch = modelId.match(/claude-sonnet-(\d+)/);
  if (sonnetMatch) return `sonnet-${sonnetMatch[1]}`;

  const haikuMatch = modelId.match(/claude-(\d+)-(\d+)-haiku/);
  if (haikuMatch) return `haiku-${haikuMatch[1]}.${haikuMatch[2]}`;

  return modelId.replace(/-\d{8}$/, "");
}

export function getToolDetail(
  _toolName: string,
  input?: {
    command?: string;
    file_path?: string;
    pattern?: string;
    query?: string;
    description?: string;
  },
): string {
  if (!input) return "";
  if (input.command) return stripAnsi(input.command.replace(/\n/g, " "));
  if (input.file_path) return basename(input.file_path);
  if (input.pattern) return stripAnsi(input.pattern);
  if (input.query) return stripAnsi(input.query);
  if (input.description) return stripAnsi(input.description);
  return "";
}

interface ParseResult {
  activities: ActivityEntry[];
  tokenCount: number;
  modelName: string | null;
  sessionStartTime: Date | null;
}

interface JsonlAssistantEntry {
  type: "assistant";
  message: {
    model?: string;
    content: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: {
        command?: string;
        file_path?: string;
        pattern?: string;
        query?: string;
        description?: string;
      };
    }>;
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens?: number;
    };
  };
  timestamp: string;
}

interface JsonlUserEntry {
  type: "user";
  message: { role: string; content: string | unknown[] };
  timestamp: string;
}

// Parse all activity entries from JSONL lines (no truncation)
export function parseActivitiesFromLines(lines: string[]): ParseResult {
  const activities: ActivityEntry[] = [];
  let tokenCount = 0;
  let modelName: string | null = null;
  let sessionStartTime: Date | null = null;

  for (const line of lines) {
    let entry: { type: string; timestamp?: string };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();

    if (!sessionStartTime && entry.timestamp) {
      sessionStartTime = timestamp;
    }

    if (entry.type === "user") {
      const userEntry = entry as JsonlUserEntry;
      const msgContent = userEntry.message?.content;
      let userText = "";
      if (typeof msgContent === "string") {
        userText = msgContent;
      } else if (Array.isArray(msgContent)) {
        const textBlock = (msgContent as Array<{ type: string; text?: string }>).find(
          (c) => c.type === "text" && c.text,
        );
        if (textBlock?.text) userText = textBlock.text;
      }
      if (userText) {
        activities.push({
          timestamp,
          type: "user",
          icon: ICONS.User,
          label: "User",
          detail: userText.replace(/\n/g, " "),
        });
      }
    }

    if (entry.type === "assistant") {
      const assistantEntry = entry as JsonlAssistantEntry;

      if (assistantEntry.message?.model && !modelName) {
        modelName = parseModelName(assistantEntry.message.model);
      }

      const usage = assistantEntry.message?.usage;
      if (usage) {
        tokenCount +=
          (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.output_tokens ?? 0);
      }

      const content = assistantEntry.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_use" && block.name) {
            if (block.name === "TodoWrite") continue;
            const icon = (ICONS as Record<string, string>)[block.name] ?? ICONS.Default;
            const detail = getToolDetail(block.name, block.input);
            const last = activities[activities.length - 1];
            if (
              last &&
              last.type === "tool" &&
              last.label === block.name &&
              last.detail === detail
            ) {
              last.count = (last.count ?? 1) + 1;
              last.timestamp = timestamp;
            } else {
              activities.push({ timestamp, type: "tool", icon, label: block.name, detail });
            }
          } else if (block.type === "text" && block.text && block.text.length > 10) {
            activities.push({
              timestamp,
              type: "response",
              icon: ICONS.Response,
              label: "Response",
              detail: block.text.replace(/\n/g, " "),
            });
          }
        }
      }
    }
  }

  return { activities, tokenCount, modelName, sessionStartTime };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/data/activityParser.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/activityParser.ts tests/data/activityParser.test.ts
git commit -m "feat: add activityParser module with JSONL parsing utilities"
```

---

## Task 3: Create `src/config/globalConfig.ts`

**Files:**
- Create: `src/config/globalConfig.ts`
- Create: `tests/config/globalConfig.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/config/globalConfig.test.ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";

// Mock fs module
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const { existsSync, readFileSync } = await import("node:fs");
const { loadGlobalConfig, DEFAULT_GLOBAL_CONFIG } = await import(
  "../../src/config/globalConfig.js"
);

afterEach(() => {
  vi.resetAllMocks();
});

describe("loadGlobalConfig", () => {
  it("returns defaults when config file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const config = loadGlobalConfig();
    expect(config.refreshIntervalMs).toBe(2000);
    expect(config.sessionTimeoutMs).toBe(30 * 60 * 1000);
    expect(config.logDir).toBe(join(homedir(), ".agenthud", "logs"));
  });

  it("overrides defaults with values from config file", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      "refreshInterval: 5s\nsessionTimeout: 10m\n",
    );
    const config = loadGlobalConfig();
    expect(config.refreshIntervalMs).toBe(5000);
    expect(config.sessionTimeoutMs).toBe(10 * 60 * 1000);
  });

  it("ignores unknown keys", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("unknownKey: value\n");
    const config = loadGlobalConfig();
    expect(config).toEqual(expect.objectContaining(DEFAULT_GLOBAL_CONFIG));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/config/globalConfig.test.ts 2>&1 | tail -10
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `src/config/globalConfig.ts`**

```typescript
// src/config/globalConfig.ts
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { GlobalConfig } from "../types/index.js";

const CONFIG_PATH = join(homedir(), ".agenthud", "config.yaml");

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  refreshIntervalMs: 2000,
  sessionTimeoutMs: 30 * 60 * 1000,
  logDir: join(homedir(), ".agenthud", "logs"),
};

function parseInterval(value: string): number | null {
  const match = value.match(/^(\d+)(s|m)$/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return match[2] === "m" ? n * 60 * 1000 : n * 1000;
}

export function loadGlobalConfig(): GlobalConfig {
  const config = { ...DEFAULT_GLOBAL_CONFIG };

  if (!existsSync(CONFIG_PATH)) {
    return config;
  }

  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    return config;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(raw) as Record<string, unknown>;
  } catch {
    return config;
  }

  if (typeof parsed.refreshInterval === "string") {
    const ms = parseInterval(parsed.refreshInterval);
    if (ms !== null) config.refreshIntervalMs = ms;
  }
  if (typeof parsed.sessionTimeout === "string") {
    const ms = parseInterval(parsed.sessionTimeout);
    if (ms !== null) config.sessionTimeoutMs = ms;
  }
  if (typeof parsed.logDir === "string") {
    config.logDir = parsed.logDir.replace(/^~/, homedir());
  }

  return config;
}

export function ensureLogDir(logDir: string): void {
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

export function hasProjectLevelConfig(): boolean {
  return existsSync(join(process.cwd(), ".agenthud", "config.yaml"));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/config/globalConfig.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/globalConfig.ts tests/config/globalConfig.test.ts
git commit -m "feat: add globalConfig module for ~/.agenthud/config.yaml"
```

---

## Task 4: Create `src/data/sessions.ts`

Discovers all Claude Code sessions and builds the parent/sub-agent tree.

**Files:**
- Create: `src/data/sessions.ts`
- Create: `tests/data/sessions.test.ts`

**Key insight from codebase:** Sub-agents are stored at `{project-dir}/{session-id}/subagents/{subagent-id}.jsonl`. So a session's sub-agents live in a sibling directory named after the parent session ID.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/data/sessions.test.ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { join } from "node:path";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const { existsSync, readdirSync, statSync, readFileSync } = await import("node:fs");
const { discoverSessions } = await import("../../src/data/sessions.js");

const NOW = 1_700_000_000_000;

const mockConfig = {
  refreshIntervalMs: 2000,
  sessionTimeoutMs: 30 * 60 * 1000,
  logDir: "/tmp/logs",
};

afterEach(() => {
  vi.resetAllMocks();
});

describe("discoverSessions", () => {
  it("returns empty tree when ~/.claude/projects does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const tree = discoverSessions(mockConfig);
    expect(tree.sessions).toHaveLength(0);
    expect(tree.totalCount).toBe(0);
  });

  it("discovers a top-level session with no sub-agents", () => {
    const projectsDir = "/home/user/.claude/projects";
    const projectDir = join(projectsDir, "-Users-neo-myproject");
    const sessionFile = join(projectDir, "abc123.jsonl");

    vi.mocked(existsSync).mockImplementation((p) => {
      if (typeof p === "string" && p === projectsDir) return true;
      if (typeof p === "string" && p === projectDir) return true;
      if (typeof p === "string" && p === sessionFile) return true;
      if (typeof p === "string" && p.includes("subagents")) return false;
      return false;
    });

    vi.mocked(readdirSync).mockImplementation((p) => {
      if (typeof p === "string" && p === projectsDir) return ["-Users-neo-myproject"] as unknown as ReturnType<typeof readdirSync>;
      if (typeof p === "string" && p === projectDir) return ["abc123.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });

    vi.mocked(statSync).mockImplementation((p) => {
      const s = { isDirectory: () => false, mtimeMs: NOW - 10_000, size: 1000 };
      if (typeof p === "string" && p === projectDir) return { ...s, isDirectory: () => true };
      return s as ReturnType<typeof statSync>;
    });

    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        type: "assistant",
        message: { model: "claude-sonnet-4-20250514", content: [] },
        timestamp: new Date(NOW - 10_000).toISOString(),
      }) + "\n",
    );

    const tree = discoverSessions(mockConfig);
    expect(tree.sessions).toHaveLength(1);
    expect(tree.sessions[0].id).toBe("abc123");
    expect(tree.sessions[0].subAgents).toHaveLength(0);
    expect(tree.sessions[0].modelName).toBe("sonnet-4");
  });

  it("marks session as running when mtime is within 30s", () => {
    const projectsDir = "/home/user/.claude/projects";
    const projectDir = join(projectsDir, "-Users-neo-myproject");

    vi.mocked(existsSync).mockImplementation((p) => {
      return typeof p === "string" && (p === projectsDir || p.includes("myproject"));
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      if (typeof p === "string" && p === projectsDir) return ["-Users-neo-myproject"] as unknown as ReturnType<typeof readdirSync>;
      if (typeof p === "string" && p === projectDir) return ["sess1.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const isDir = typeof p === "string" && !p.endsWith(".jsonl");
      return { isDirectory: () => isDir, mtimeMs: NOW - 5_000, size: 100 } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockReturnValue("");
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.sessions[0].status).toBe("running");
  });

  it("nests sub-agents under their parent", () => {
    const projectsDir = "/home/user/.claude/projects";
    const projectDir = join(projectsDir, "-Users-neo-proj");
    const subagentsDir = join(projectDir, "parent-id", "subagents");

    vi.mocked(existsSync).mockImplementation((p) => {
      const paths = [projectsDir, projectDir, subagentsDir];
      return typeof p === "string" && (paths.includes(p) || p.endsWith(".jsonl"));
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      if (typeof p === "string" && p === projectsDir) return ["-Users-neo-proj"] as unknown as ReturnType<typeof readdirSync>;
      if (typeof p === "string" && p === projectDir) return ["parent-id.jsonl", "parent-id"] as unknown as ReturnType<typeof readdirSync>;
      if (typeof p === "string" && p === subagentsDir) return ["child-id.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const isDir = typeof p === "string" && !p.endsWith(".jsonl");
      return { isDirectory: () => isDir, mtimeMs: NOW - 60_000, size: 500 } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockReturnValue("");

    const tree = discoverSessions(mockConfig);
    expect(tree.sessions).toHaveLength(1);
    expect(tree.sessions[0].id).toBe("parent-id");
    expect(tree.sessions[0].subAgents).toHaveLength(1);
    expect(tree.sessions[0].subAgents[0].id).toBe("child-id");
    expect(tree.totalCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/data/sessions.test.ts 2>&1 | tail -10
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `src/data/sessions.ts`**

```typescript
// src/data/sessions.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseModelName } from "./activityParser.js";
import type { GlobalConfig, SessionNode, SessionTree } from "../types/index.js";

const RUNNING_THRESHOLD_MS = 30 * 1000; // 30 seconds

function getProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

function decodeProjectPath(encoded: string): string {
  // Claude Code encodes paths by replacing "/" "\" ":" with "-"
  // e.g., "-Users-neo-myproject" → "/Users/neo/myproject"
  const windowsDriveMatch = encoded.match(/^([A-Za-z])--(.*)$/);
  if (windowsDriveMatch) {
    const drive = windowsDriveMatch[1];
    const rest = windowsDriveMatch[2].replace(/-/g, "\\");
    return `${drive}:\\${rest}`;
  }
  return encoded.replace(/-/g, "/");
}

function getSessionStatus(
  mtimeMs: number,
  config: GlobalConfig,
): "running" | "idle" | "done" {
  const age = Date.now() - mtimeMs;
  if (age < RUNNING_THRESHOLD_MS) return "running";
  if (age < config.sessionTimeoutMs) return "idle";
  return "done";
}

function readModelName(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    // Check the most recent lines for a model name
    for (const line of lines.slice(-50).reverse()) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "assistant" && entry.message?.model) {
          return parseModelName(entry.message.model as string);
        }
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }
  return null;
}

function buildSubAgents(
  parentId: string,
  projectDir: string,
  config: GlobalConfig,
): SessionNode[] {
  const subagentsDir = join(projectDir, parentId, "subagents");
  if (!existsSync(subagentsDir)) return [];

  let files: string[];
  try {
    files = (readdirSync(subagentsDir) as string[]).filter((f) =>
      f.endsWith(".jsonl"),
    );
  } catch {
    return [];
  }

  return files
    .map((file): SessionNode | null => {
      const id = file.replace(/\.jsonl$/, "");
      const filePath = join(subagentsDir, file);
      try {
        const stat = statSync(filePath);
        return {
          id,
          filePath,
          projectPath: "",   // sub-agents don't have their own project path
          projectName: "",
          lastModifiedMs: stat.mtimeMs,
          status: getSessionStatus(stat.mtimeMs, config),
          modelName: readModelName(filePath),
          subAgents: [],     // sub-agents don't have further nesting (for now)
        };
      } catch {
        return null;
      }
    })
    .filter((n): n is SessionNode => n !== null)
    .sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
}

export function discoverSessions(config: GlobalConfig): SessionTree {
  const projectsDir = getProjectsDir();

  if (!existsSync(projectsDir)) {
    return { sessions: [], totalCount: 0, timestamp: new Date().toISOString() };
  }

  let projectDirs: string[];
  try {
    projectDirs = (readdirSync(projectsDir) as string[]).filter((entry) => {
      try {
        return statSync(join(projectsDir, entry)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return { sessions: [], totalCount: 0, timestamp: new Date().toISOString() };
  }

  const allSessions: SessionNode[] = [];

  for (const encodedDir of projectDirs) {
    const projectDir = join(projectsDir, encodedDir);
    const decodedPath = decodeProjectPath(encodedDir);
    const projectName = basename(decodedPath);

    let files: string[];
    try {
      files = (readdirSync(projectDir) as string[]).filter((f) =>
        f.endsWith(".jsonl"),
      );
    } catch {
      continue;
    }

    for (const file of files) {
      const id = file.replace(/\.jsonl$/, "");
      const filePath = join(projectDir, file);
      try {
        const stat = statSync(filePath);
        const subAgents = buildSubAgents(id, projectDir, config);
        allSessions.push({
          id,
          filePath,
          projectPath: decodedPath,
          projectName,
          lastModifiedMs: stat.mtimeMs,
          status: getSessionStatus(stat.mtimeMs, config),
          modelName: readModelName(filePath),
          subAgents,
        });
      } catch {
        continue;
      }
    }
  }

  // Sort by most recent activity (running first, then by mtime)
  allSessions.sort((a, b) => {
    const statusOrder = { running: 0, idle: 1, done: 2 };
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    return b.lastModifiedMs - a.lastModifiedMs;
  });

  // Hide "done" sessions (older than sessionTimeout)
  const visible = allSessions.filter((s) => s.status !== "done");

  const totalCount =
    visible.length + visible.reduce((sum, s) => sum + s.subAgents.length, 0);

  return {
    sessions: visible,
    totalCount,
    timestamp: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/data/sessions.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/sessions.ts tests/data/sessions.test.ts
git commit -m "feat: add sessions module for global Claude session discovery"
```

---

## Task 5: Create `src/data/sessionHistory.ts`

Parses the **full** activity history from a JSONL file (no truncation).

**Files:**
- Create: `src/data/sessionHistory.ts`
- Create: `tests/data/sessionHistory.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/data/sessionHistory.test.ts
import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const { existsSync, readFileSync } = await import("node:fs");
const { parseSessionHistory } = await import("../../src/data/sessionHistory.js");

afterEach(() => vi.resetAllMocks());

const makeLines = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Read",
            input: { file_path: `/src/file${i}.ts` },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
    }),
  ).join("\n");

describe("parseSessionHistory", () => {
  it("returns empty array when file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(parseSessionHistory("/nonexistent.jsonl")).toHaveLength(0);
  });

  it("parses all entries without truncation (300 lines)", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(makeLines(300));
    const result = parseSessionHistory("/session.jsonl");
    // Each line produces one Read activity
    expect(result.length).toBe(300);
  });

  it("returns entries in chronological order (oldest first)", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(makeLines(5));
    const result = parseSessionHistory("/session.jsonl");
    for (let i = 1; i < result.length; i++) {
      expect(result[i].timestamp.getTime()).toBeGreaterThanOrEqual(
        result[i - 1].timestamp.getTime(),
      );
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/data/sessionHistory.test.ts 2>&1 | tail -10
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `src/data/sessionHistory.ts`**

```typescript
// src/data/sessionHistory.ts
import { existsSync, readFileSync } from "node:fs";
import { parseActivitiesFromLines } from "./activityParser.js";
import type { ActivityEntry } from "../types/index.js";

// Parse the full, untruncated activity history from a JSONL file.
// Returns entries in chronological order (oldest first).
export function parseSessionHistory(filePath: string): ActivityEntry[] {
  if (!existsSync(filePath)) return [];

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const lines = content.trim().split("\n").filter(Boolean);
  const { activities } = parseActivitiesFromLines(lines);

  // parseActivitiesFromLines already returns in order — no sort needed
  return activities;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/data/sessionHistory.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/sessionHistory.ts tests/data/sessionHistory.test.ts
git commit -m "feat: add sessionHistory module for full untruncated activity parsing"
```

---

## Task 6: Create `src/ui/SessionTreePanel.tsx`

Renders the top pane: tree of sessions with status badges and keyboard navigation.

**Files:**
- Create: `src/ui/SessionTreePanel.tsx`
- Create: `tests/ui/SessionTreePanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ui/SessionTreePanel.test.tsx
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { SessionTreePanel } from "../../src/ui/SessionTreePanel.js";
import type { SessionNode } from "../../src/types/index.js";

const makeSession = (overrides: Partial<SessionNode> = {}): SessionNode => ({
  id: "abc123",
  filePath: "/home/user/.claude/projects/-proj/abc123.jsonl",
  projectPath: "/Users/neo/myproject",
  projectName: "myproject",
  lastModifiedMs: Date.now() - 5000,
  status: "running",
  modelName: "sonnet-4.6",
  subAgents: [],
  ...overrides,
});

describe("SessionTreePanel", () => {
  it("renders session project name", () => {
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[makeSession()]}
        selectedId="abc123"
        hasFocus={true}
        onSelect={() => {}}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("myproject");
  });

  it("renders status badge for running session", () => {
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[makeSession({ status: "running" })]}
        selectedId={null}
        hasFocus={false}
        onSelect={() => {}}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("running");
  });

  it("renders sub-agent indented under parent", () => {
    const session = makeSession({
      subAgents: [
        makeSession({
          id: "child1",
          projectName: "",
          status: "done",
          subAgents: [],
        }),
      ],
    });
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[session]}
        selectedId={null}
        hasFocus={false}
        onSelect={() => {}}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("»");
  });

  it("renders model name when present", () => {
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[makeSession({ modelName: "sonnet-4.6" })]}
        selectedId={null}
        hasFocus={false}
        onSelect={() => {}}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("sonnet-4.6");
  });

  it("renders empty message when no sessions", () => {
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[]}
        selectedId={null}
        hasFocus={false}
        onSelect={() => {}}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("No Claude sessions");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/ui/SessionTreePanel.test.tsx 2>&1 | tail -10
```

Expected: FAIL — component does not exist.

- [ ] **Step 3: Create `src/ui/SessionTreePanel.tsx`**

```typescript
// src/ui/SessionTreePanel.tsx
import { Box, Text } from "ink";
import React from "react";
import type { SessionNode } from "../types/index.js";
import {
  BOX,
  createBottomLine,
  createTitleLine,
  getInnerWidth,
} from "./constants.js";

interface SessionTreePanelProps {
  sessions: SessionNode[];
  selectedId: string | null;
  hasFocus: boolean;
  onSelect: (id: string) => void;
  width: number;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function statusColor(status: SessionNode["status"]): string {
  if (status === "running") return "green";
  if (status === "idle") return "yellow";
  return "gray";
}

interface FlatEntry {
  node: SessionNode;
  indent: number;
  isSubAgent: boolean;
  isLast: boolean;
}

function flattenTree(sessions: SessionNode[]): FlatEntry[] {
  const entries: FlatEntry[] = [];
  for (const session of sessions) {
    entries.push({ node: session, indent: 0, isSubAgent: false, isLast: false });
    session.subAgents.forEach((sub, i) => {
      entries.push({
        node: sub,
        indent: 1,
        isSubAgent: true,
        isLast: i === session.subAgents.length - 1,
      });
    });
  }
  return entries;
}

export function SessionTreePanel({
  sessions,
  selectedId,
  hasFocus,
  width,
}: SessionTreePanelProps): React.ReactElement {
  const innerWidth = getInnerWidth(width);
  const title = `Sessions${hasFocus ? " [↑↓]" : ""}`;
  const titleLine = createTitleLine(title, "", width);
  const bottomLine = createBottomLine(width);

  const entries = flattenTree(sessions);

  return (
    <Box flexDirection="column">
      <Text>{titleLine}</Text>

      {entries.length === 0 ? (
        <Text>
          {BOX.v}
          <Text dimColor> No Claude sessions found</Text>
          {" ".repeat(innerWidth - 25)}
          {BOX.v}
        </Text>
      ) : (
        entries.map((entry) => {
          const { node, indent, isSubAgent, isLast } = entry;
          const isSelected = node.id === selectedId;
          const elapsed = formatElapsed(Date.now() - node.lastModifiedMs);
          const color = statusColor(node.status);

          let prefix = "";
          if (isSubAgent) {
            prefix = `  ${isLast ? "└─" : "├─"} » `;
          } else {
            prefix = isSelected && hasFocus ? "→ " : "  ";
          }

          const name = node.projectName || `agent-${node.id.slice(0, 6)}`;
          const badge = `[${node.status}]`;
          const model = node.modelName ? ` ${node.modelName}` : "";
          const right = `${badge} ${elapsed}${model}`;
          const maxNameLen = innerWidth - prefix.length - right.length - 4;
          const truncatedName =
            name.length > maxNameLen ? name.slice(0, maxNameLen - 1) + "…" : name;
          const gap = innerWidth - prefix.length - truncatedName.length - right.length - 2;
          const line = `${prefix}${truncatedName}${" ".repeat(Math.max(1, gap))}`;

          return (
            <Text key={node.id}>
              {BOX.v}
              <Text bold={isSelected && hasFocus}>{line}</Text>
              <Text color={color}>{badge}</Text>
              {` ${elapsed}`}
              <Text dimColor>{model}</Text>
              {" ".repeat(Math.max(0, innerWidth - line.length - badge.length - elapsed.length - model.length - 1))}
              {BOX.v}
            </Text>
          );
        })
      )}

      <Text>{bottomLine}</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/ui/SessionTreePanel.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/SessionTreePanel.tsx tests/ui/SessionTreePanel.test.tsx
git commit -m "feat: add SessionTreePanel component for session tree display"
```

---

## Task 7: Create `src/ui/ActivityViewerPanel.tsx`

Bottom pane: scrollable history with live/paused mode. Manages its own scroll state.

**Files:**
- Create: `src/ui/ActivityViewerPanel.tsx`
- Create: `tests/ui/ActivityViewerPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/ui/ActivityViewerPanel.test.tsx
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { ActivityViewerPanel } from "../../src/ui/ActivityViewerPanel.js";
import type { ActivityEntry } from "../../src/types/index.js";

const makeActivity = (label: string, i: number): ActivityEntry => ({
  timestamp: new Date(1_700_000_000_000 + i * 1000),
  type: "tool",
  icon: "○",
  label,
  detail: `file${i}.ts`,
});

describe("ActivityViewerPanel", () => {
  it("renders session name in title", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        activities={[makeActivity("Read", 0)]}
        sessionName="feat/auth"
        hasFocus={false}
        scrollOffset={0}
        isLive={true}
        visibleRows={10}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("feat/auth");
  });

  it("renders activity label and detail", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        activities={[makeActivity("Read", 0)]}
        sessionName="session"
        hasFocus={false}
        scrollOffset={0}
        isLive={true}
        visibleRows={10}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("Read");
    expect(lastFrame()).toContain("file0.ts");
  });

  it("shows LIVE indicator when isLive is true", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        activities={[makeActivity("Read", 0)]}
        sessionName="s"
        hasFocus={false}
        scrollOffset={0}
        isLive={true}
        visibleRows={10}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("LIVE");
  });

  it("shows PAUSED indicator when isLive is false", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        activities={[makeActivity("Read", 0)]}
        sessionName="s"
        hasFocus={false}
        scrollOffset={0}
        isLive={false}
        visibleRows={10}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("PAUSED");
  });

  it("shows empty message when no activities", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        activities={[]}
        sessionName="s"
        hasFocus={false}
        scrollOffset={0}
        isLive={true}
        visibleRows={10}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("No activity");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/ui/ActivityViewerPanel.test.tsx 2>&1 | tail -10
```

Expected: FAIL — component does not exist.

- [ ] **Step 3: Create `src/ui/ActivityViewerPanel.tsx`**

```typescript
// src/ui/ActivityViewerPanel.tsx
import { Box, Text } from "ink";
import React from "react";
import type { ActivityEntry } from "../types/index.js";
import {
  BOX,
  createBottomLine,
  createTitleLine,
  getInnerWidth,
  truncate,
} from "./constants.js";
import { getActivityStyle } from "./ClaudePanel.js";

interface ActivityViewerPanelProps {
  activities: ActivityEntry[];
  sessionName: string;
  hasFocus: boolean;
  scrollOffset: number;   // how many entries from the end to show (0 = live/bottom)
  isLive: boolean;
  visibleRows: number;    // max number of activity lines to display
  width: number;
}

export function ActivityViewerPanel({
  activities,
  sessionName,
  hasFocus,
  scrollOffset,
  isLive,
  visibleRows,
  width,
}: ActivityViewerPanelProps): React.ReactElement {
  const innerWidth = getInnerWidth(width);
  const liveIndicator = isLive ? "LIVE ▼" : "PAUSED ↑↓:scroll G:live";
  const focusHint = hasFocus ? " [↑↓ g G s]" : "";
  const titleLine = createTitleLine(sessionName + focusHint, liveIndicator, width);
  const bottomLine = createBottomLine(width);

  const totalActivities = activities.length;

  // Determine visible slice
  // scrollOffset=0 means show latest entries (live mode)
  const endIdx = isLive
    ? totalActivities
    : Math.max(0, totalActivities - scrollOffset);
  const startIdx = Math.max(0, endIdx - visibleRows);
  const visibleActivities = activities.slice(startIdx, endIdx);

  // Scroll position info
  const scrollInfo =
    totalActivities > visibleRows
      ? ` ${startIdx + 1}-${endIdx}/${totalActivities}`
      : "";

  return (
    <Box flexDirection="column">
      <Text>{titleLine}</Text>

      {visibleActivities.length === 0 ? (
        <Text>
          {BOX.v}
          <Text dimColor> No activity yet</Text>
          {" ".repeat(innerWidth - 16)}
          {BOX.v}
        </Text>
      ) : (
        visibleActivities.map((activity, i) => {
          const style = getActivityStyle(activity);
          const countStr = activity.count && activity.count > 1 ? ` ×${activity.count}` : "";
          const detail = truncate(activity.detail, innerWidth - activity.icon.length - activity.label.length - countStr.length - 5);
          const line = ` ${activity.icon} ${activity.label} ${detail}${countStr}`;
          const padded = line + " ".repeat(Math.max(0, innerWidth - line.length));

          return (
            <Text key={`${activity.timestamp.getTime()}-${i}`}>
              {BOX.v}
              <Text color={style.color} dimColor={style.dimColor}>
                {padded}
              </Text>
              {BOX.v}
            </Text>
          );
        })
      )}

      {scrollInfo ? (
        <Text>
          {BOX.v}
          <Text dimColor>{scrollInfo.padEnd(innerWidth)}</Text>
          {BOX.v}
        </Text>
      ) : null}

      <Text>{bottomLine}</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/ui/ActivityViewerPanel.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/ActivityViewerPanel.tsx tests/ui/ActivityViewerPanel.test.tsx
git commit -m "feat: add ActivityViewerPanel with scrollable history and live mode"
```

---

## Task 8: Rewrite `src/ui/App.tsx`

Split-view layout with focus management and keyboard routing.

**Files:**
- Modify: `src/ui/App.tsx`
- Modify: `tests/ui/App.test.tsx`
- Modify: `src/ui/hooks/useHotkeys.ts`

- [ ] **Step 1: Update `src/ui/hooks/useHotkeys.ts`** to support the new key scheme

Replace the file contents:

```typescript
// src/ui/hooks/useHotkeys.ts
interface UseHotkeysOptions {
  focus: "tree" | "viewer";
  onSwitchFocus: () => void;
  onScrollUp: () => void;
  onScrollDown: () => void;
  onScrollTop: () => void;
  onScrollBottom: () => void;
  onSaveLog: () => void;
  onRefresh: () => void;
  onQuit: () => void;
}

export interface UseHotkeysResult {
  handleInput: (input: string, key: { upArrow: boolean; downArrow: boolean }) => void;
  statusBarItems: string[];
}

export function useHotkeys({
  focus,
  onSwitchFocus,
  onScrollUp,
  onScrollDown,
  onScrollTop,
  onScrollBottom,
  onSaveLog,
  onRefresh,
  onQuit,
}: UseHotkeysOptions): UseHotkeysResult {
  const handleInput = (
    input: string,
    key: { upArrow: boolean; downArrow: boolean },
  ) => {
    if (input === "q") { onQuit(); return; }
    if (input === "\t") { onSwitchFocus(); return; }   // Tab
    if (input === "r") { onRefresh(); return; }

    if (focus === "viewer") {
      if (key.upArrow || input === "k") { onScrollUp(); return; }
      if (key.downArrow || input === "j") { onScrollDown(); return; }
      if (input === "g") { onScrollTop(); return; }
      if (input === "G") { onScrollBottom(); return; }
      if (input === "s") { onSaveLog(); return; }
    }

    if (focus === "tree") {
      if (key.upArrow || input === "k") { onScrollUp(); return; }
      if (key.downArrow || input === "j") { onScrollDown(); return; }
    }
  };

  const statusBarItems =
    focus === "tree"
      ? ["Tab: viewer", "↑↓: select", "r: refresh", "q: quit"]
      : ["Tab: tree", "↑↓: scroll", "g: top", "G: live", "s: save", "q: quit"];

  return { handleInput, statusBarItems };
}
```

- [ ] **Step 2: Rewrite `src/ui/App.tsx`**

```typescript
// src/ui/App.tsx
import { Box, Text, useApp, useInput, useStdout } from "ink";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "../cli.js";
import { loadGlobalConfig, ensureLogDir, hasProjectLevelConfig } from "../config/globalConfig.js";
import { discoverSessions } from "../data/sessions.js";
import { parseSessionHistory } from "../data/sessionHistory.js";
import type { ActivityEntry, SessionNode, SessionTree } from "../types/index.js";
import { ActivityViewerPanel } from "./ActivityViewerPanel.js";
import { SessionTreePanel } from "./SessionTreePanel.js";
import { useHotkeys } from "./hooks/useHotkeys.js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const VIEWER_HEIGHT_FRACTION = 0.55; // viewer pane gets 55% of terminal height

function flattenSessions(tree: SessionTree): SessionNode[] {
  const result: SessionNode[] = [];
  for (const s of tree.sessions) {
    result.push(s);
    result.push(...s.subAgents);
  }
  return result;
}

export function App({ mode }: { mode: "watch" | "once" }): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const isWatchMode = mode === "watch";

  const config = useMemo(() => loadGlobalConfig(), []);
  const migrationWarning = useMemo(() => hasProjectLevelConfig(), []);

  const [sessionTree, setSessionTree] = useState<SessionTree>(() =>
    discoverSessions(config),
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const first = sessionTree.sessions[0];
    return first?.id ?? null;
  });
  const [focus, setFocus] = useState<"tree" | "viewer">("tree");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isLive, setIsLive] = useState(true);
  const [activities, setActivities] = useState<ActivityEntry[]>([]);

  // Load activities whenever selected session changes
  useEffect(() => {
    const all = flattenSessions(sessionTree);
    const node = all.find((s) => s.id === selectedId);
    if (node) {
      setActivities(parseSessionHistory(node.filePath));
      setScrollOffset(0);
      setIsLive(true);
    } else {
      setActivities([]);
    }
  }, [selectedId, sessionTree]);

  const refresh = useCallback(() => {
    const tree = discoverSessions(config);
    setSessionTree(tree);
    // Re-read activities for selected session
    const all = flattenSessions(tree);
    const node = all.find((s) => s.id === selectedId);
    if (node && isLive) {
      setActivities(parseSessionHistory(node.filePath));
    }
  }, [config, selectedId, isLive]);

  // Auto-refresh in watch mode
  useEffect(() => {
    if (!isWatchMode) return;
    const timer = setInterval(refresh, config.refreshIntervalMs);
    return () => clearInterval(timer);
  }, [isWatchMode, refresh, config.refreshIntervalMs]);

  const allFlat = useMemo(() => flattenSessions(sessionTree), [sessionTree]);
  const selectedIndex = allFlat.findIndex((s) => s.id === selectedId);

  const height = stdout?.rows ?? 40;
  const width = stdout?.columns ?? 80;
  const viewerRows = Math.max(5, Math.floor(height * VIEWER_HEIGHT_FRACTION) - 4);

  const saveLog = useCallback(() => {
    if (!activities.length || !selectedId) return;
    ensureLogDir(config.logDir);
    const date = new Date().toISOString().slice(0, 10);
    const filePath = join(config.logDir, `${date}-${selectedId.slice(0, 8)}.txt`);
    const lines = activities.map(
      (a) =>
        `[${a.timestamp.toISOString()}] ${a.icon} ${a.label} ${a.detail}`,
    );
    try {
      writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
    } catch {
      // silently fail
    }
  }, [activities, selectedId, config.logDir]);

  const { handleInput, statusBarItems } = useHotkeys({
    focus,
    onSwitchFocus: () => setFocus((f) => (f === "tree" ? "viewer" : "tree")),
    onScrollUp: () => {
      if (focus === "tree") {
        const prev = Math.max(0, selectedIndex - 1);
        setSelectedId(allFlat[prev]?.id ?? selectedId);
      } else {
        setIsLive(false);
        setScrollOffset((o) => o + 1);
      }
    },
    onScrollDown: () => {
      if (focus === "tree") {
        const next = Math.min(allFlat.length - 1, selectedIndex + 1);
        setSelectedId(allFlat[next]?.id ?? selectedId);
      } else {
        setScrollOffset((o) => {
          const newOffset = Math.max(0, o - 1);
          if (newOffset === 0) setIsLive(true);
          return newOffset;
        });
      }
    },
    onScrollTop: () => {
      setIsLive(false);
      setScrollOffset(Math.max(0, activities.length - viewerRows));
    },
    onScrollBottom: () => {
      setIsLive(true);
      setScrollOffset(0);
    },
    onSaveLog: saveLog,
    onRefresh: refresh,
    onQuit: exit,
  });

  useInput(
    (input, key) => handleInput(input, key),
    { isActive: isWatchMode },
  );

  return (
    <Box flexDirection="column">
      {migrationWarning && (
        <Box marginBottom={1}>
          <Text color="yellow">⚠ Config moved to ~/.agenthud/config.yaml</Text>
        </Box>
      )}

      <SessionTreePanel
        sessions={sessionTree.sessions}
        selectedId={selectedId}
        hasFocus={focus === "tree"}
        onSelect={(id) => { setSelectedId(id); setFocus("viewer"); }}
        width={width}
      />

      <Box marginTop={1}>
        <ActivityViewerPanel
          activities={activities}
          sessionName={
            allFlat.find((s) => s.id === selectedId)?.projectName ??
            (selectedId ? `agent-${selectedId.slice(0, 6)}` : "No session selected")
          }
          hasFocus={focus === "viewer"}
          scrollOffset={scrollOffset}
          isLive={isLive}
          visibleRows={viewerRows}
          width={width}
        />
      </Box>

      {isWatchMode && (
        <Box marginTop={1} justifyContent="space-between" width={width}>
          <Text dimColor>{statusBarItems.join(" · ")}</Text>
          <Text dimColor>AgentHUD v{getVersion()}</Text>
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 3: Write a minimal App test**

```typescript
// tests/ui/App.test.tsx
import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/globalConfig.js", () => ({
  loadGlobalConfig: () => ({
    refreshIntervalMs: 60000,
    sessionTimeoutMs: 30 * 60 * 1000,
    logDir: "/tmp/logs",
  }),
  ensureLogDir: vi.fn(),
  hasProjectLevelConfig: () => false,
}));

vi.mock("../../src/data/sessions.js", () => ({
  discoverSessions: () => ({
    sessions: [],
    totalCount: 0,
    timestamp: new Date().toISOString(),
  }),
}));

vi.mock("../../src/data/sessionHistory.js", () => ({
  parseSessionHistory: () => [],
}));

const { App } = await import("../../src/ui/App.js");

describe("App", () => {
  it("renders without crashing when there are no sessions", () => {
    const { lastFrame } = render(<App mode="once" />);
    expect(lastFrame()).toContain("No Claude sessions");
  });

  it("renders AgentHUD version in watch mode", () => {
    const { lastFrame } = render(<App mode="watch" />);
    expect(lastFrame()).toContain("AgentHUD v");
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/ui/App.test.tsx tests/ui/SessionTreePanel.test.tsx tests/ui/ActivityViewerPanel.test.tsx
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.tsx src/ui/hooks/useHotkeys.ts tests/ui/App.test.tsx
git commit -m "feat: rewrite App.tsx as split-view global agent monitor"
```

---

## Task 9: Update `src/cli.ts`

Remove `init` command and `--dir` flag; update help text.

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/cli.test.ts`

- [ ] **Step 1: Replace `src/cli.ts`**

```typescript
// src/cli.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface CliOptions {
  mode: "watch" | "once";
  command?: "version" | "help";
}

export function getHelp(): string {
  return `Usage: agenthud [options]

Monitors all running Claude Code sessions in real-time.

Options:
  -w, --watch       Watch mode (default) — live updates
  --once            Print once and exit
  -V, --version     Show version number
  -h, --help        Show this help message

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
  return { mode: "watch" };
}
```

- [ ] **Step 2: Update `tests/cli.test.ts`** to remove init-related tests

```typescript
// tests/cli.test.ts
import { describe, expect, it } from "vitest";
import { parseArgs, getHelp } from "../../src/cli.js";

describe("parseArgs", () => {
  it("defaults to watch mode", () => {
    expect(parseArgs([])).toEqual({ mode: "watch" });
  });

  it("parses --once", () => {
    expect(parseArgs(["--once"])).toEqual({ mode: "once" });
  });

  it("parses --help", () => {
    expect(parseArgs(["--help"])).toEqual({ mode: "watch", command: "help" });
  });

  it("parses -h", () => {
    expect(parseArgs(["-h"])).toEqual({ mode: "watch", command: "help" });
  });

  it("parses --version", () => {
    expect(parseArgs(["--version"])).toEqual({ mode: "watch", command: "version" });
  });

  it("parses -V", () => {
    expect(parseArgs(["-V"])).toEqual({ mode: "watch", command: "version" });
  });
});

describe("getHelp", () => {
  it("includes usage line", () => {
    expect(getHelp()).toContain("Usage: agenthud");
  });

  it("mentions config path", () => {
    expect(getHelp()).toContain("~/.agenthud/config.yaml");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/cli.test.ts
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "refactor: simplify cli.ts — remove init command and --dir flag"
```

---

## Task 10: Delete deprecated files and fix `src/main.ts`

**Files:**
- Modify: `src/main.ts`
- Delete: old data modules, panels, tests, config

- [ ] **Step 1: Update `src/main.ts`** to use the new App

```bash
cat src/main.ts
```

Check what it currently imports, then replace with:

```typescript
// src/main.ts
import React from "react";
import { render } from "ink";
import { parseArgs, getHelp, getVersion, clearScreen } from "./cli.js";
import { App } from "./ui/App.js";

const options = parseArgs(process.argv.slice(2));

if (options.command === "help") {
  console.log(getHelp());
  process.exit(0);
}

if (options.command === "version") {
  console.log(getVersion());
  process.exit(0);
}

if (options.mode !== "watch") {
  clearScreen();
}

render(React.createElement(App, { mode: options.mode }));
```

- [ ] **Step 2: Delete old source files**

```bash
rm -f \
  src/data/git.ts \
  src/data/tests.ts \
  src/data/project.ts \
  src/data/otherSessions.ts \
  src/data/detectTestFramework.ts \
  src/data/custom.ts \
  src/data/sessionAvailability.ts \
  src/data/claude.ts \
  src/runner/command.ts \
  src/config/parser.ts \
  src/commands/init.ts \
  src/ui/GitPanel.tsx \
  src/ui/TestPanel.tsx \
  src/ui/ProjectPanel.tsx \
  src/ui/OtherSessionsPanel.tsx \
  src/ui/GenericPanel.tsx \
  src/ui/WelcomePanel.tsx \
  src/ui/hooks/usePanelData.ts \
  src/ui/hooks/useVisualFeedback.ts \
  src/ui/hooks/useCountdown.ts \
  src/ui/Dashboard.tsx 2>/dev/null || true
```

- [ ] **Step 3: Delete old test files**

```bash
rm -f \
  tests/data/git.test.ts \
  tests/data/tests.test.ts \
  tests/data/project.test.ts \
  tests/data/otherSessions.test.ts \
  tests/data/detectTestFramework.test.ts \
  tests/data/custom.test.ts \
  tests/data/sessionAvailability.test.ts \
  tests/data/claude.test.ts \
  tests/runner/command.test.ts \
  tests/config/parser.test.ts \
  tests/commands/init.test.ts \
  tests/ui/GitPanel.test.tsx \
  tests/ui/TestPanel.test.tsx \
  tests/ui/ProjectPanel.test.tsx \
  tests/ui/OtherSessionsPanel.test.tsx \
  tests/ui/GenericPanel.test.tsx \
  tests/ui/WelcomePanel.test.tsx \
  tests/ui/hooks/usePanelData.test.ts \
  tests/ui/hooks/useVisualFeedback.test.ts \
  tests/ui/hooks/useCountdown.test.ts \
  tests/integration/config.test.tsx 2>/dev/null || true
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors. If there are import errors, fix them before continuing.

- [ ] **Step 5: Run all tests**

```bash
npx vitest run
```

Expected: all tests PASS. If any test fails, fix the import before committing.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove deprecated panels and data modules, wire up new v0.8 architecture"
```

---

## Task 11: Build and smoke test

- [ ] **Step 1: Build**

```bash
npm run build 2>&1
```

Expected: no errors. Outputs to `dist/`.

- [ ] **Step 2: Run the linter**

```bash
npm run lint 2>&1
```

Expected: no errors. If biome reports issues, run `npm run lint:fix` and commit the fixes.

- [ ] **Step 3: Smoke test — run once mode**

```bash
node dist/index.js --once 2>&1
```

Expected: renders the session tree (or "No Claude sessions found") and exits cleanly.

- [ ] **Step 4: Smoke test — watch mode (exit with `q`)**

Start Claude Code in another terminal first if you want to see real sessions.

```bash
node dist/index.js
```

Expected: launches interactive split-view. `q` quits cleanly.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: verify v0.8 build and smoke tests pass"
```

---

## Self-Review Checklist

- [x] All spec goals covered: global session detection (Task 4), sub-agent tree (Task 4 + 6), scrollable history (Task 5 + 7), file save (Task 8), global config (Task 3)
- [x] No TBD/TODO placeholders — sub-agent file path structure confirmed from existing codebase (`{session-id}/subagents/*.jsonl`)
- [x] Type consistency: `SessionNode` defined in Task 1, used identically in Tasks 4, 6, 7, 8
- [x] `ActivityEntry` defined in Task 1, produced by Task 2/5, consumed by Task 7/8
- [x] `GlobalConfig` defined in Task 1, produced by Task 3, consumed by Task 4/8
- [x] `getActivityStyle` imported from `ClaudePanel.tsx` in `ActivityViewerPanel` — `ClaudePanel.tsx` is NOT deleted (only its rendering is unused, the export stays)
- [x] `useHotkeys` signature updated in Task 8 before App.tsx uses it
