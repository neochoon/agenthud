# Project-Grouped Session Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the AgentHUD session tree so sessions are grouped under their project node. Non-interactive (`claude -p` / SDK) sessions are visually distinguished. Cold projects collapse to a single row at the bottom.

**Architecture:** Add `ProjectNode` wrapping `SessionNode[]`. Detect `nonInteractive` via JSONL `entrypoint === "sdk-cli"`. Rebuild `SessionTreePanel` to render 3-level tree (project → session → sub-agent) with non-interactive sessions in parens+dim. Add `hiddenProjects` config.

**Tech Stack:** TypeScript, React/Ink, Vitest. No new dependencies.

---

## File Structure

| File | Change |
|------|--------|
| `src/types/index.ts` | Modify — add `ProjectNode`, `nonInteractive`, `hiddenProjects`, change `SessionTree` shape |
| `src/data/sessions.ts` | Modify — build `ProjectNode[]`, read `entrypoint`, partition cold projects |
| `src/config/globalConfig.ts` | Modify — parse `hiddenProjects`, add `hideProject()` |
| `src/ui/SessionTreePanel.tsx` | Modify — render project nodes, depth 3, non-interactive style |
| `src/ui/App.tsx` | Modify — flatten new tree, handle project node in onEnter/onHide/selection |
| `tests/data/sessions.test.ts` | Modify — assertions on new tree shape, `nonInteractive` detection |
| `tests/config/globalConfig.test.ts` | Modify — `hiddenProjects` parsing |
| `tests/ui/SessionTreePanel.test.tsx` | Modify — render project headers and indented sessions |
| `tests/ui/App.test.tsx` | Modify — mocked tree shape |
| `tests/integration/config.test.tsx` | Modify — mocked tree shape |

---

## Task 1: Type changes

**Files:**
- Modify: `src/types/index.ts`

This task is non-breaking on its own — types compile, but downstream code still uses old shape. Subsequent tasks update the consumers.

- [ ] **Step 1: Update `src/types/index.ts`**

Add `nonInteractive` to `SessionNode`:

```typescript
export interface SessionNode {
  id: string;
  hideKey: string;
  filePath: string;
  projectPath: string;
  projectName: string;
  lastModifiedMs: number;
  status: SessionStatus;
  modelName: string | null;
  subAgents: SessionNode[];
  agentId?: string;
  taskDescription?: string;
  nonInteractive: boolean; // NEW — true when entrypoint === "sdk-cli"
}
```

Add `ProjectNode` before `SessionTree`:

```typescript
export interface ProjectNode {
  name: string;          // basename of projectPath
  projectPath: string;   // decoded full path
  sessions: SessionNode[]; // sorted: interactive→non-interactive, then status→mtime
  hotness: SessionStatus;  // hottest session's status
}
```

Replace `SessionTree`:

```typescript
export interface SessionTree {
  projects: ProjectNode[];      // active projects (hotness !== "cold")
  coldProjects: ProjectNode[];  // projects where all sessions are cold
  totalCount: number;           // total sessions across both arrays + sub-agents
  timestamp: string;
}
```

Add `hiddenProjects` to `GlobalConfig`:

```typescript
export interface GlobalConfig {
  refreshIntervalMs: number;
  logDir: string;
  hiddenSessions: string[];
  hiddenSubAgents: string[];
  filterPresets: string[][];
  hiddenProjects: string[]; // NEW — by projectName
}
```

- [ ] **Step 2: Update DEFAULT_GLOBAL_CONFIG in `src/config/globalConfig.ts`**

```typescript
export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  refreshIntervalMs: 2000,
  logDir: join(homedir(), ".agenthud", "logs"),
  hiddenSessions: [],
  hiddenSubAgents: [],
  filterPresets: [[], ["response"], ["commit"]],
  hiddenProjects: [], // NEW
};
```

- [ ] **Step 3: TypeScript compile check**

```bash
cd /Users/neochoon/WestbrookAI/agenthud && npx tsc --noEmit
```

