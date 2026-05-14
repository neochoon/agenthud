# Session Status Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend session status from 2-level (running/idle) to 4-level (hot/warm/cool/cold), collapse cold sessions behind a summary row, and add a hide feature that persists session IDs to config.

**Architecture:** `SessionStatus` type changes to `"hot" | "warm" | "cool" | "cold"`. Status is determined by elapsed time (hot < 30m, warm < 1h) then calendar day (cool = UTC today, cold = before today). Cold sessions fold behind a selectable `── N cold ──` row. Hidden session/sub-agent IDs are stored in `~/.agenthud/config.yaml` and filtered at discovery time.

**Tech Stack:** TypeScript, Ink (React for CLI), Vitest, Node.js fs, yaml package (already in use)

---

## File Map

| File | Change |
|------|--------|
| `src/ui/constants.ts` | Add `ONE_HOUR_MS` |
| `src/types/index.ts` | `SessionStatus` rename; `GlobalConfig` remove `sessionTimeoutMs`, add `hiddenSessions`/`hiddenSubAgents` |
| `src/data/sessions.ts` | Rewrite `getSessionStatus()`; filter hidden in `discoverSessions()`/`buildSubAgents()` |
| `src/config/globalConfig.ts` | Remove `sessionTimeoutMs`; add hidden arrays parsing; add `hideSession()`/`hideSubAgent()` |
| `src/ui/SessionTreePanel.tsx` | Update colors; replace `idle-summary` with `subagent-summary`; add `cold-sessions-summary` row |
| `src/ui/App.tsx` | Update `flattenSessions()`; add `__cold__` sentinel; `onHide` handler; fix `onEnter` |
| `src/ui/hooks/useHotkeys.ts` | Add `onHide`; bind `h`; update statusBar |
| `tests/data/sessions.test.ts` | Update `mockConfig`; update status assertions; add hidden/calendar tests |
| `tests/config/globalConfig.test.ts` | Remove `sessionTimeoutMs` tests; add hidden/hide tests |
| `tests/ui/SessionTreePanel.test.tsx` | Update `makeSession` status; update/add sub-agent summary tests |
| `tests/ui/hooks/useHotkeys.test.ts` | Add `onHide` to `makeOptions`; add `h` key test; update statusBar test |

---

### Task 1: Types, Constants, and Fix All Type Consumers

This is a coordinated rename. TypeScript enforces the old type everywhere, so all files must be updated together.

**Files:**
- Modify: `src/ui/constants.ts`
- Modify: `src/types/index.ts`
- Modify: `src/data/sessions.ts`
- Modify: `src/ui/SessionTreePanel.tsx`
- Modify: `src/ui/App.tsx`
- Modify: `tests/data/sessions.test.ts`
- Modify: `tests/config/globalConfig.test.ts`
- Modify: `tests/ui/SessionTreePanel.test.tsx`

- [ ] **Step 1: Add ONE_HOUR_MS to constants**

In `src/ui/constants.ts`, add after `THIRTY_MINUTES_MS`:

```typescript
export const ONE_HOUR_MS = 60 * 60 * 1000;
```

- [ ] **Step 2: Update SessionStatus and GlobalConfig types**

Replace the relevant sections in `src/types/index.ts`:

```typescript
// Session status
export type SessionStatus = "hot" | "warm" | "cool" | "cold";

// A single Claude session node (top-level or sub-agent)
export interface SessionNode {
  id: string;
  filePath: string;
  projectPath: string;
  projectName: string;
  lastModifiedMs: number;
  status: SessionStatus;
  modelName: string | null;
  subAgents: SessionNode[];
  agentId?: string;
  taskDescription?: string;
}

// Full session tree returned by discoverSessions()
export interface SessionTree {
  sessions: SessionNode[];
  totalCount: number;
  timestamp: string;
}

// Global config (~/.agenthud/config.yaml)
export interface GlobalConfig {
  refreshIntervalMs: number;
  logDir: string;
  hiddenSessions: string[];
  hiddenSubAgents: string[];
}
```

- [ ] **Step 3: Rewrite getSessionStatus in sessions.ts**

Replace the entire `getSessionStatus` function and its import of `THIRTY_MINUTES_MS`:

```typescript
import { ONE_HOUR_MS, THIRTY_MINUTES_MS } from "../ui/constants.js";

function getSessionStatus(mtimeMs: number): SessionStatus {
  const now = Date.now();
  const age = now - mtimeMs;
  if (age < THIRTY_MINUTES_MS) return "hot";
  if (age < ONE_HOUR_MS) return "warm";
  // Calendar-based cool vs cold — Task 3 adds full calendar logic
  // For now, treat everything >= 1h as "cool" (Task 3 fixes this)
  return "cool";
}
```

Remove the `config: GlobalConfig` parameter from `getSessionStatus` — it no longer uses `sessionTimeoutMs`. Update the call site in `buildSubAgents` and `discoverSessions`:

```typescript
status: getSessionStatus(stat.mtimeMs),
```

Update the sort in `discoverSessions`:

```typescript
allSessions.sort((a, b) => {
  const statusOrder: Record<SessionStatus, number> = {
    hot: 0,
    warm: 1,
    cool: 2,
    cold: 3,
  };
  const statusDiff = statusOrder[a.status] - statusOrder[b.status];
  if (statusDiff !== 0) return statusDiff;
  return b.lastModifiedMs - a.lastModifiedMs;
});
```

Update the visible filter — sessions are no longer filtered by "done":

```typescript
const visible = allSessions.filter(
  (s) => !config.hiddenSessions.includes(s.id),
);
```

Update `buildSubAgents` filter:

```typescript
.filter((n): n is SessionNode => n !== null && !config.hiddenSubAgents.includes(n.id))
```

- [ ] **Step 4: Update getStatusColor in SessionTreePanel.tsx**

Replace the `getStatusColor` function:

```typescript
function getStatusColor(status: SessionStatus): string {
  switch (status) {
    case "hot":
      return "green";
    case "warm":
      return "yellow";
    case "cool":
      return "cyan";
    case "cold":
      return "gray";
  }
}
```

- [ ] **Step 5: Update flattenSessions in App.tsx**

Replace the top-level `flattenSessions` function:

```typescript
function flattenSessions(
  tree: SessionTree,
  expandedIds: Set<string>,
): SessionNode[] {
  const result: SessionNode[] = [];
  for (const s of tree.sessions) {
    result.push(s);
    if (expandedIds.has(s.id)) {
      result.push(...s.subAgents);
    } else {
      result.push(
        ...s.subAgents.filter(
          (sub) => sub.status === "hot" || sub.status === "warm",
        ),
      );
    }
  }
  return result;
}
```

Update `onEnter` in App.tsx — change the idle check to cool/cold:

```typescript
onEnter: () => {
  if (focus !== "tree" || !selectedId) return;
  const parentSession = sessionTree.sessions.find(
    (s) => s.id === selectedId,
  );
  if (
    !parentSession ||
    !parentSession.subAgents.some(
      (s) => s.status === "cool" || s.status === "cold",
    )
  )
    return;
  setExpandedIds((prev) => {
    const next = new Set(prev);
    if (next.has(selectedId)) {
      next.delete(selectedId);
    } else {
      next.add(selectedId);
    }
    return next;
  });
},
```

- [ ] **Step 6: Fix tests/data/sessions.test.ts**

Update `mockConfig` (remove `sessionTimeoutMs`, add hidden arrays):

```typescript
const mockConfig = {
  refreshIntervalMs: 2000,
  logDir: "/tmp/logs",
  hiddenSessions: [] as string[],
  hiddenSubAgents: [] as string[],
};
```

Update the `"marks session as running when mtime is within 30m"` test — change expected status from `"running"` to `"hot"`:

```typescript
it("marks session as hot when mtime is within 30m", () => {
  // ... same setup ...
  const tree = discoverSessions(mockConfig);
  expect(tree.sessions[0].status).toBe("hot");
});
```

Replace `"excludes sessions older than sessionTimeout (done)"` with:

```typescript
it("includes sessions older than 1 hour (no longer excluded by timeout)", () => {
  const projectsDir = join(
    process.env.HOME ?? "/home/user",
    ".claude",
    "projects",
  );
  const projectDir = join(projectsDir, "-Users-neo-oldproject");

  vi.mocked(existsSync).mockImplementation((p) => {
    const path = String(p);
    return path === projectsDir || path.includes("oldproject");
  });
  vi.mocked(readdirSync).mockImplementation((p) => {
    const path = String(p);
    if (path === projectsDir)
      return ["-Users-neo-oldproject"] as unknown as ReturnType<
        typeof readdirSync
      >;
    if (path === projectDir)
      return ["old-sess.jsonl"] as unknown as ReturnType<typeof readdirSync>;
    return [] as unknown as ReturnType<typeof readdirSync>;
  });
  vi.mocked(statSync).mockImplementation((p) => {
    const path = String(p);
    const isDir = !path.endsWith(".jsonl");
    return {
      isDirectory: () => isDir,
      mtimeMs: NOW - 2 * 60 * 60 * 1000,
      size: 100,
    } as ReturnType<typeof statSync>;
  });
  vi.mocked(readFileSync).mockReturnValue("");
  vi.spyOn(Date, "now").mockReturnValue(NOW);

  const tree = discoverSessions(mockConfig);
  expect(tree.sessions).toHaveLength(1);
  // Status is cool (same UTC day as NOW) — calendar logic added in Task 3
  expect(tree.sessions[0].status).toBe("cool");
});
```

- [ ] **Step 7: Fix tests/config/globalConfig.test.ts**

Remove the `sessionTimeoutMs` assertions from the defaults test and the override test:

```typescript
it("returns defaults when config file does not exist", () => {
  vi.mocked(existsSync).mockReturnValue(false);
  const config = loadGlobalConfig();
  expect(config.refreshIntervalMs).toBe(2000);
  expect(config.logDir).toBe(join(homedir(), ".agenthud", "logs"));
  expect(config.hiddenSessions).toEqual([]);
  expect(config.hiddenSubAgents).toEqual([]);
});

it("overrides refreshInterval from config file", () => {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue("refreshInterval: 5s\n");
  const config = loadGlobalConfig();
  expect(config.refreshIntervalMs).toBe(5000);
});
```

- [ ] **Step 8: Fix tests/ui/SessionTreePanel.test.tsx**

Update `makeSession` default status from `"running"` to `"hot"`:

```typescript
const makeSession = (overrides: Partial<SessionNode> = {}): SessionNode => ({
  id: "abc123",
  filePath: "/home/user/.claude/projects/-proj/abc123.jsonl",
  projectPath: "/Users/neo/myproject",
  projectName: "myproject",
  lastModifiedMs: Date.now() - 5000,
  status: "hot",
  modelName: "sonnet-4.6",
  subAgents: [],
  ...overrides,
});
```

Update all tests that create sub-agents with `status: "running"` → `"hot"`, `status: "idle"` → `"cool"`:

- `"renders running sub-agent indented under parent"`: change `status: "running"` → `status: "hot"`
- `"collapses idle sub-agents into a summary line"`: change `status: "idle"` → `status: "cool"` for all 3 sub-agents
- `"shows running sub-agents individually and summarizes idle ones"`: change running sub-agent `status: "hot"`, idle sub-agents `status: "cool"`
- `"shows idle sub-agents individually when parent is in expandedIds"`: change `status: "idle"` → `status: "cool"`

Also update the test `"collapses idle sub-agents into a summary line"` assertion — it currently checks for `"3 idle"`. With the new subagent-summary row, the text will be `"3 cool"`:

```typescript
expect(frame).toContain("3 cool");
```

And `"shows running sub-agents individually and summarizes idle ones"` — update assertion:

```typescript
expect(frame).toContain("2 cool");
```

- [ ] **Step 9: Run all tests**

```bash
npm test
```

Expected: all 103 tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/ui/constants.ts src/types/index.ts src/data/sessions.ts \
  src/ui/SessionTreePanel.tsx src/ui/App.tsx \
  tests/data/sessions.test.ts tests/config/globalConfig.test.ts \
  tests/ui/SessionTreePanel.test.tsx
git commit -m "feat: rename session status to hot/warm/cool/cold, add ONE_HOUR_MS"
```

---

### Task 2: Calendar-based cool vs cold in getSessionStatus

**Files:**
- Modify: `src/data/sessions.ts`
- Modify: `tests/data/sessions.test.ts`

- [ ] **Step 1: Write failing tests for calendar logic**

In `tests/data/sessions.test.ts`, add a new describe block after the existing ones:

```typescript
describe("session status calendar logic", () => {
  it("marks session as cool when mtime is today (UTC) but older than 1 hour", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-proj");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return path === projectsDir || path.includes("-neo-proj");
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-proj"] as unknown as ReturnType<typeof readdirSync>;
      if (path === projectDir)
        return ["sess.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    // NOW = 2023-11-14 22:13 UTC. 2 hours earlier = 20:13 UTC same day.
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      return {
        isDirectory: () => !path.endsWith(".jsonl"),
        mtimeMs: NOW - 2 * 60 * 60 * 1000,
        size: 100,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockReturnValue("");
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.sessions[0].status).toBe("cool");
  });

  it("marks session as cold when mtime is a previous UTC day", () => {
    const projectsDir = join(
      process.env.HOME ?? "/home/user",
      ".claude",
      "projects",
    );
    const projectDir = join(projectsDir, "-Users-neo-proj");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      return path === projectsDir || path.includes("-neo-proj");
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-proj"] as unknown as ReturnType<typeof readdirSync>;
      if (path === projectDir)
        return ["sess.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    // 72 hours ago is always a previous UTC day regardless of timezone.
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      return {
        isDirectory: () => !path.endsWith(".jsonl"),
        mtimeMs: NOW - 72 * 60 * 60 * 1000,
        size: 100,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockReturnValue("");
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.sessions[0].status).toBe("cold");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/data/sessions.test.ts
```

Expected: the two new "calendar logic" tests fail because `getSessionStatus` currently returns `"cool"` for everything >= 1h.

- [ ] **Step 3: Implement calendar logic in getSessionStatus**

Replace the `getSessionStatus` function body in `src/data/sessions.ts`:

```typescript
function getSessionStatus(mtimeMs: number): SessionStatus {
  const now = Date.now();
  const age = now - mtimeMs;
  if (age < THIRTY_MINUTES_MS) return "hot";
  if (age < ONE_HOUR_MS) return "warm";

  // Use UTC date comparison for timezone-consistent behavior.
  const mtime = new Date(mtimeMs);
  const nowDate = new Date(now);
  if (
    mtime.getUTCFullYear() === nowDate.getUTCFullYear() &&
    mtime.getUTCMonth() === nowDate.getUTCMonth() &&
    mtime.getUTCDate() === nowDate.getUTCDate()
  ) {
    return "cool";
  }
  return "cold";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/data/sessions.ts tests/data/sessions.test.ts
git commit -m "feat: calendar-based cool/cold status (UTC day boundary)"
```

---

### Task 3: GlobalConfig — hiddenSessions/hiddenSubAgents + hide functions

**Files:**
- Modify: `src/config/globalConfig.ts`
- Modify: `tests/config/globalConfig.test.ts`

- [ ] **Step 1: Write failing tests**

Replace the entire `tests/config/globalConfig.test.ts` with:

```typescript
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
const { loadGlobalConfig, DEFAULT_GLOBAL_CONFIG, hideSession, hideSubAgent } =
  await import("../../src/config/globalConfig.js");

afterEach(() => {
  vi.resetAllMocks();
});

describe("loadGlobalConfig", () => {
  it("returns defaults when config file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const config = loadGlobalConfig();
    expect(config.refreshIntervalMs).toBe(2000);
    expect(config.logDir).toBe(join(homedir(), ".agenthud", "logs"));
    expect(config.hiddenSessions).toEqual([]);
    expect(config.hiddenSubAgents).toEqual([]);
  });

  it("overrides refreshInterval from config file", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("refreshInterval: 5s\n");
    const config = loadGlobalConfig();
    expect(config.refreshIntervalMs).toBe(5000);
  });

  it("parses hiddenSessions array from config file", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      "hiddenSessions:\n  - abc123\n  - def456\n",
    );
    const config = loadGlobalConfig();
    expect(config.hiddenSessions).toEqual(["abc123", "def456"]);
  });

  it("parses hiddenSubAgents array from config file", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      "hiddenSubAgents:\n  - agent-xyz\n",
    );
    const config = loadGlobalConfig();
    expect(config.hiddenSubAgents).toEqual(["agent-xyz"]);
  });

  it("ignores unknown keys", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("unknownKey: value\n");
    const config = loadGlobalConfig();
    expect(config).toEqual(expect.objectContaining(DEFAULT_GLOBAL_CONFIG));
  });
});

describe("hideSession", () => {
  it("writes session id to hiddenSessions in config", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(writeFileSync).mockImplementation(() => {});

    hideSession("abc123");

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const written = String(vi.mocked(writeFileSync).mock.calls[0][1]);
    expect(written).toContain("abc123");
  });

  it("does not add duplicate id", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      "hiddenSessions:\n  - abc123\n",
    );
    vi.mocked(writeFileSync).mockImplementation(() => {});

    hideSession("abc123");

    expect(writeFileSync).not.toHaveBeenCalled();
  });
});

