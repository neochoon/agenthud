# Session Liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show whether each recently-active session is `working` (Claude mid-turn) or `waiting` (turn yielded, user's move) via a badge that replaces `[hot]`, derived from the JSONL tail.

**Architecture:** A pure `detectLiveState(tailLines, mtimeMs, now)` module classifies the tail. `discoverSessions` reads each file's tail once (folding the existing model-name read into `readSessionTail`) and stores the result on `SessionNode.liveState`. `SessionTreePanel` derives the badge via a `getBadge` helper with precedence: liveState → fallback to the time-based `[hot/warm/cool/cold]` badge.

**Tech Stack:** TypeScript (ESM), Ink (React for CLI), Vitest, Biome. Spec: `docs/superpowers/specs/2026-05-22-session-liveness-design.md`. Issue: #82.

**Key constraints discovered:**
- `tsconfig.json` excludes `tests/`, so `tsc --noEmit` (run in CI) only type-checks `src/`. Every `SessionNode` literal in `src/` MUST set `liveState` once the field is added; test factories are not type-checked by tsc but are run by Vitest.
- `THIRTY_MINUTES_MS` is exported from `src/ui/constants.ts`.
- `discoverSessions` already reads each file tail for the model name in `readModelName` — fold liveness into that single read.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/types/index.ts` | `LiveState` type; `SessionNode.liveState` field | Modify |
| `src/data/sessionLiveness.ts` | Pure tail → `LiveState \| null` classifier | Create |
| `src/data/sessions.ts` | Read tail once (`readSessionTail`); populate `liveState`; suppress for non-interactive | Modify |
| `src/ui/App.tsx` | Sentinel `SessionNode` literals need `liveState: null` | Modify |
| `src/ui/SessionTreePanel.tsx` | `getBadge` helper + use it in `SessionRow` | Modify |
| `tests/data/sessionLiveness.test.ts` | Unit tests for `detectLiveState` | Create |
| `tests/data/sessions.test.ts` | Discovery populates `liveState`; non-interactive suppression | Modify |
| `tests/ui/SessionTreePanel.test.tsx` | `getBadge` precedence/colors + badge render | Modify |

---

## Task 1: `detectLiveState` pure module

**Files:**
- Modify: `src/types/index.ts` (add `LiveState` type only — not the `SessionNode` field yet)
- Create: `src/data/sessionLiveness.ts`
- Test: `tests/data/sessionLiveness.test.ts`

Adding only the `LiveState` type here keeps every existing `SessionNode` literal valid (the field is added in Task 2), so the build stays green.

- [ ] **Step 1: Write the failing test**

Create `tests/data/sessionLiveness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectLiveState } from "../../src/data/sessionLiveness.js";

const NOW = 1_700_000_000_000;
const RECENT = NOW - 10_000;
const STALE = NOW - 31 * 60 * 1000;

const j = (obj: unknown): string => JSON.stringify(obj);