Expect MANY errors — every consumer of `SessionTree.sessions` or `SessionNode` constructor must be updated. That's OK; those are the next tasks.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/config/globalConfig.ts
git commit -m "feat: add ProjectNode, nonInteractive, hiddenProjects types"
```

---

## Task 2: `readEntrypoint` + `nonInteractive` detection

**Files:**
- Modify: `src/data/sessions.ts`
- Modify: `tests/data/sessions.test.ts`

- [ ] **Step 1: Write failing test for nonInteractive detection**

In `tests/data/sessions.test.ts`, find the existing `"discovers a top-level session with no sub-agents"` test (around line 37). Update its `readFileSync` mock to return JSONL with `entrypoint: "sdk-cli"` and assert `nonInteractive: true`.

Add a NEW test below it:

```typescript
it("marks session non-interactive when entrypoint is sdk-cli", () => {
  const projectsDir = join(process.env.HOME ?? "/home/user", ".claude", "projects");
  const projectDir = join(projectsDir, "-Users-neo-myproject");
  const sessionFile = join(projectDir, "ndi123.jsonl");

  vi.mocked(existsSync).mockImplementation((p) => {
    const path = String(p);
    if (path === projectsDir || path === projectDir || path === sessionFile) return true;
    if (path.includes("subagents")) return false;
    return false;
  });
  vi.mocked(readdirSync).mockImplementation((p) => {
    const path = String(p);
    if (path === projectsDir) return ["-Users-neo-myproject"] as unknown as ReturnType<typeof readdirSync>;
    if (path === projectDir) return ["ndi123.jsonl"] as unknown as ReturnType<typeof readdirSync>;
    return [] as unknown as ReturnType<typeof readdirSync>;
  });
  vi.mocked(statSync).mockImplementation((p) => ({
    isDirectory: () => String(p) === projectDir,
    mtimeMs: NOW - 10_000,
    size: 1000,
  }) as ReturnType<typeof statSync>);
  vi.mocked(readFileSync).mockReturnValue(
    `${JSON.stringify({ entrypoint: "sdk-cli", type: "assistant", message: { model: "<synthetic>", content: [] }, timestamp: new Date(NOW - 10_000).toISOString() })}\n`,
  );
  vi.spyOn(Date, "now").mockReturnValue(NOW);

  const tree = discoverSessions(mockConfig);
  expect(tree.projects[0].sessions[0].nonInteractive).toBe(true);
});

it("marks session interactive when entrypoint is cli", () => {
  const projectsDir = join(process.env.HOME ?? "/home/user", ".claude", "projects");
  const projectDir = join(projectsDir, "-Users-neo-myproject");
  const sessionFile = join(projectDir, "int123.jsonl");

  vi.mocked(existsSync).mockImplementation((p) => {
    const path = String(p);
    if (path === projectsDir || path === projectDir || path === sessionFile) return true;
    return false;
  });
  vi.mocked(readdirSync).mockImplementation((p) => {
    const path = String(p);
    if (path === projectsDir) return ["-Users-neo-myproject"] as unknown as ReturnType<typeof readdirSync>;
    if (path === projectDir) return ["int123.jsonl"] as unknown as ReturnType<typeof readdirSync>;
    return [] as unknown as ReturnType<typeof readdirSync>;
  });
  vi.mocked(statSync).mockImplementation((p) => ({
    isDirectory: () => String(p) === projectDir,
    mtimeMs: NOW - 10_000,
    size: 1000,
  }) as ReturnType<typeof statSync>);
  vi.mocked(readFileSync).mockReturnValue(
    `${JSON.stringify({ entrypoint: "cli", type: "assistant", message: { model: "claude-sonnet-4-6", content: [] }, timestamp: new Date(NOW - 10_000).toISOString() })}\n`,
  );
  vi.spyOn(Date, "now").mockReturnValue(NOW);

  const tree = discoverSessions(mockConfig);
  expect(tree.projects[0].sessions[0].nonInteractive).toBe(false);
});

it("defaults to interactive when entrypoint is missing", () => {
  const projectsDir = join(process.env.HOME ?? "/home/user", ".claude", "projects");
  const projectDir = join(projectsDir, "-Users-neo-myproject");
  const sessionFile = join(projectDir, "old123.jsonl");

  vi.mocked(existsSync).mockImplementation((p) => {
    const path = String(p);
    if (path === projectsDir || path === projectDir || path === sessionFile) return true;
    return false;
  });
  vi.mocked(readdirSync).mockImplementation((p) => {
    const path = String(p);
    if (path === projectsDir) return ["-Users-neo-myproject"] as unknown as ReturnType<typeof readdirSync>;
    if (path === projectDir) return ["old123.jsonl"] as unknown as ReturnType<typeof readdirSync>;
    return [] as unknown as ReturnType<typeof readdirSync>;
  });
  vi.mocked(statSync).mockImplementation((p) => ({
    isDirectory: () => String(p) === projectDir,
    mtimeMs: NOW - 10_000,
    size: 1000,
  }) as ReturnType<typeof statSync>);
  // No entrypoint field
  vi.mocked(readFileSync).mockReturnValue(
    `${JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-4-6", content: [] }, timestamp: new Date(NOW - 10_000).toISOString() })}\n`,
  );
  vi.spyOn(Date, "now").mockReturnValue(NOW);

  const tree = discoverSessions(mockConfig);
  expect(tree.projects[0].sessions[0].nonInteractive).toBe(false);
});
```

- [ ] **Step 2: Run and confirm tests fail**

```bash
npm test -- tests/data/sessions.test.ts
```

Expect: tree shape is wrong (current returns `tree.sessions`, not `tree.projects`). That's expected — we fix in Task 3.

For now, skip those new assertions and run only the entrypoint helper test in isolation by extracting `readEntrypoint` first:

- [ ] **Step 3: Add `readEntrypoint` helper to `src/data/sessions.ts`**

Insert this near `readModelName` (around line 79):

```typescript
function readEntrypoint(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const firstLine = readFileSync(filePath, "utf-8").split("\n")[0];
    if (!firstLine) return null;
    const entry = JSON.parse(firstLine);
    return typeof entry.entrypoint === "string" ? entry.entrypoint : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Update session construction in `discoverSessions` to include `nonInteractive`**

Find the `allSessions.push({...})` call (around line 195). Add the field:

```typescript
allSessions.push({
  id,
  hideKey,
  filePath,
  projectPath: decodedPath,
  projectName,
  lastModifiedMs: stat.mtimeMs,
  status: getSessionStatus(stat.mtimeMs),
  modelName: readModelName(filePath),
  subAgents,
  nonInteractive: readEntrypoint(filePath) === "sdk-cli", // NEW
});
```

Also update `buildSubAgents` to set `nonInteractive: false` on sub-agent SessionNodes (sub-agents are always "real" Claude work). In `buildSubAgents`, in the `return { id, ... }` block (around line 124), add `nonInteractive: false`:

```typescript
return {
  id,
  hideKey,
  filePath,
  projectPath: "",
  projectName: "",
  lastModifiedMs: stat.mtimeMs,
  status: getSessionStatus(stat.mtimeMs),
  modelName: readModelName(filePath),
  subAgents: [],
  agentId: agentId ?? undefined,
  taskDescription: taskDescription ?? undefined,
  nonInteractive: false, // NEW — sub-agents are always interactive Claude work
};
```

- [ ] **Step 5: Compile check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expect: errors still — `SessionTree.sessions` doesn't exist anymore (it's `projects`). Those go in Task 3.