describe("hideSubAgent", () => {
  it("writes sub-agent id to hiddenSubAgents in config", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(writeFileSync).mockImplementation(() => {});

    hideSubAgent("agent-xyz");

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const written = String(vi.mocked(writeFileSync).mock.calls[0][1]);
    expect(written).toContain("agent-xyz");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/config/globalConfig.test.ts
```

Expected: failures on `hiddenSessions`, `hiddenSubAgents`, `hideSession`, `hideSubAgent` (not yet exported/implemented).

- [ ] **Step 3: Implement globalConfig.ts changes**

Replace the full content of `src/config/globalConfig.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { GlobalConfig } from "../types/index.js";

const CONFIG_PATH = join(homedir(), ".agenthud", "config.yaml");

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  refreshIntervalMs: 2000,
  logDir: join(homedir(), ".agenthud", "logs"),
  hiddenSessions: [],
  hiddenSubAgents: [],
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
  if (typeof parsed.logDir === "string") {
    config.logDir = parsed.logDir.replace(/^~/, homedir());
  }
  if (Array.isArray(parsed.hiddenSessions)) {
    config.hiddenSessions = (parsed.hiddenSessions as unknown[]).filter(
      (s): s is string => typeof s === "string",
    );
  }
  if (Array.isArray(parsed.hiddenSubAgents)) {
    config.hiddenSubAgents = (parsed.hiddenSubAgents as unknown[]).filter(
      (s): s is string => typeof s === "string",
    );
  }

  return config;
}

function writeConfig(
  updates: Partial<Pick<GlobalConfig, "hiddenSessions" | "hiddenSubAgents">>,
): void {
  const configDir = join(homedir(), ".agenthud");
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  let raw: Record<string, unknown> = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      raw =
        (parseYaml(readFileSync(CONFIG_PATH, "utf-8")) as Record<
          string,
          unknown
        >) ?? {};
    } catch {
      raw = {};
    }
  }
  if (updates.hiddenSessions !== undefined)
    raw.hiddenSessions = updates.hiddenSessions;
  if (updates.hiddenSubAgents !== undefined)
    raw.hiddenSubAgents = updates.hiddenSubAgents;
  writeFileSync(CONFIG_PATH, stringifyYaml(raw), "utf-8");
}

export function hideSession(id: string): void {
  const config = loadGlobalConfig();
  if (config.hiddenSessions.includes(id)) return;
  writeConfig({ hiddenSessions: [...config.hiddenSessions, id] });
}