describe("detectLiveState", () => {
  it("returns 'waiting' when the last assistant entry ends with text", () => {
    const lines = [
      j({ type: "user", message: { role: "user", content: "Fix the bug" } }),
      j({
        type: "assistant",
        message: { content: [{ type: "text", text: "All done — fixed it." }] },
      }),
    ];
    expect(detectLiveState(lines, RECENT, NOW)).toBe("waiting");
  });

  it("returns 'working' for a pending non-question tool_use", () => {
    const lines = [
      j({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }],
        },
      }),
    ];
    expect(detectLiveState(lines, RECENT, NOW)).toBe("working");
  });

  it("returns 'working' when assistant emits text then a pending tool_use", () => {
    const lines = [
      j({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Let me check." },
            { type: "tool_use", name: "Read", input: { file_path: "/a.ts" } },
          ],
        },
      }),
    ];
    expect(detectLiveState(lines, RECENT, NOW)).toBe("working");
  });

  it("returns 'waiting' when the pending tool_use is AskUserQuestion", () => {
    const lines = [
      j({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "AskUserQuestion", input: { questions: [] } }],
        },
      }),
    ];
    expect(detectLiveState(lines, RECENT, NOW)).toBe("waiting");
  });

  it("returns 'working' when the last entry is a user prompt", () => {
    const lines = [
      j({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } }),
      j({ type: "user", message: { role: "user", content: "Now add tests" } }),
    ];
    expect(detectLiveState(lines, RECENT, NOW)).toBe("working");
  });

  it("returns 'working' when the last entry is a user tool_result", () => {
    const lines = [
      j({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] },
      }),
      j({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "file.ts" }],
        },
      }),
    ];
    expect(detectLiveState(lines, RECENT, NOW)).toBe("working");
  });

  it("skips trailing system and unparseable lines to find the last meaningful entry", () => {
    const lines = [
      j({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] },
      }),
      j({ type: "system", subtype: "info" }),
      "not valid json{",
    ];
    expect(detectLiveState(lines, RECENT, NOW)).toBe("working");
  });

  it("returns null for empty input", () => {
    expect(detectLiveState([], RECENT, NOW)).toBeNull();
  });

  it("returns null when all lines are unparseable", () => {
    expect(detectLiveState(["garbage", "{nope"], RECENT, NOW)).toBeNull();
  });

  it("returns null when mtime is older than 30 minutes, even with a live tail", () => {
    const lines = [
      j({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] },
      }),
    ];
    expect(detectLiveState(lines, STALE, NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/data/sessionLiveness.test.ts`
Expected: FAIL — cannot resolve `../../src/data/sessionLiveness.js` (module does not exist).

- [ ] **Step 3: Add the `LiveState` type**

In `src/types/index.ts`, directly below the `SessionStatus` line (line 2):

```ts
// Session status
export type SessionStatus = "hot" | "warm" | "cool" | "cold";

// Live state derived from the JSONL tail (orthogonal to time-based status)
export type LiveState = "working" | "waiting";
```

- [ ] **Step 4: Implement `detectLiveState`**

Create `src/data/sessionLiveness.ts`:

```ts
import type { LiveState } from "../types/index.js";
import { THIRTY_MINUTES_MS } from "../ui/constants.js";

interface ContentBlock {
  type?: string;
  name?: string;
}

interface ParsedEntry {
  type?: string;
  message?: { content?: unknown };
}

/**
 * Classify a session as `working` or `waiting` from the structure of its
 * JSONL tail. The tail structure is the primary signal — a long-running tool
 * leaves mtime stale while the pending tool_use still reads as `working`.
 * Returns null when the session is older than the recency window or the tail
 * yields no meaningful entry.
 */
export function detectLiveState(
  tailLines: string[],
  mtimeMs: number,
  now: number,
): LiveState | null {
  if (now - mtimeMs > THIRTY_MINUTES_MS) return null;

  for (let i = tailLines.length - 1; i >= 0; i--) {
    const line = tailLines[i];
    if (!line || !line.trim()) continue;

    let entry: ParsedEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "assistant") {
      const content = entry.message?.content;
      const blocks: ContentBlock[] = Array.isArray(content) ? content : [];
      const toolUses = blocks.filter((b) => b && b.type === "tool_use");
      if (toolUses.length === 0) return "waiting"; // turn yielded (text only)
      if (toolUses.some((b) => b.name === "AskUserQuestion")) return "waiting";
      return "working"; // pending tool_use
    }

    if (entry.type === "user") {
      return "working"; // prompt or tool_result → Claude is processing
    }
    // system / other → keep scanning backwards
  }

  return null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/data/sessionLiveness.test.ts`
Expected: PASS — 10 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/data/sessionLiveness.ts tests/data/sessionLiveness.test.ts
git commit -m "feat: add detectLiveState for working/waiting classification (#82)"
```

---

## Task 2: Populate `liveState` during discovery

**Files:**
- Modify: `src/types/index.ts` (add `liveState` field to `SessionNode`)
- Modify: `src/data/sessions.ts` (replace `readModelName` with `readSessionTail`; populate `liveState`)
- Modify: `src/ui/App.tsx` (add `liveState: null` to 3 sentinel literals)
- Test: `tests/data/sessions.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these two tests inside the existing `describe("discoverSessions", ...)` block in `tests/data/sessions.test.ts` (before its closing `});`). They reuse the file's existing `existsSync/readdirSync/statSync/readFileSync` mocks, `NOW`, and `mockConfig`:

```ts
  it("populates liveState 'working' when the tail ends in a pending tool_use", () => {
    const projectsDir = join(process.env.HOME ?? "/home/user", ".claude", "projects");
    const projectDir = join(projectsDir, "-Users-neo-myproject");
    const sessionFile = join(projectDir, "work123.jsonl");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir || path === projectDir || path === sessionFile) return true;
      return false;
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-myproject"] as unknown as ReturnType<typeof readdirSync>;
      if (path === projectDir)
        return ["work123.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      return {
        isDirectory: () => path === projectDir,
        mtimeMs: NOW - 10_000,
        size: 1000,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockReturnValue(
      `${JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-sonnet-4-20250514",
          content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }],
        },
        timestamp: new Date(NOW - 10_000).toISOString(),
      })}\n`,
    );
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    expect(tree.projects[0].sessions[0].liveState).toBe("working");
  });

  it("suppresses liveState (null) for non-interactive sessions", () => {
    const projectsDir = join(process.env.HOME ?? "/home/user", ".claude", "projects");
    const projectDir = join(projectsDir, "-Users-neo-myproject");
    const sessionFile = join(projectDir, "sdk123.jsonl");

    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir || path === projectDir || path === sessionFile) return true;
      return false;
    });
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === projectsDir)
        return ["-Users-neo-myproject"] as unknown as ReturnType<typeof readdirSync>;
      if (path === projectDir)
        return ["sdk123.jsonl"] as unknown as ReturnType<typeof readdirSync>;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      return {
        isDirectory: () => path === projectDir,
        mtimeMs: NOW - 10_000,
        size: 1000,
      } as ReturnType<typeof statSync>;
    });
    // First line carries entrypoint "sdk-cli" → non-interactive; tail looks "working".
    vi.mocked(readFileSync).mockReturnValue(
      `${JSON.stringify({
        type: "assistant",
        entrypoint: "sdk-cli",
        message: {
          model: "claude-sonnet-4-20250514",
          content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }],
        },
        timestamp: new Date(NOW - 10_000).toISOString(),
      })}\n`,
    );
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = discoverSessions(mockConfig);
    const all = [...tree.projects, ...tree.coldProjects].flatMap((p) => p.sessions);
    expect(all[0].nonInteractive).toBe(true);
    expect(all[0].liveState).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/data/sessions.test.ts`
Expected: FAIL — `liveState` is `undefined` (not `"working"` / not `null`), because `discoverSessions` does not set it yet.

- [ ] **Step 3: Add the `liveState` field to `SessionNode`**

In `src/types/index.ts`, add the field to the `SessionNode` interface, right after `firstUserPrompt`:

```ts
  nonInteractive: boolean; // true when entrypoint === "sdk-cli"
  firstUserPrompt: string | null; // First natural-language user message (system messages skipped)
  liveState: LiveState | null; // working/waiting from JSONL tail; null = fall back to time-based status
}
```

- [ ] **Step 4: Add `liveState: null` to the 3 sentinel literals in `src/ui/App.tsx`**

These are synthetic placeholder nodes (no live state). In each of the three `SessionNode` literals, add `liveState: null,` immediately after `firstUserPrompt: null,`:

1. `subSummarySentinel` (around line 48)
2. the project-header sentinel inside `projectToFlat` (around line 104)
3. the cold-projects sentinel (around line 135)

Each block changes from:

```ts
    nonInteractive: false,
    firstUserPrompt: null,
  };