- [ ] **Step 6: Commit**

```bash
git add src/data/sessions.ts tests/data/sessions.test.ts
git commit -m "feat: read entrypoint and set nonInteractive on SessionNode"
```

---

## Task 3: Project grouping in `discoverSessions`

**Files:**
- Modify: `src/data/sessions.ts`
- Modify: `tests/data/sessions.test.ts`

- [ ] **Step 1: Replace return shape in `discoverSessions`**

Replace the bottom of `discoverSessions` (from `allSessions.sort(...)` to `return {...}`) with:

```typescript
  // Group by projectPath
  const byProject = new Map<string, SessionNode[]>();
  for (const s of allSessions) {
    if (config.hiddenSessions.includes(s.hideKey)) continue;
    const arr = byProject.get(s.projectPath) ?? [];
    arr.push(s);
    byProject.set(s.projectPath, arr);
  }

  const statusOrder: Record<SessionStatus, number> = {
    hot: 0,
    warm: 1,
    cool: 2,
    cold: 3,
  };

  const allProjects: ProjectNode[] = [];
  for (const [projectPath, sessions] of byProject) {
    if (sessions.length === 0) continue;
    const projectName = sessions[0].projectName;
    if (config.hiddenProjects.includes(projectName)) continue;

    // Sort: interactive first, then by status, then by mtime desc
    sessions.sort((a, b) => {
      if (a.nonInteractive !== b.nonInteractive) {
        return a.nonInteractive ? 1 : -1;
      }
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return b.lastModifiedMs - a.lastModifiedMs;
    });

    const hotness = sessions[0].status; // hottest = first after sort

    allProjects.push({ name: projectName, projectPath, sessions, hotness });
  }

  // Partition cold vs active
  const activeProjects = allProjects.filter((p) => p.hotness !== "cold");
  const coldProjects = allProjects.filter((p) => p.hotness === "cold");

  // Sort active projects by hottest session's status, then mtime of hottest session
  activeProjects.sort((a, b) => {
    const statusDiff = statusOrder[a.hotness] - statusOrder[b.hotness];
    if (statusDiff !== 0) return statusDiff;
    return b.sessions[0].lastModifiedMs - a.sessions[0].lastModifiedMs;
  });

  const totalCount =
    activeProjects.reduce((sum, p) => sum + p.sessions.length + p.sessions.reduce((s, sn) => s + sn.subAgents.length, 0), 0) +
    coldProjects.reduce((sum, p) => sum + p.sessions.length + p.sessions.reduce((s, sn) => s + sn.subAgents.length, 0), 0);

  return {
    projects: activeProjects,
    coldProjects,
    totalCount,
    timestamp: new Date().toISOString(),
  };
}
```

Also update the empty-tree return paths (around lines 156 and 169) to use the new shape:

```typescript
return {
  projects: [],
  coldProjects: [],
  totalCount: 0,
  timestamp: new Date().toISOString(),
};
```

Make sure `ProjectNode` and `SessionStatus` are imported at the top of the file. The existing import already pulls `SessionNode`, `SessionStatus`, `SessionTree` from types. Add `ProjectNode`:

```typescript
import type {
  GlobalConfig,
  ProjectNode,
  SessionNode,
  SessionStatus,
  SessionTree,
} from "../types/index.js";
```

- [ ] **Step 2: Update existing tests in `tests/data/sessions.test.ts`**

Every existing test asserts `tree.sessions[N]`. Update them all to `tree.projects[N].sessions[0]` (or whatever index reflects the new structure).

Find patterns like:
- `expect(tree.sessions).toHaveLength(1)` → `expect(tree.projects).toHaveLength(1)` AND `expect(tree.projects[0].sessions).toHaveLength(1)`
- `expect(tree.sessions[0].id).toBe("abc123")` → `expect(tree.projects[0].sessions[0].id).toBe("abc123")`
- `expect(tree.sessions[0].status).toBe("hot")` → `expect(tree.projects[0].sessions[0].status).toBe("hot")`

For the "marks session as cold" test, expect `tree.projects` empty and `tree.coldProjects` to have 1.

Also: any place that constructs a mock `SessionNode` (via `makeSession()` factory or inline) needs `nonInteractive: false` added.

- [ ] **Step 3: Add test for project-level grouping**

Add to `tests/data/sessions.test.ts`:

```typescript
it("groups multiple sessions of the same project under one ProjectNode", () => {
  const projectsDir = join(process.env.HOME ?? "/home/user", ".claude", "projects");
  const projectDir = join(projectsDir, "-Users-neo-proj");

  vi.mocked(existsSync).mockImplementation((p) => {
    const path = String(p);
    return path === projectsDir || path.includes("-neo-proj");
  });
  vi.mocked(readdirSync).mockImplementation((p) => {
    const path = String(p);
    if (path === projectsDir) return ["-Users-neo-proj"] as unknown as ReturnType<typeof readdirSync>;
    if (path === projectDir) return ["s1.jsonl", "s2.jsonl"] as unknown as ReturnType<typeof readdirSync>;
    return [] as unknown as ReturnType<typeof readdirSync>;
  });
  vi.mocked(statSync).mockImplementation((p) => ({
    isDirectory: () => !String(p).endsWith(".jsonl"),
    mtimeMs: NOW - 10_000,
    size: 100,
  }) as ReturnType<typeof statSync>);
  vi.mocked(readFileSync).mockReturnValue("");
  vi.spyOn(Date, "now").mockReturnValue(NOW);

  const tree = discoverSessions(mockConfig);
  expect(tree.projects).toHaveLength(1);
  expect(tree.projects[0].name).toBe("proj");
  expect(tree.projects[0].sessions).toHaveLength(2);
});

it("places projects where all sessions are cold into coldProjects", () => {
  const projectsDir = join(process.env.HOME ?? "/home/user", ".claude", "projects");
  const projectDir = join(projectsDir, "-Users-neo-old");

  vi.mocked(existsSync).mockImplementation((p) => {
    const path = String(p);
    return path === projectsDir || path.includes("-neo-old");
  });
  vi.mocked(readdirSync).mockImplementation((p) => {
    const path = String(p);
    if (path === projectsDir) return ["-Users-neo-old"] as unknown as ReturnType<typeof readdirSync>;
    if (path === projectDir) return ["o1.jsonl"] as unknown as ReturnType<typeof readdirSync>;
    return [] as unknown as ReturnType<typeof readdirSync>;
  });
  vi.mocked(statSync).mockImplementation((p) => ({
    isDirectory: () => !String(p).endsWith(".jsonl"),
    mtimeMs: NOW - 72 * 60 * 60 * 1000, // 3 days ago
    size: 100,
  }) as ReturnType<typeof statSync>);
  vi.mocked(readFileSync).mockReturnValue("");
  vi.spyOn(Date, "now").mockReturnValue(NOW);

  const tree = discoverSessions(mockConfig);
  expect(tree.projects).toHaveLength(0);
  expect(tree.coldProjects).toHaveLength(1);
  expect(tree.coldProjects[0].sessions).toHaveLength(1);
});

it("filters out hidden projects entirely", () => {
  const projectsDir = join(process.env.HOME ?? "/home/user", ".claude", "projects");
  const projectDir = join(projectsDir, "-Users-neo-secret");

  vi.mocked(existsSync).mockImplementation((p) => {
    const path = String(p);
    return path === projectsDir || path.includes("-neo-secret");
  });
  vi.mocked(readdirSync).mockImplementation((p) => {
    const path = String(p);
    if (path === projectsDir) return ["-Users-neo-secret"] as unknown as ReturnType<typeof readdirSync>;
    if (path === projectDir) return ["a.jsonl"] as unknown as ReturnType<typeof readdirSync>;
    return [] as unknown as ReturnType<typeof readdirSync>;
  });
  vi.mocked(statSync).mockImplementation((p) => ({
    isDirectory: () => !String(p).endsWith(".jsonl"),
    mtimeMs: NOW - 10_000,
    size: 100,
  }) as ReturnType<typeof statSync>);
  vi.mocked(readFileSync).mockReturnValue("");
  vi.spyOn(Date, "now").mockReturnValue(NOW);

  const configWithHidden = { ...mockConfig, hiddenProjects: ["secret"] };
  const tree = discoverSessions(configWithHidden);
  expect(tree.projects).toHaveLength(0);
  expect(tree.coldProjects).toHaveLength(0);
});

it("sorts sessions within a project: interactive before non-interactive", () => {
  const projectsDir = join(process.env.HOME ?? "/home/user", ".claude", "projects");
  const projectDir = join(projectsDir, "-Users-neo-mix");

  vi.mocked(existsSync).mockImplementation((p) => {
    const path = String(p);
    return path === projectsDir || path.includes("-neo-mix");
  });
  vi.mocked(readdirSync).mockImplementation((p) => {
    const path = String(p);
    if (path === projectsDir) return ["-Users-neo-mix"] as unknown as ReturnType<typeof readdirSync>;
    if (path === projectDir) return ["sdk.jsonl", "cli.jsonl"] as unknown as ReturnType<typeof readdirSync>;
    return [] as unknown as ReturnType<typeof readdirSync>;
  });
  vi.mocked(statSync).mockImplementation((p) => ({
    isDirectory: () => !String(p).endsWith(".jsonl"),
    mtimeMs: NOW - 10_000,
    size: 100,
  }) as ReturnType<typeof statSync>);
  vi.mocked(readFileSync).mockImplementation((p) => {
    const path = String(p);
    if (path.endsWith("sdk.jsonl")) {
      return JSON.stringify({ entrypoint: "sdk-cli", type: "assistant", message: { model: "<synthetic>", content: [] }, timestamp: new Date(NOW - 10_000).toISOString() }) + "\n";
    }
    return JSON.stringify({ entrypoint: "cli", type: "assistant", message: { model: "claude-sonnet-4-6", content: [] }, timestamp: new Date(NOW - 10_000).toISOString() }) + "\n";
  });
  vi.spyOn(Date, "now").mockReturnValue(NOW);

  const tree = discoverSessions(mockConfig);
  expect(tree.projects).toHaveLength(1);
  const sessions = tree.projects[0].sessions;
  expect(sessions[0].nonInteractive).toBe(false); // interactive first
  expect(sessions[1].nonInteractive).toBe(true);
});
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/data/sessions.test.ts
```