export function hideSubAgent(id: string): void {
  const config = loadGlobalConfig();
  if (config.hiddenSubAgents.includes(id)) return;
  writeConfig({ hiddenSubAgents: [...config.hiddenSubAgents, id] });
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
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/globalConfig.ts tests/config/globalConfig.test.ts
git commit -m "feat: add hideSession/hideSubAgent functions, parse hiddenSessions from config"
```

---

### Task 4: sessions.ts — hidden filtering tests

**Files:**
- Modify: `tests/data/sessions.test.ts`

- [ ] **Step 1: Write failing test for hidden session filtering**

Add to `tests/data/sessions.test.ts` inside the `describe("discoverSessions")` block:

```typescript
it("excludes sessions in hiddenSessions config", () => {
  const projectsDir = join(
    process.env.HOME ?? "/home/user",
    ".claude",
    "projects",
  );
  const projectDir = join(projectsDir, "-Users-neo-myproject");

  vi.mocked(existsSync).mockImplementation((p) => {
    const path = String(p);
    return path === projectsDir || path.includes("myproject");
  });
  vi.mocked(readdirSync).mockImplementation((p) => {
    const path = String(p);
    if (path === projectsDir)
      return ["-Users-neo-myproject"] as unknown as ReturnType<
        typeof readdirSync
      >;
    if (path === projectDir)
      return ["abc123.jsonl"] as unknown as ReturnType<typeof readdirSync>;
    return [] as unknown as ReturnType<typeof readdirSync>;
  });
  vi.mocked(statSync).mockImplementation((p) => {
    const path = String(p);
    return {
      isDirectory: () => !path.endsWith(".jsonl"),
      mtimeMs: NOW - 5_000,
      size: 100,
    } as ReturnType<typeof statSync>;
  });
  vi.mocked(readFileSync).mockReturnValue("");
  vi.spyOn(Date, "now").mockReturnValue(NOW);

  const configWithHidden = {
    ...mockConfig,
    hiddenSessions: ["abc123"],
  };

  const tree = discoverSessions(configWithHidden);
  expect(tree.sessions).toHaveLength(0);
  expect(tree.totalCount).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/data/sessions.test.ts
```

Expected: the new "excludes sessions in hiddenSessions config" test fails.

- [ ] **Step 3: Verify implementation already correct from Task 1**

The filter in `discoverSessions` was already set to `!config.hiddenSessions.includes(s.id)` in Task 1. Run tests again:

```bash
npm test -- tests/data/sessions.test.ts
```

Expected: all pass. (If the test still fails, verify that `discoverSessions` in `src/data/sessions.ts` uses `config.hiddenSessions` for filtering — the change was made in Task 1 Step 3.)

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/data/sessions.test.ts
git commit -m "test: add hidden session filtering test for discoverSessions"
```

---

### Task 5: SessionTreePanel — replace idle-summary with subagent-summary (hot/warm/cool/cold)

**Files:**
- Modify: `src/ui/SessionTreePanel.tsx`
- Modify: `tests/ui/SessionTreePanel.test.tsx`

- [ ] **Step 1: Write failing tests**

Add to `tests/ui/SessionTreePanel.test.tsx`:

```typescript
it("shows hot and warm sub-agents individually", () => {
  const session = makeSession({
    subAgents: [
      makeSession({ id: "h1", projectName: "", status: "hot", subAgents: [] }),
      makeSession({ id: "w1", projectName: "", status: "warm", subAgents: [] }),
    ],
  });
  const { lastFrame } = render(
    <SessionTreePanel
      sessions={[session]}
      selectedId={null}
      hasFocus={false}
      width={80}
    />,
  );
  expect(lastFrame()).toContain("»");
});

it("collapses cool sub-agents into a summary line", () => {
  const session = makeSession({
    subAgents: [
      makeSession({ id: "c1", projectName: "", status: "cool", subAgents: [] }),
      makeSession({ id: "c2", projectName: "", status: "cool", subAgents: [] }),
    ],
  });
  const { lastFrame } = render(
    <SessionTreePanel
      sessions={[session]}
      selectedId={null}
      hasFocus={false}
      width={80}
    />,
  );
  const frame = lastFrame() ?? "";
  expect(frame).not.toContain("»");
  expect(frame).toContain("2 cool");
});

it("shows combined cool and cold sub-agent summary", () => {
  const session = makeSession({
    subAgents: [
      makeSession({ id: "c1", projectName: "", status: "cool", subAgents: [] }),
      makeSession({ id: "d1", projectName: "", status: "cold", subAgents: [] }),
    ],
  });
  const { lastFrame } = render(
    <SessionTreePanel
      sessions={[session]}
      selectedId={null}
      hasFocus={false}
      width={80}
    />,
  );
  const frame = lastFrame() ?? "";
  expect(frame).toContain("1 cool");
  expect(frame).toContain("1 cold");
});

it("shows hot sub-agent individually and summarizes cool/cold", () => {
  const session = makeSession({
    subAgents: [
      makeSession({ id: "h1", projectName: "", status: "hot", subAgents: [] }),
      makeSession({ id: "c1", projectName: "", status: "cool", subAgents: [] }),
      makeSession({ id: "d1", projectName: "", status: "cold", subAgents: [] }),
    ],
  });
  const { lastFrame } = render(
    <SessionTreePanel
      sessions={[session]}
      selectedId={null}
      hasFocus={false}
      width={80}
    />,
  );
  const frame = lastFrame() ?? "";
  expect(frame).toContain("»");
  expect(frame).toContain("1 cool");
  expect(frame).toContain("1 cold");
});
```

Also update the existing expand test `"shows idle sub-agents individually when parent is in expandedIds"` to use `status: "cool"` and the assertion not to contain `"... 2 cool"`:

```typescript
it("shows cool sub-agents individually when parent is in expandedIds", () => {
  const session = makeSession({
    subAgents: [
      makeSession({ id: "i1", projectName: "", status: "cool", subAgents: [] }),
      makeSession({ id: "i2", projectName: "", status: "cool", subAgents: [] }),
    ],
  });
  const { lastFrame } = render(
    <SessionTreePanel
      sessions={[session]}
      selectedId={null}
      hasFocus={false}
      width={80}
      expandedIds={new Set(["abc123"])}
    />,
  );
  const frame = lastFrame() ?? "";
  expect(frame).toContain("»");
  expect(frame).not.toContain("... 2 cool");
});
```

- [ ] **Step 2: Run tests to verify new ones fail**

```bash
npm test -- tests/ui/SessionTreePanel.test.tsx
```

Expected: the 4 new tests fail.

- [ ] **Step 3: Rewrite FlatRow types and flattenSessions in SessionTreePanel.tsx**

Replace the `FlatRow` type:

```typescript
type FlatRow =
  | { kind: "session"; session: SessionNode; prefix: string }
  | { kind: "subagent-summary"; coolCount: number; coldCount: number }
  | { kind: "cold-sessions-summary"; count: number };
```

Replace `flattenSessions` in `SessionTreePanel.tsx`:

```typescript
function flattenSessions(
  sessions: SessionNode[],
  expandedIds: Set<string>,
): FlatRow[] {
  const result: FlatRow[] = [];

  const visibleSessions = sessions.filter((s) => s.status !== "cold");
  const coldSessions = sessions.filter((s) => s.status === "cold");

  for (const session of visibleSessions) {
    result.push({ kind: "session", session, prefix: "" });

    const isExpanded = expandedIds.has(session.id);
    const hotWarm = session.subAgents.filter(
      (s) => s.status === "hot" || s.status === "warm",
    );
    const cool = session.subAgents.filter((s) => s.status === "cool");
    const cold = session.subAgents.filter((s) => s.status === "cold");

    if (isExpanded) {
      const all = [...hotWarm, ...cool, ...cold];
      for (let i = 0; i < all.length; i++) {
        const isLast = i === all.length - 1;
        const treeChar = isLast ? "└─ " : "├─ ";
        result.push({
          kind: "session",
          session: all[i],
          prefix: `${treeChar}» `,
        });
      }
    } else {
      const hasSummary = cool.length > 0 || cold.length > 0;
      for (let i = 0; i < hotWarm.length; i++) {
        const isLast = i === hotWarm.length - 1 && !hasSummary;
        const treeChar = isLast ? "└─ " : "├─ ";
        result.push({
          kind: "session",
          session: hotWarm[i],
          prefix: `${treeChar}» `,
        });
      }
      if (hasSummary) {
        result.push({
          kind: "subagent-summary",
          coolCount: cool.length,
          coldCount: cold.length,
        });
      }
    }
  }

  if (coldSessions.length > 0) {
    result.push({ kind: "cold-sessions-summary", count: coldSessions.length });

    if (expandedIds.has("__cold__")) {
      for (const session of coldSessions) {
        result.push({ kind: "session", session, prefix: "" });

        const isExpanded = expandedIds.has(session.id);
        const hotWarm = session.subAgents.filter(
          (s) => s.status === "hot" || s.status === "warm",
        );
        const cool = session.subAgents.filter((s) => s.status === "cool");
        const cold = session.subAgents.filter((s) => s.status === "cold");

        if (isExpanded) {
          const all = [...hotWarm, ...cool, ...cold];
          for (let i = 0; i < all.length; i++) {
            const isLast = i === all.length - 1;
            result.push({
              kind: "session",
              session: all[i],
              prefix: `${isLast ? "└─ " : "├─ "}» `,
            });
          }
        } else {
          const hasSummary = cool.length > 0 || cold.length > 0;
          for (let i = 0; i < hotWarm.length; i++) {
            const isLast = i === hotWarm.length - 1 && !hasSummary;
            result.push({
              kind: "session",
              session: hotWarm[i],
              prefix: `${isLast ? "└─ " : "├─ "}» `,
            });
          }
          if (hasSummary) {
            result.push({
              kind: "subagent-summary",
              coolCount: cool.length,
              coldCount: cold.length,
            });
          }
        }
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: Replace IdleSummaryRow with SubagentSummaryRow**

Remove `IdleSummaryRow` and add:

```typescript
function SubagentSummaryRow({
  coolCount,
  coldCount,
  contentWidth,
}: {
  coolCount: number;
  coldCount: number;
  contentWidth: number;
}): React.ReactElement {
  const parts: string[] = [];
  if (coolCount > 0) parts.push(`${coolCount} cool`);
  if (coldCount > 0) parts.push(`${coldCount} cold`);
  const text = `└─ ... ${parts.join("  ")}`;
  const padding = Math.max(0, contentWidth - getDisplayWidth(text) - 1);
  return (
    <Text>
      {BOX.v} <Text dimColor>{text}</Text>
      {" ".repeat(padding)}
      {BOX.v}
    </Text>
  );
}
```

- [ ] **Step 5: Add ColdSessionsSummaryRow component**

Add after `SubagentSummaryRow`:

```typescript
function ColdSessionsSummaryRow({
  count,
  isSelected,
  hasFocus,
  width,
}: {
  count: number;
  isSelected: boolean;
  hasFocus: boolean;
  width: number;
}): React.ReactElement {
  const innerWidth = getInnerWidth(width);
  const label = ` ${count} cold `;
  const hint = isSelected && hasFocus ? " ↵ " : "";
  const hintWidth = getDisplayWidth(hint);
  const dashCount = Math.max(
    0,
    innerWidth - 2 - getDisplayWidth(label) - hintWidth,
  );
  const dashes = BOX.h.repeat(dashCount);
  const highlight = isSelected && hasFocus;
  return (
    <Text>
      <Text
        backgroundColor={highlight ? "blue" : undefined}
        bold={highlight}
        dimColor={!highlight}
      >
        {BOX.ml}
        {BOX.h}
        {label}
        {dashes}
        {hint}
        {BOX.mr}
      </Text>
    </Text>
  );
}
```

- [ ] **Step 6: Update the render loop in SessionTreePanel**

Replace the `displayRows.map(...)` block:

```typescript
{displayRows.map((row, idx) =>
  row.kind === "session" ? (
    <SessionRow
      key={`${row.session.id}-${idx}`}
      session={row.session}
      isSelected={row.session.id === selectedId}
      hasFocus={hasFocus}
      prefix={row.prefix}
      contentWidth={contentWidth}
    />
  ) : row.kind === "subagent-summary" ? (
    <SubagentSummaryRow
      key={`subagent-summary-${idx}`}
      coolCount={row.coolCount}
      coldCount={row.coldCount}
      contentWidth={contentWidth}
    />
  ) : (
    <ColdSessionsSummaryRow
      key="cold-summary"
      count={row.count}
      isSelected={selectedId === "__cold__"}
      hasFocus={hasFocus}
      width={width}
    />
  ),
)}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/ui/SessionTreePanel.tsx tests/ui/SessionTreePanel.test.tsx
git commit -m "feat: replace idle-summary with subagent-summary (cool/cold counts), add cold sessions row"
```

---

### Task 6: App.tsx — cold sentinel, navigation, and onHide wiring

**Files:**
- Modify: `src/ui/App.tsx`
- Modify: `tests/ui/SessionTreePanel.test.tsx`

- [ ] **Step 1: Write failing tests for cold sessions row in SessionTreePanel**

Add to `tests/ui/SessionTreePanel.test.tsx`:

```typescript
it("renders cold-sessions-summary row when cold sessions exist", () => {
  const coldSession = makeSession({
    id: "cold1",
    projectName: "oldproj",
    status: "cold",
    subAgents: [],
  });
  const { lastFrame } = render(
    <SessionTreePanel
      sessions={[coldSession]}
      selectedId={null}
      hasFocus={false}
      width={80}
    />,
  );
  expect(lastFrame()).toContain("1 cold");
  expect(lastFrame()).not.toContain("oldproj");
});

it("shows cold sessions when __cold__ is in expandedIds", () => {
  const coldSession = makeSession({
    id: "cold1",
    projectName: "oldproj",
    status: "cold",
    subAgents: [],
  });
  const { lastFrame } = render(
    <SessionTreePanel
      sessions={[coldSession]}
      selectedId={null}
      hasFocus={false}
      width={80}
      expandedIds={new Set(["__cold__"])}
    />,
  );
  expect(lastFrame()).toContain("oldproj");
});

it("highlights cold-sessions-summary row when selectedId is __cold__", () => {
  const coldSession = makeSession({
    id: "cold1",
    status: "cold",
    subAgents: [],
  });
  const { lastFrame } = render(
    <SessionTreePanel
      sessions={[coldSession]}
      selectedId="__cold__"
      hasFocus={true}
      width={80}
    />,
  );
  expect(lastFrame()).toContain("↵");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/ui/SessionTreePanel.test.tsx
```

Expected: the 3 new tests fail (cold sessions not yet separated from visible; `__cold__` not yet used in expand logic).

- [ ] **Step 3: Verify SessionTreePanel already handles cold sessions**

The `flattenSessions` in `SessionTreePanel.tsx` (written in Task 5) already separates cold sessions and respects `expandedIds.has("__cold__")`. If the tests still fail, check that the `flattenSessions` function is filtering `s.status !== "cold"` for `visibleSessions`.

Run:

```bash
npm test -- tests/ui/SessionTreePanel.test.tsx
```

Expected: all pass.

- [ ] **Step 4: Update App.tsx flattenSessions to include cold sentinel**

Replace the `flattenSessions` function in `src/ui/App.tsx`:

```typescript
function flattenSessions(
  tree: SessionTree,
  expandedIds: Set<string>,
): SessionNode[] {
  const result: SessionNode[] = [];

  const visible = tree.sessions.filter((s) => s.status !== "cold");
  const cold = tree.sessions.filter((s) => s.status === "cold");

  for (const s of visible) {
    result.push(s);
    if (expandedIds.has(s.id)) {
      result.push(...s.subAgents);
    } else {
      result.push(
        ...s.subAgents.filter(
          (sub) => sub.status === "hot" || sub.status === "warm",
        ),
      );
    }
  }

  if (cold.length > 0) {
    // Sentinel node — makes the cold summary row keyboard-navigable.
    result.push({
      id: "__cold__",
      filePath: "",
      projectPath: "",
      projectName: `${cold.length} cold`,
      lastModifiedMs: 0,
      status: "cold",
      modelName: null,
      subAgents: [],
    });
    if (expandedIds.has("__cold__")) {
      for (const s of cold) {
        result.push(s);
        if (expandedIds.has(s.id)) {
          result.push(...s.subAgents);
        } else {
          result.push(
            ...s.subAgents.filter(
              (sub) => sub.status === "hot" || sub.status === "warm",
            ),
          );
        }
      }
    }
  }

  return result;
}
```

- [ ] **Step 5: Guard against empty filePath in App.tsx activity loading**

In the `useEffect` that loads activities (around line 80), update the condition:

```typescript
useEffect(() => {
  const node = allFlatRef.current.find((s) => s.id === selectedId);
  if (node && node.filePath) {
    setActivities(parseSessionHistory(node.filePath));
    setScrollOffset(0);
    setIsLive(true);
    setNewCount(0);
  } else {
    setActivities([]);
  }
}, [selectedId]);
```

Also update the `refresh` callback to guard the same way:

```typescript
const node = updatedFlat.find((s) => s.id === selectedId);
if (!node || !node.filePath) return;
```

- [ ] **Step 6: Update onEnter in App.tsx to handle __cold__**

Replace the `onEnter` callback:

```typescript
onEnter: () => {
  if (focus !== "tree" || !selectedId) return;

  if (selectedId === "__cold__") {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has("__cold__")) {
        next.delete("__cold__");
      } else {
        next.add("__cold__");
      }
      return next;
    });
    return;
  }

  const parentSession = sessionTree.sessions.find(
    (s) => s.id === selectedId,
  );
  if (
    !parentSession ||
    !parentSession.subAgents.some(
      (s) => s.status === "cool" || s.status === "cold",
    )
  )
    return;
  setExpandedIds((prev) => {
    const next = new Set(prev);
    if (next.has(selectedId)) {
      next.delete(selectedId);
    } else {
      next.add(selectedId);
    }
    return next;
  });
},
```

- [ ] **Step 7: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/ui/App.tsx tests/ui/SessionTreePanel.test.tsx
git commit -m "feat: cold sessions sentinel in App navigation, __cold__ expand/collapse"
```

---

### Task 7: useHotkeys — h key + App onHide handler

**Files:**
- Modify: `src/ui/hooks/useHotkeys.ts`
- Modify: `src/ui/App.tsx`
- Modify: `tests/ui/hooks/useHotkeys.test.ts`

- [ ] **Step 1: Write failing tests**

In `tests/ui/hooks/useHotkeys.test.ts`, update `makeOptions` to include `onHide`:

```typescript
function makeOptions(overrides = {}) {
  return {
    focus: "tree" as const,
    onSwitchFocus: vi.fn(),
    onScrollUp: vi.fn(),
    onScrollDown: vi.fn(),
    onScrollPageUp: vi.fn(),
    onScrollPageDown: vi.fn(),
    onScrollTop: vi.fn(),
    onScrollBottom: vi.fn(),
    onSaveLog: vi.fn(),
    onRefresh: vi.fn(),
    onQuit: vi.fn(),
    onEnter: vi.fn(),
    onHide: vi.fn(),
    ...overrides,
  };
}
```

Add tests in the `"global keys"` describe block:

```typescript
it("calls onHide when h is pressed in tree focus", () => {
  const onHide = vi.fn();
  const { result } = renderHook(() =>
    useHotkeys(makeOptions({ focus: "tree", onHide })),
  );
  act(() => result.current.handleInput("h", noopKey));
  expect(onHide).toHaveBeenCalledTimes(1);
});

it("does not call onHide when h is pressed in viewer focus", () => {
  const onHide = vi.fn();
  const { result } = renderHook(() =>
    useHotkeys(makeOptions({ focus: "viewer", onHide })),
  );
  act(() => result.current.handleInput("h", noopKey));
  expect(onHide).not.toHaveBeenCalled();
});
```

Update the `"statusBarItems"` test for tree focus to include `"h: hide"`:

```typescript
it("returns tree-focus status bar items when focus is tree", () => {
  const { result } = renderHook(() =>
    useHotkeys(makeOptions({ focus: "tree" })),
  );
  expect(result.current.statusBarItems).toEqual([
    "Tab: viewer",
    "↑↓/jk: select",
    "PgUp/Dn: page",
    "↵: expand",
    "h: hide",
    "r: refresh",
    "q: quit",
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- tests/ui/hooks/useHotkeys.test.ts
```

Expected: tests for `onHide` and updated statusBar fail.

- [ ] **Step 3: Implement useHotkeys changes**

Replace `src/ui/hooks/useHotkeys.ts`:

```typescript
// src/ui/hooks/useHotkeys.ts
interface UseHotkeysOptions {
  focus: "tree" | "viewer";
  onSwitchFocus: () => void;
  onScrollUp: () => void;
  onScrollDown: () => void;
  onScrollPageUp: () => void;
  onScrollPageDown: () => void;
  onScrollTop: () => void;
  onScrollBottom: () => void;
  onSaveLog: () => void;
  onRefresh: () => void;
  onQuit: () => void;
  onEnter: () => void;
  onHide: () => void;
}

export interface UseHotkeysResult {
  handleInput: (
    input: string,
    key: {
      upArrow: boolean;
      downArrow: boolean;
      tab: boolean;
      pageUp: boolean;
      pageDown: boolean;
      return: boolean;
    },
  ) => void;
  statusBarItems: string[];
}

export function useHotkeys({
  focus,
  onSwitchFocus,
  onScrollUp,
  onScrollDown,
  onScrollPageUp,
  onScrollPageDown,
  onScrollTop,
  onScrollBottom,
  onSaveLog,
  onRefresh,
  onQuit,
  onEnter,
  onHide,
}: UseHotkeysOptions): UseHotkeysResult {
  const handleInput = (
    input: string,
    key: {
      upArrow: boolean;
      downArrow: boolean;
      tab: boolean;
      pageUp: boolean;
      pageDown: boolean;
      return: boolean;
    },
  ) => {
    if (input === "q") {
      onQuit();
      return;
    }
    if (key.tab) {
      onSwitchFocus();
      return;
    }
    if (key.return) {
      onEnter();
      return;
    }
    if (input === "r") {
      onRefresh();
      return;
    }

    if (key.pageUp) {
      onScrollPageUp();
      return;
    }
    if (key.pageDown) {
      onScrollPageDown();
      return;
    }

    if (focus === "tree") {
      if (input === "h") {
        onHide();
        return;
      }
      if (key.upArrow || input === "k") {
        onScrollUp();
        return;
      }
      if (key.downArrow || input === "j") {
        onScrollDown();
        return;
      }
    }

    if (focus === "viewer") {
      if (key.upArrow || input === "k") {
        onScrollUp();
        return;
      }
      if (key.downArrow || input === "j") {
        onScrollDown();
        return;
      }
      if (input === "g") {
        onScrollTop();
        return;
      }
      if (input === "G") {
        onScrollBottom();
        return;
      }
      if (input === "s") {
        onSaveLog();
        return;
      }
    }
  };

  const statusBarItems =
    focus === "tree"
      ? [
          "Tab: viewer",
          "↑↓/jk: select",
          "PgUp/Dn: page",
          "↵: expand",
          "h: hide",
          "r: refresh",
          "q: quit",
        ]
      : [
          "Tab: tree",
          "↑↓/jk: scroll",
          "PgUp/Dn: page",
          "g: top",
          "G: live",
          "s: save",
          "q: quit",
        ];

  return { handleInput, statusBarItems };
}
```

- [ ] **Step 4: Add onHide handler in App.tsx**

Add imports at the top of `src/ui/App.tsx`:

```typescript
import { hideSession, hideSubAgent } from "../config/globalConfig.js";
```

Add the `onHide` callback inside the `useHotkeys` call (after `onSaveLog`):

```typescript
onHide: () => {
  if (focus !== "tree" || !selectedId) return;

  if (selectedId === "__cold__") {
    const coldSessions = sessionTree.sessions.filter(
      (s) => s.status === "cold",
    );
    for (const s of coldSessions) hideSession(s.id);
    refresh();
    return;
  }

  if (sessionTree.sessions.some((s) => s.id === selectedId)) {
    hideSession(selectedId);
    refresh();
    return;
  }

  for (const s of sessionTree.sessions) {
    if (s.subAgents.some((sa) => sa.id === selectedId)) {
      hideSubAgent(selectedId);
      refresh();
      return;
    }
  }
},
```

Also pass `onHide` to `useHotkeys` in the destructure:

```typescript
const { handleInput, statusBarItems } = useHotkeys({
  // ... existing callbacks ...
  onHide,
});
```

Wait — `onHide` is defined inline above; it's not a separate variable. The pattern in App.tsx is that `useHotkeys` receives an object literal with all callbacks. Add `onHide` as an inline function:

```typescript
const { handleInput, statusBarItems } = useHotkeys({
  focus,
  onSwitchFocus: () => setFocus((f) => (f === "tree" ? "viewer" : "tree")),
  // ... existing callbacks unchanged ...
  onHide: () => {
    if (focus !== "tree" || !selectedId) return;

    if (selectedId === "__cold__") {
      const coldSessions = sessionTree.sessions.filter(
        (s) => s.status === "cold",
      );
      for (const s of coldSessions) hideSession(s.id);
      refresh();
      return;
    }

    if (sessionTree.sessions.some((s) => s.id === selectedId)) {
      hideSession(selectedId);
      refresh();
      return;
    }

    for (const s of sessionTree.sessions) {
      if (s.subAgents.some((sa) => sa.id === selectedId)) {
        hideSubAgent(selectedId);
        refresh();
        return;
      }
    }
  },
  onSaveLog: saveLog,
  onRefresh: refresh,
  onQuit: exit,
});
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Run lint**

```bash
npx biome check src/ tests/
```

Fix any issues with:

```bash
npx biome check --write src/ tests/
```

- [ ] **Step 7: Commit**

```bash
git add src/ui/hooks/useHotkeys.ts src/ui/App.tsx \
  tests/ui/hooks/useHotkeys.test.ts
git commit -m "feat: add h key to hide sessions/sub-agents, persist to config"
```