```
to:
```ts
    nonInteractive: false,
    firstUserPrompt: null,
    liveState: null,
  };
```

(The cold-projects literal at line 135 ends with `});` rather than `};` — add the `liveState: null,` line above the existing `firstUserPrompt: null,`'s closing in the same way.)

- [ ] **Step 5: Replace `readModelName` with `readSessionTail` in `src/data/sessions.ts`**

5a. Extend the type import (around lines 4–10) to include `LiveState`:

```ts
import type {
  GlobalConfig,
  LiveState,
  ProjectNode,
  SessionNode,
  SessionStatus,
  SessionTree,
} from "../types/index.js";
```

5b. Add an import for the classifier, next to the existing `activityParser` import (line 12):

```ts
import { parseModelName } from "./activityParser.js";
import { detectLiveState } from "./sessionLiveness.js";
```

5c. Replace the entire `readModelName` function (lines 93–112) with `readSessionTail`:

```ts
function readSessionTail(
  filePath: string,
  mtimeMs: number,
  now: number,
): { modelName: string | null; liveState: LiveState | null } {
  if (!existsSync(filePath)) return { modelName: null, liveState: null };
  try {
    const content = readFileSync(filePath, "utf-8");
    const tail = content.trim().split("\n").filter(Boolean).slice(-50);

    let modelName: string | null = null;
    for (const line of [...tail].reverse()) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "assistant" && entry.message?.model) {
          modelName = parseModelName(entry.message.model as string);
          break;
        }
      } catch {
        // skip
      }
    }

    return { modelName, liveState: detectLiveState(tail, mtimeMs, now) };
  } catch {
    return { modelName: null, liveState: null };
  }
}
```

5d. Update the sub-agent construction in `buildSubAgents` (the `try` block around lines 215–232). Replace:

```ts
        const stat = statSync(filePath);
        const { agentId, taskDescription } = readSubAgentInfo(filePath);
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
          nonInteractive: false,
          firstUserPrompt: null,
        };