Expect: all tests pass after migration. If any fails, fix the assertion to match new structure.

- [ ] **Step 5: Commit**

```bash
git add src/data/sessions.ts tests/data/sessions.test.ts
git commit -m "feat: group sessions under ProjectNode in discoverSessions"
```

---

## Task 4: `hiddenProjects` config parsing + `hideProject()`

**Files:**
- Modify: `src/config/globalConfig.ts`
- Modify: `tests/config/globalConfig.test.ts`

- [ ] **Step 1: Add failing test**

In `tests/config/globalConfig.test.ts`, add a test asserting YAML with `hiddenProjects: [foo, bar]` produces `config.hiddenProjects === ["foo", "bar"]`. Pattern matches the existing `hiddenSessions` test.

- [ ] **Step 2: Add parsing in `loadGlobalConfig`**

In `src/config/globalConfig.ts`, find the existing `if (Array.isArray(parsed.hiddenSubAgents)) {...}` block. Add immediately after:

```typescript
if (Array.isArray(parsed.hiddenProjects)) {
  config.hiddenProjects = (parsed.hiddenProjects as unknown[]).filter(
    (s): s is string => typeof s === "string",
  );
}
```

- [ ] **Step 3: Add `hideProject()` function**

In `src/config/globalConfig.ts`, find the existing `hideSubAgent()` function (around line 97). Add after it:

```typescript
export function hideProject(name: string): void {
  const config = loadGlobalConfig();
  if (config.hiddenProjects.includes(name)) return;
  writeConfig({ hiddenProjects: [...config.hiddenProjects, name] });
}
```

Update the `writeConfig` type signature and body to handle `hiddenProjects`. Find the existing `writeConfig` (around line 65). Change the `updates` type:

```typescript
function writeConfig(
  updates: Partial<Pick<GlobalConfig, "hiddenSessions" | "hiddenSubAgents" | "hiddenProjects">>,
): void {
```

In its body, add (alongside the existing `hiddenSessions` and `hiddenSubAgents` lines):

```typescript
if (updates.hiddenProjects !== undefined)
  raw.hiddenProjects = updates.hiddenProjects;
```

- [ ] **Step 4: Run tests**

```bash
npm test -- tests/config/globalConfig.test.ts
```

Expect: pass.

- [ ] **Step 5: Commit**

```bash
git add src/config/globalConfig.ts tests/config/globalConfig.test.ts
git commit -m "feat: parse hiddenProjects config and add hideProject()"
```

---

## Task 5: Rebuild `SessionTreePanel` for project grouping