```
with:
```ts
        const stat = statSync(filePath);
        const { agentId, taskDescription } = readSubAgentInfo(filePath);
        const { modelName, liveState } = readSessionTail(
          filePath,
          stat.mtimeMs,
          Date.now(),
        );
        return {
          id,
          hideKey,
          filePath,
          projectPath: "",
          projectName: "",
          lastModifiedMs: stat.mtimeMs,
          status: getSessionStatus(stat.mtimeMs),
          modelName,
          subAgents: [],
          agentId: agentId ?? undefined,
          taskDescription: taskDescription ?? undefined,
          nonInteractive: false,
          firstUserPrompt: null,
          liveState,
        };
```

5e. Update the top-level construction in `discoverSessions` (the `try` block around lines 294–310). Replace:

```ts
        const stat = statSync(filePath);
        const subAgents = buildSubAgents(id, projectDir, config, projectName);
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
          nonInteractive: readEntrypoint(filePath) === "sdk-cli",
          firstUserPrompt: readFirstUserPrompt(filePath),
        });
```
with:
```ts
        const stat = statSync(filePath);
        const subAgents = buildSubAgents(id, projectDir, config, projectName);
        const nonInteractive = readEntrypoint(filePath) === "sdk-cli";
        const { modelName, liveState } = readSessionTail(
          filePath,
          stat.mtimeMs,
          Date.now(),
        );
        allSessions.push({
          id,
          hideKey,
          filePath,
          projectPath: decodedPath,
          projectName,
          lastModifiedMs: stat.mtimeMs,
          status: getSessionStatus(stat.mtimeMs),
          modelName,
          subAgents,
          nonInteractive,
          firstUserPrompt: readFirstUserPrompt(filePath),
          liveState: nonInteractive ? null : liveState,
        });
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `npx vitest run tests/data/sessions.test.ts`
Expected: PASS — all existing tests plus the 2 new ones pass.

- [ ] **Step 7: Run the full suite + type-check to confirm no regressions**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All tests pass; `tsc` reports no errors (every `src/` `SessionNode` literal now has `liveState`).

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts src/data/sessions.ts src/ui/App.tsx tests/data/sessions.test.ts
git commit -m "feat: detect and store session liveState during discovery (#82)"
```

---

## Task 3: Render `[working]` / `[waiting]` badges

**Files:**
- Modify: `src/ui/SessionTreePanel.tsx` (add exported `getBadge`; use it in `SessionRow`)
- Test: `tests/ui/SessionTreePanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `tests/ui/SessionTreePanel.test.tsx`:

1a. Add `getBadge` to the import on line 4:

```ts
import { getBadge, SessionTreePanel } from "../../src/ui/SessionTreePanel.js";
```

1b. Add `liveState: null` to the `makeSession` factory defaults (after `firstUserPrompt: null,`, around line 17):

```ts
  nonInteractive: false,
  firstUserPrompt: null,
  liveState: null,
  ...overrides,
});
```

1c. Add these tests inside the top-level `describe("SessionTreePanel", ...)` block:

```ts
  describe("getBadge", () => {
    it("returns green [working] for a working session", () => {
      expect(getBadge(makeSession({ liveState: "working" }))).toEqual({
        text: "[working]",
        color: "green",
      });
    });

    it("returns magenta [waiting] for a waiting session", () => {
      expect(getBadge(makeSession({ liveState: "waiting" }))).toEqual({
        text: "[waiting]",
        color: "magenta",
      });
    });

    it("falls back to the time-based badge when liveState is null", () => {
      expect(getBadge(makeSession({ liveState: null, status: "hot" }))).toEqual({
        text: "[hot]",
        color: "green",
      });
      expect(getBadge(makeSession({ liveState: null, status: "cold" }))).toEqual({
        text: "[cold]",
        color: "gray",
      });
    });
  });

  it("renders [working] badge for a working session", () => {
    const session = makeSession({ liveState: "working" });
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("[working]");
  });

  it("renders [waiting] badge for a waiting session", () => {
    const session = makeSession({ liveState: "waiting" });
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("[waiting]");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/SessionTreePanel.test.tsx`
Expected: FAIL — `getBadge` is not exported (import resolves to `undefined`), and the render tests do not find `[working]`/`[waiting]`.

- [ ] **Step 3: Add the `getBadge` helper**

In `src/ui/SessionTreePanel.tsx`, directly below the existing `getStatusColor` function (it ends at line 73), add:

```ts
export function getBadge(session: SessionNode): { text: string; color: string } {
  if (session.liveState === "working")
    return { text: "[working]", color: "green" };
  if (session.liveState === "waiting")
    return { text: "[waiting]", color: "magenta" };
  return { text: `[${session.status}]`, color: getStatusColor(session.status) };
}
```

`SessionNode` is already imported in this file. Keep `getStatusColor` — `getBadge` uses it for the fallback.

- [ ] **Step 4: Use `getBadge` in `SessionRow`**

In `src/ui/SessionTreePanel.tsx`, replace these two lines in `SessionRow` (lines 105–106):

```ts
  const statusColor = getStatusColor(session.status);
  const badge = `[${session.status}]`;
```
with:
```ts
  const { text: badge, color: badgeColor } = getBadge(session);
```

Then update the badge render (line 179) from:

```ts
        <Text color={statusColor}>{badge}</Text>
```
to:
```ts
        <Text color={badgeColor}>{badge}</Text>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/ui/SessionTreePanel.test.tsx`
Expected: PASS — new `getBadge` and badge-render tests pass; existing badge tests still pass (default `liveState: null` falls back to time-based badge).

- [ ] **Step 6: Run the full suite + type-check + lint**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all tests pass, no type errors, Biome reports no issues.

- [ ] **Step 7: Commit**

```bash
git add src/ui/SessionTreePanel.tsx tests/ui/SessionTreePanel.test.tsx
git commit -m "feat: render [working]/[waiting] session badges (#82)"
```

---

## Self-Review

**1. Spec coverage:**
- State model (working/waiting/null) → Task 1 (`detectLiveState`).
- Detection heuristic table (assistant text → waiting; AskUserQuestion → waiting; other pending tool → working; user → working; none → null) → Task 1 tests + impl.
- 30-min recency gate → Task 1 (`THIRTY_MINUTES_MS` guard) + test.
- `readSessionTail` folds model-name + liveness into one read → Task 2 Step 5c.
- `liveState` field on `SessionNode` (+ sub-agents) → Task 2.
- Non-interactive suppression → Task 2 Step 5e + test.
- Badge precedence, `[working]` green / `[waiting]` magenta, fallback → Task 3 (`getBadge`) + tests.
- Sorting unchanged → no sort code touched (confirmed).
- Out-of-scope items (notifications, sort-to-top, tracking, animation, 5-state) → not in any task, as intended.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step contains complete code and exact commands. ✅

**3. Type consistency:** `LiveState = "working" | "waiting"` (Task 1) used identically in `detectLiveState` return, `SessionNode.liveState` (Task 2), `readSessionTail` return (Task 2), and `getBadge` checks (Task 3). `readSessionTail(filePath, mtimeMs, now)` signature matches all call sites. `getBadge(session)` returns `{ text, color }`, consumed as `{ text: badge, color: badgeColor }`. ✅

---

## Execution Handoff

(Filled in by the writing-plans skill after save.)