**Files:**
- Modify: `src/ui/SessionTreePanel.tsx`
- Modify: `tests/ui/SessionTreePanel.test.tsx`

This is the biggest UI change. The panel currently takes `sessions: SessionNode[]` directly. We change its prop to take the whole tree (or split into `projects` + `coldProjects`).

- [ ] **Step 1: Inspect current `SessionTreePanel` prop interface**

Read the existing `SessionTreePanelProps` to know what to change. Note current sentinels: `__cold__`, `__sub-{parentId}__`.

- [ ] **Step 2: Update `SessionTreePanelProps`**

Change from `sessions: SessionNode[]` to:

```typescript
export interface SessionTreePanelProps {
  projects: ProjectNode[];
  coldProjects: ProjectNode[];
  selectedId: string | null;
  hasFocus: boolean;
  width?: number;
  maxRows?: number;
  expandedIds?: Set<string>;
}
```

Import `ProjectNode`.

- [ ] **Step 3: Extend the `FlatRow` union**

Add a new variant for project header:

```typescript
type FlatRow =
  | { kind: "project"; project: ProjectNode; sentinelId: string }
  | { kind: "session"; session: SessionNode; prefix: string }
  | { kind: "subagent-summary"; parentId: string; coolCount: number; coldCount: number }
  | { kind: "cold-projects-summary"; count: number }; // RENAMED from cold-sessions-summary
```

Sentinel IDs:
- Project header: `__proj-{projectName}__`
- Cold projects group: `__cold__` (kept as-is)

- [ ] **Step 4: Rewrite `flattenSessions` in `SessionTreePanel.tsx`**

Replace the existing `flattenSessions` function:

```typescript
function flattenSessions(
  projects: ProjectNode[],
  coldProjects: ProjectNode[],
  expandedIds: Set<string>,
): FlatRow[] {
  const result: FlatRow[] = [];

  for (const project of projects) {
    const sentinelId = `__proj-${project.name}__`;
    result.push({ kind: "project", project, sentinelId });
    // Default expanded for projects: show sessions unless explicitly collapsed.
    // We treat absence-from-expandedIds as EXPANDED for projects (inverse of sub-agents).
    const collapsed = expandedIds.has(`__collapsed-${sentinelId}`);
    if (!collapsed) {
      for (const session of project.sessions) {
        result.push({ kind: "session", session, prefix: "    " });
        appendSessionRows(result, session, expandedIds);
      }
    }
  }

  if (coldProjects.length > 0) {
    result.push({ kind: "cold-projects-summary", count: coldProjects.length });
    if (expandedIds.has("__cold__")) {
      for (const project of coldProjects) {
        const sentinelId = `__proj-${project.name}__`;
        result.push({ kind: "project", project, sentinelId });
        const collapsed = expandedIds.has(`__collapsed-${sentinelId}`);
        if (!collapsed) {
          for (const session of project.sessions) {
            result.push({ kind: "session", session, prefix: "    " });
            appendSessionRows(result, session, expandedIds);
          }
        }
      }
    }
  }

  return result;
}
```

The existing `appendSessionRows` (which handles sub-agents under a session) stays as-is, but its prefix for sub-agents should also include the project indent (so sub-agents render at depth 3). Update `appendSessionRows` to use `"        "` (8 spaces) prefix for sub-agent rows.

- [ ] **Step 5: Render the project row**

Add a render branch in the JSX where rows are rendered:

```tsx
{displayRows.map((row, idx) =>
  row.kind === "project" ? (
    <ProjectRow
      key={`project-${row.project.name}-${idx}`}
      project={row.project}
      isSelected={selectedId === row.sentinelId}
      hasFocus={hasFocus}
      contentWidth={contentWidth}
    />
  ) : row.kind === "session" ? (
    // existing SessionRow rendering
  ) : ...
)}
```

Add the `ProjectRow` component near the bottom of the file:

```tsx
function ProjectRow({
  project,
  isSelected,
  hasFocus,
  contentWidth,
}: {
  project: ProjectNode;
  isSelected: boolean;
  hasFocus: boolean;
  contentWidth: number;
}): React.ReactElement {
  const text = `> ${project.name}`;
  const padding = Math.max(0, contentWidth - getDisplayWidth(text));
  const highlight = isSelected && hasFocus;
  return (
    <Text>
      {BOX.v}{" "}
      <Text
        backgroundColor={highlight ? "blue" : undefined}
        bold={!highlight}
        dimColor={false}
      >
        {text}
        {" ".repeat(padding)}
      </Text>
      {BOX.v}
    </Text>
  );
}
```

- [ ] **Step 6: Render non-interactive sessions with parens + dim**

In the existing `SessionRow` (or wherever a session row is built), check `session.nonInteractive`. When true, wrap the displayed id in parens and apply `dimColor`:

```tsx
const idDisplay = session.nonInteractive ? `(#${shortId})` : `#${shortId}`;
// ...
<Text dimColor={session.nonInteractive || ...other dim conditions}>
  {/* render */}
</Text>
```

The current `SessionRow` already supports dim styling. Just thread `nonInteractive` through.

- [ ] **Step 7: Update test fixtures**

In `tests/ui/SessionTreePanel.test.tsx`, the `makeSession` factory needs `nonInteractive: false`. Tests that pass `sessions={[...]}` need to wrap into projects: `projects={[{ name: "...", projectPath: "...", sessions: [...], hotness: "hot" }]}, coldProjects={[]}`.

Add a new test:

```typescript
it("renders project header with sessions nested below", () => {
  const session = makeSession({ id: "abc123", projectName: "myproject" });
  const project: ProjectNode = {
    name: "myproject",
    projectPath: "/Users/neo/myproject",
    sessions: [session],
    hotness: "hot",
  };
  const { lastFrame } = render(
    <SessionTreePanel
      projects={[project]}
      coldProjects={[]}
      selectedId={null}
      hasFocus={false}
      width={80}
    />,
  );
  const out = lastFrame() ?? "";
  expect(out).toContain("> myproject");
  expect(out).toContain("#abc123");
});

it("dims and parenthesizes non-interactive sessions", () => {
  const session = makeSession({ id: "ndi", nonInteractive: true });
  const project: ProjectNode = {
    name: "myproject",
    projectPath: "/Users/neo/myproject",
    sessions: [session],
    hotness: "hot",
  };
  const { lastFrame } = render(
    <SessionTreePanel
      projects={[project]}
      coldProjects={[]}
      selectedId={null}
      hasFocus={false}
      width={80}
    />,
  );
  expect(lastFrame() ?? "").toContain("(#ndi");
});

it("collapses cold projects under a summary row", () => {
  const project: ProjectNode = {
    name: "stale",
    projectPath: "/Users/neo/stale",
    sessions: [makeSession({ status: "cold" })],
    hotness: "cold",
  };
  const { lastFrame } = render(
    <SessionTreePanel
      projects={[]}
      coldProjects={[project]}
      selectedId={null}
      hasFocus={false}
      width={80}
    />,
  );
  const out = lastFrame() ?? "";
  expect(out).toContain("1 cold");
  expect(out).not.toContain("stale"); // hidden until expanded
});
```

- [ ] **Step 8: Update remaining test files that mock `SessionTree`**

`tests/ui/App.test.tsx` and `tests/integration/config.test.tsx` mock `discoverSessions`. Update their mocks to return the new shape:

```typescript
discoverSessions: () => ({
  projects: [],
  coldProjects: [],
  totalCount: 0,
  timestamp: new Date().toISOString(),
}),
```

- [ ] **Step 9: Run all UI tests**

```bash
npm test -- tests/ui/SessionTreePanel.test.tsx
```

Expect: pass.

- [ ] **Step 10: Commit**

```bash
git add src/ui/SessionTreePanel.tsx tests/ui/SessionTreePanel.test.tsx tests/ui/App.test.tsx tests/integration/config.test.tsx
git commit -m "feat: render project headers in SessionTreePanel with non-interactive style"
```

---

## Task 6: Wire `App.tsx` for new tree structure

**Files:**
- Modify: `src/ui/App.tsx`

The App's internal `flattenSessions` needs to walk projects → sessions → sub-agents. Key handlers (`onEnter`, `onHide`) need branches for project nodes.

- [ ] **Step 1: Update App's `flattenSessions`**

Replace the existing function in `App.tsx`:

```typescript
function flattenSessions(
  tree: SessionTree,
  expandedIds: Set<string>,
): SessionNode[] {
  // For navigation purposes we still want a flat SessionNode list.
  // Project sentinels and cold summary become special pseudo-nodes.
  const result: SessionNode[] = [];

  const projectToFlat = (project: ProjectNode) => {
    // Synthesize a sentinel SessionNode for the project header.
    result.push({
      id: `__proj-${project.name}__`,
      hideKey: "",
      filePath: "",
      projectPath: project.projectPath,
      projectName: project.name,
      lastModifiedMs: 0,
      status: project.hotness,
      modelName: null,
      subAgents: [],
      nonInteractive: false,
    });

    const collapsedKey = `__collapsed-__proj-${project.name}__`;
    if (!expandedIds.has(collapsedKey)) {
      for (const session of project.sessions) {
        result.push(session);
        appendSubAgentRows(result, session, expandedIds);
      }
    }
  };

  for (const project of tree.projects) {
    projectToFlat(project);
  }

  if (tree.coldProjects.length > 0) {
    result.push({
      id: "__cold__",
      hideKey: "",
      filePath: "",
      projectPath: "",
      projectName: `${tree.coldProjects.length} cold`,
      lastModifiedMs: 0,
      status: "cold",
      modelName: null,
      subAgents: [],
      nonInteractive: false,
    });
    if (expandedIds.has("__cold__")) {
      for (const project of tree.coldProjects) {
        projectToFlat(project);
      }
    }
  }

  return result;
}
```

Note: the existing `subSummarySentinel` and `appendSubAgentRows` helpers stay. Add `nonInteractive: false` to `subSummarySentinel`'s return.

- [ ] **Step 2: Update `onEnter` for project nodes**

In `onEnter`, add a branch BEFORE the existing parent-session check:

```typescript
// Project sentinel: __proj-{projectName}__
if (selectedId.startsWith("__proj-") && selectedId.endsWith("__")) {
  setExpandedIds((prev) => {
    const collapsedKey = `__collapsed-${selectedId}`;
    const next = new Set(prev);
    if (next.has(collapsedKey)) {
      next.delete(collapsedKey);
    } else {
      next.add(collapsedKey);
    }
    return next;
  });
  return;
}
```

- [ ] **Step 3: Update `onHide` for project nodes**

In `onHide`, add a branch BEFORE the existing session/sub-agent checks:

```typescript
// Project sentinel: hide entire project
if (selectedId.startsWith("__proj-") && selectedId.endsWith("__")) {
  const projectName = selectedId.slice(7, -2); // strip __proj- and __
  hideProject(projectName);
  refresh();
  const nextId = allFlat[selectedIndex + 1]?.id ?? allFlat[selectedIndex - 1]?.id ?? null;
  setSelectedId(nextId);
  return;
}
```

Import `hideProject` from `../config/globalConfig.js`.

- [ ] **Step 4: Update activity loading for project selection**

In the `useEffect` that loads activities (currently looks up `selectedId` in `allFlatRef.current` and reads `filePath`), the project sentinel has `filePath: ""`. We need to fall back to the project's hottest session.

Find that useEffect, and update the lookup:

```typescript
useEffect(() => {
  let node = allFlatRef.current.find((s) => s.id === selectedId);

  // If selected is a project sentinel, use its hottest session
  if (node && selectedId?.startsWith("__proj-") && selectedId.endsWith("__")) {
    const projectName = selectedId.slice(7, -2);
    const project =
      sessionTree.projects.find((p) => p.name === projectName) ??
      sessionTree.coldProjects.find((p) => p.name === projectName);
    if (project && project.sessions.length > 0) {
      node = project.sessions[0]; // hottest
    } else {
      node = undefined;
    }
  }

  if (node?.filePath) {
    setActivities(parseSessionHistory(node.filePath));
    setScrollOffset(0);
    setIsLive(true);
    setNewCount(0);
    setViewerCursorLine(0);
  } else {
    setActivities([]);
  }
  setGitActivities([]);
}, [selectedId, sessionTree]);
```

- [ ] **Step 5: Pass new props to SessionTreePanel**

Where the panel is rendered (around line 580-something), change:

```tsx
<SessionTreePanel
  sessions={sessionTree.sessions}
  ...
/>
```

To:

```tsx
<SessionTreePanel
  projects={sessionTree.projects}
  coldProjects={sessionTree.coldProjects}
  ...
/>
```

- [ ] **Step 6: Update `naturalTreeRows` (the dynamic-height code)**

The existing code uses `allFlat.length` as a proxy for natural tree height. That still works since `allFlat` already includes project sentinels as pseudo-nodes. No change needed.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expect: all pass. Fix any test failures in `tests/ui/App.test.tsx` that reference old structure.

- [ ] **Step 8: Smoke test**

```bash
npm run build
node dist/index.js --once
```

Should render with project headers and sessions nested. Press `↵` on a project to collapse/expand. Press `h` on a project to hide it (changes are persisted to `~/.agenthud/config.yaml`).

- [ ] **Step 9: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat: wire App.tsx for project-grouped tree (navigation, hide, activity)"
```

---

## Task 7: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README to reflect new tree shape**

Find the example tree diagram (the box-drawing block early in README showing the split view). Update it to show project grouping:

```markdown
┌─ Sessions ──────────────────────────────────────────────┐
│ > agenthud                                              │
│     #864f [hot] sonnet-4.6                              │
│       » sub-agent: code-reviewer                        │
│     (#398c [warm])                                      │
│   myproject                                             │
│     #def4 [hot] sonnet-4.6                              │
│ ... 12 cold projects                                    │
└─────────────────────────────────────────────────────────┘
```

In the surrounding text, add a brief note:

```markdown
**Session tree (top pane)**
- Sessions grouped under their project (the project name is the row in bold).
- Non-interactive sessions (from `claude -p`, SDK, `agenthud summary`, etc.) appear in parens and dimmed.
- Projects with only cold sessions collapse under `... N cold projects` at the bottom.
```

- [ ] **Step 2: Document `hiddenProjects` in the Configuration section**

In the config YAML example, add:

```yaml
# Hide entire projects from the tree
hiddenProjects:
  - old-project
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document project-grouped tree and hiddenProjects in README"
```
