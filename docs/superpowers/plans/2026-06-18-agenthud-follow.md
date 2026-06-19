# agenthud follow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `agenthud follow` subcommand that streams a chronologically-merged feed of activity + state + lifecycle events across every session/sub-agent — human lines by default, NDJSON with `--json`.

**Architecture:** A pure diff engine (`followStream`) compares successive discovery snapshots against a per-node cursor and emits ordered `FollowEvent[]`. A thin runner (`followRunner`) drives discovery on the existing refresh interval, seeds backfill from `--since`, formats (`followFormat`), and writes to stdout. CLI wiring mirrors `report`/`summary`.

**Tech Stack:** Node ESM + TypeScript, Vitest, Biome. Reuses `discoverSessions`, `parseSessionHistory`, `ActivityEntry`, `SessionNode.liveState`, `ICONS`.

**Spec:** `docs/superpowers/specs/2026-06-18-agenthud-follow-design.md`. **Branch:** `feat/183-follow`. Scope = spec Phase 1 + `--include` + `--since now|Nh|Nm`. Deferred (note at end): `--since HH:MM|ISO|last`, `--cwd`, richer lifecycle.

**Before each commit:** `npx tsc --noEmit` and `npx biome check --write <changed files>` then `npx biome check .` (whole-repo lint is what CI runs).

---

## File structure

- Create `src/data/followTypes.ts` — `FollowEvent`, `NodeSnapshot`, `FollowState`, `NodeCursor`.
- Create `src/data/followStream.ts` — `diffSnapshots()` pure engine + `nodeKey()`.
- Create `src/data/followFormat.ts` — `formatHuman()`, `formatJson()`.
- Create `src/data/followSince.ts` — `parseSince()` → `{ sinceMs }`.
- Create `src/data/followRunner.ts` — `runFollow()` loop (discovery → snapshot → diff → format → write).
- Modify `src/cli.ts` — `follow` mode, flags, help.
- Modify `src/main.ts` — dispatch `follow` before importing Ink.
- Tests: `tests/data/followStream.test.ts`, `tests/data/followFormat.test.ts`, `tests/data/followSince.test.ts`, `tests/data/followRunner.test.ts`.

---

## Task 1: Event + snapshot types

**Files:** Create `src/data/followTypes.ts`

- [ ] **Step 1: Create the types file**

```ts
import type { ActivityEntry, LiveState } from "../types/index.js";

/** One emitted event. Stable NDJSON contract — additive-only. */
export interface FollowEvent {
  ts: number; // epoch ms
  type: "activity" | "state" | "lifecycle";
  provider: string;
  project: string;
  projectPath: string;
  session: string; // owning top-level session id
  subagent: string | null; // sub-agent's own id when this is its event
  label?: string; // activity
  detail?: string; // activity
  from?: LiveState | null; // state
  to?: LiveState | null; // state
  kind?: "session_start" | "session_end" | "subagent_spawn" | "subagent_done"; // lifecycle
}

/** Flattened per-node view the engine diffs (one per session AND per sub-agent). */
export interface NodeSnapshot {
  session: string;
  subagent: string | null;
  provider: string;
  project: string;
  projectPath: string;
  liveState: LiveState | null;
  activities: ActivityEntry[]; // full chronological list
}

export interface NodeCursor {
  emittedCount: number; // activities already emitted for this node
  lastLiveState: LiveState | null;
  meta: Omit<NodeSnapshot, "liveState" | "activities">; // to build a session_end/subagent_done event after the node disappears
}

export type FollowState = Map<string, NodeCursor>; // key = nodeKey(snapshot)
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no usages yet).

- [ ] **Step 3: Commit**

```bash
git add src/data/followTypes.ts
git commit -m "feat(follow): event + snapshot types"
```

---

## Task 2: `diffSnapshots` engine (the heart)

**Files:** Create `src/data/followStream.ts`; Test `tests/data/followStream.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "../../src/types/index.js";
import { diffSnapshots } from "../../src/data/followStream.js";
import type { NodeSnapshot } from "../../src/data/followTypes.js";

const act = (label: string, ts: number, type: ActivityEntry["type"] = "tool"): ActivityEntry => ({
  timestamp: new Date(ts),
  type,
  icon: "x",
  label,
  detail: `${label}-detail`,
});

const node = (o: Partial<NodeSnapshot> = {}): NodeSnapshot => ({
  session: "s1",
  subagent: null,
  provider: "claude",
  project: "proj",
  projectPath: "/p/proj",
  liveState: null,
  activities: [],
  ...o,
});

const NOW = 1_000_000;

describe("diffSnapshots", () => {
  it("emits session_start + activities for a never-seen node", () => {
    const snap = node({ activities: [act("Read", 10), act("Edit", 20)] });
    const { events } = diffSnapshots(new Map(), [snap], null, NOW);
    expect(events.map((e) => [e.type, e.kind ?? e.label])).toEqual([
      ["lifecycle", "session_start"],
      ["activity", "Read"],
      ["activity", "Edit"],
    ]);
    expect(events[0].ts).toBe(NOW); // lifecycle stamped at detection time
    expect(events[1].ts).toBe(10); // activity keeps its own ts
  });

  it("emits only NEW activities past the cursor on the next tick", () => {
    const first = node({ activities: [act("Read", 10)] });
    const r1 = diffSnapshots(new Map(), [first], null, NOW);
    const second = node({ activities: [act("Read", 10), act("Bash", 30)] });
    const { events } = diffSnapshots(r1.nextState, [second], null, NOW + 1);
    expect(events.map((e) => e.label)).toEqual(["Bash"]);
  });

  it("emits a state event when liveState changes", () => {
    const a = node({ liveState: "working", activities: [act("Edit", 10)] });
    const r1 = diffSnapshots(new Map(), [a], null, NOW);
    const b = node({ liveState: "waiting", activities: [act("Edit", 10)] });
    const { events } = diffSnapshots(r1.nextState, [b], null, NOW + 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "state", from: "working", to: "waiting", ts: NOW + 1 });
  });

  it("emits session_end when a node disappears", () => {
    const a = node({ activities: [act("Edit", 10)] });
    const r1 = diffSnapshots(new Map(), [a], null, NOW);
    const { events } = diffSnapshots(r1.nextState, [], null, NOW + 1);
    expect(events).toEqual([
      expect.objectContaining({ type: "lifecycle", kind: "session_end", session: "s1", ts: NOW + 1 }),
    ]);
  });

  it("uses subagent_spawn / subagent_done for sub-agent nodes", () => {
    const sub = node({ subagent: "rev", activities: [act("Read", 10)] });
    const r1 = diffSnapshots(new Map(), [sub], null, NOW);
    expect(r1.events[0]).toMatchObject({ type: "lifecycle", kind: "subagent_spawn", subagent: "rev" });
    const { events } = diffSnapshots(r1.nextState, [], null, NOW + 1);
    expect(events[0]).toMatchObject({ kind: "subagent_done", subagent: "rev" });
  });

  it("honors the include filter on activities only (state/lifecycle always pass)", () => {
    const a = node({ liveState: "working", activities: [act("Edit", 10), act("response", 20, "response")] });
    const include = new Set(["response"]);
    const r = diffSnapshots(new Map(), [a], include, NOW);
    // session_start (always) + only the response activity
    expect(r.events.map((e) => e.kind ?? e.label)).toEqual(["session_start", "response"]);
  });

  it("emits no events when nothing changed", () => {
    const a = node({ activities: [act("Read", 10)] });
    const r1 = diffSnapshots(new Map(), [a], null, NOW);
    const { events } = diffSnapshots(r1.nextState, [a], null, NOW + 1);
    expect(events).toEqual([]);
  });

  it("orders a tick's events by ts", () => {
    const a = node({ session: "s2", activities: [act("Bash", 50)] });
    const b = node({ activities: [act("Read", 5)] });
    const { events } = diffSnapshots(new Map(), [a, b], null, NOW);
    const tss = events.filter((e) => e.type === "activity").map((e) => e.ts);
    expect(tss).toEqual([...tss].sort((x, y) => x - y));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/data/followStream.test.ts`
Expected: FAIL ("diffSnapshots is not a function" / module not found).

- [ ] **Step 3: Implement the engine**

```ts
import type { ActivityEntry } from "../types/index.js";
import type { FollowEvent, FollowState, NodeSnapshot } from "./followTypes.js";

export function nodeKey(s: Pick<NodeSnapshot, "session" | "subagent">): string {
  return `${s.session} ${s.subagent ?? ""}`;
}

function activityEvent(s: NodeSnapshot, a: ActivityEntry): FollowEvent {
  return {
    ts: a.timestamp.getTime(),
    type: "activity",
    provider: s.provider,
    project: s.project,
    projectPath: s.projectPath,
    session: s.session,
    subagent: s.subagent,
    label: a.label,
    detail: a.detail,
  };
}

function passesInclude(a: ActivityEntry, include: Set<string> | null): boolean {
  if (!include) return true;
  const label = a.label.toLowerCase();
  const t = a.type;
  if (include.has("response") && t === "response") return true;
  if (include.has("thinking") && t === "thinking") return true;
  if (include.has("user") && t === "user") return true;
  if (include.has("bash") && label === "bash") return true;
  if (include.has("edit") && (label === "edit" || label === "write" || label === "todowrite")) return true;
  if (include.has("read") && label === "read") return true;
  if (include.has("glob") && (label === "glob" || label === "grep")) return true;
  if (include.has("task") && label === "task") return true;
  return false;
}

/**
 * Compare the current snapshots against `prev` cursor state; return the new
 * events (ordered by ts) and the next cursor state. Pure — no I/O. `now` is
 * the detection time stamped on state/lifecycle events.
 */
export function diffSnapshots(
  prev: FollowState,
  snapshots: NodeSnapshot[],
  include: Set<string> | null,
  now: number,
): { events: FollowEvent[]; nextState: FollowState } {
  const events: FollowEvent[] = [];
  const next: FollowState = new Map();
  const seen = new Set<string>();

  for (const s of snapshots) {
    const key = nodeKey(s);
    seen.add(key);
    const cursor = prev.get(key);
    const meta = {
      session: s.session,
      subagent: s.subagent,
      provider: s.provider,
      project: s.project,
      projectPath: s.projectPath,
    };
    if (!cursor) {
      events.push({
        ts: now,
        type: "lifecycle",
        kind: s.subagent ? "subagent_spawn" : "session_start",
        ...meta,
      });
      for (const a of s.activities) {
        if (passesInclude(a, include)) events.push(activityEvent(s, a));
      }
    } else {
      for (const a of s.activities.slice(cursor.emittedCount)) {
        if (passesInclude(a, include)) events.push(activityEvent(s, a));
      }
      if (s.liveState !== cursor.lastLiveState) {
        events.push({ ts: now, type: "state", from: cursor.lastLiveState, to: s.liveState, ...meta });
      }
    }
    next.set(key, { emittedCount: s.activities.length, lastLiveState: s.liveState, meta });
  }

  for (const [key, cursor] of prev) {
    if (seen.has(key)) continue;
    events.push({
      ts: now,
      type: "lifecycle",
      kind: cursor.meta.subagent ? "subagent_done" : "session_end",
      ...cursor.meta,
    });
  }

  events.sort((a, b) => a.ts - b.ts);
  return { events, nextState: next };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/data/followStream.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/followStream.ts tests/data/followStream.test.ts
git commit -m "feat(follow): pure diff engine (diffSnapshots)"
```

---

## Task 3: `followFormat` (human + NDJSON)

**Files:** Create `src/data/followFormat.ts`; Test `tests/data/followFormat.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import type { FollowEvent } from "../../src/data/followTypes.js";
import { formatHuman, formatJson } from "../../src/data/followFormat.js";

const base = { ts: 1718000000000, provider: "claude", project: "agenthud", projectPath: "/p", session: "cbe5773f00", subagent: null };

describe("formatJson", () => {
  it("is a single JSON line that round-trips", () => {
    const e: FollowEvent = { ...base, type: "activity", label: "Edit", detail: "src/x.ts" };
    const line = formatJson(e);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toMatchObject({ type: "activity", session: "cbe5773f00", label: "Edit" });
  });
});

describe("formatHuman", () => {
  it("labels with project/session and the activity", () => {
    const e: FollowEvent = { ...base, type: "activity", label: "Edit", detail: "src/x.ts" };
    const line = formatHuman(e);
    expect(line).toContain("agenthud/cbe5773f"); // project/short-session
    expect(line).toContain("Edit");
    expect(line).toContain("src/x.ts");
  });

  it("includes the sub-agent segment when present", () => {
    const e: FollowEvent = { ...base, subagent: "code-reviewer", type: "activity", label: "Read", detail: "f.ts" };
    expect(formatHuman(e)).toContain("agenthud/cbe5773f/code-reviewer");
  });

  it("renders a state transition", () => {
    const e: FollowEvent = { ...base, type: "state", from: "working", to: "waiting" };
    const line = formatHuman(e);
    expect(line).toContain("waiting");
  });

  it("renders a lifecycle kind", () => {
    const e: FollowEvent = { ...base, type: "lifecycle", kind: "session_end" };
    expect(formatHuman(e)).toContain("session_end");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/data/followFormat.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import type { FollowEvent } from "./followTypes.js";

export function formatJson(e: FollowEvent): string {
  return JSON.stringify(e);
}

function clock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function formatHuman(e: FollowEvent): string {
  const who = [e.project, e.session.slice(0, 8), e.subagent ?? undefined]
    .filter(Boolean)
    .join("/");
  let what: string;
  if (e.type === "activity") {
    what = `${e.label}  ${e.detail ?? ""}`.trimEnd();
  } else if (e.type === "state") {
    what = `${e.to ?? "idle"}  (was ${e.from ?? "idle"})`;
  } else {
    what = e.kind ?? "lifecycle";
  }
  return `[${clock(e.ts)}] ${who}  ${what}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/data/followFormat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/followFormat.ts tests/data/followFormat.test.ts
git commit -m "feat(follow): human + NDJSON formatters"
```

> NOTE: colored output is a later enhancement; keep formatHuman plain so it stays trivially testable and pipe-safe.

---

## Task 4: `parseSince`

**Files:** Create `src/data/followSince.ts`; Test `tests/data/followSince.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { parseSince } from "../../src/data/followSince.js";

const NOW = 1_000_000_000_000;

describe("parseSince", () => {
  it("now → sinceMs === now (no backfill)", () => {
    expect(parseSince("now", NOW)).toEqual({ sinceMs: NOW });
  });
  it("Nh / Nm → relative backfill", () => {
    expect(parseSince("2h", NOW)).toEqual({ sinceMs: NOW - 2 * 3600_000 });
    expect(parseSince("30m", NOW)).toEqual({ sinceMs: NOW - 30 * 60_000 });
  });
  it("undefined defaults to now", () => {
    expect(parseSince(undefined, NOW)).toEqual({ sinceMs: NOW });
  });
  it("invalid → error", () => {
    expect(parseSince("banana", NOW)).toHaveProperty("error");
    expect(parseSince("2x", NOW)).toHaveProperty("error");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/data/followSince.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
export type SinceResult = { sinceMs: number } | { error: string };

/** Phase 1: `now` (default) and relative `<N>h` / `<N>m`.
 * (HH:MM / ISO / `last` are deferred — see the plan's Deferred section.) */
export function parseSince(spec: string | undefined, now: number): SinceResult {
  if (!spec || spec === "now") return { sinceMs: now };
  const m = spec.match(/^(\d+)([hm])$/);
  if (!m) return { error: `Invalid --since: ${spec} (use now, <N>h, or <N>m)` };
  const n = Number.parseInt(m[1], 10);
  const unitMs = m[2] === "h" ? 3600_000 : 60_000;
  return { sinceMs: now - n * unitMs };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/data/followSince.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/followSince.ts tests/data/followSince.test.ts
git commit -m "feat(follow): parseSince (now / Nh / Nm)"
```

---

## Task 5: `followRunner` (snapshot builder + loop)

**Files:** Create `src/data/followRunner.ts`; Test `tests/data/followRunner.test.ts`

The runner has two parts: a pure `buildSnapshots(tree)` (testable) and the timer loop `runFollow()` (thin, integration-tested via one cycle).

- [ ] **Step 1: Write the failing test for `buildSnapshots`**

```ts
import { describe, expect, it } from "vitest";
import type { SessionNode, SessionTree } from "../../src/types/index.js";
import { buildSnapshots } from "../../src/data/followRunner.js";

const sess = (o: Partial<SessionNode> = {}): SessionNode => ({
  id: "s1", hideKey: "p/s1", filePath: "/p/s1.jsonl", projectPath: "/p/proj",
  projectName: "proj", lastModifiedMs: 0, status: "hot", modelName: null,
  subAgents: [], nonInteractive: false, firstUserPrompt: null, liveState: null,
  provider: "claude", ...o,
});

it("flattens top-level sessions and sub-agents, parsing each filePath", () => {
  const tree: SessionTree = {
    projects: [{
      name: "proj", projectPath: "/p/proj", hotness: "hot",
      sessions: [sess({ id: "top", subAgents: [sess({ id: "sub", filePath: "/p/sub.jsonl" })] })],
    }],
    coldProjects: [], totalCount: 1, timestamp: "", hiddenStats: { total: 0, active: 0 },
  };
  // inject a fake parser so no filesystem is touched
  const parse = (fp: string) => (fp === "/p/sub.jsonl" ? [] : []);
  const snaps = buildSnapshots(tree, parse);
  expect(snaps.map((s) => [s.session, s.subagent])).toEqual([
    ["top", null],
    ["top", "sub"],
  ]);
  expect(snaps[0].project).toBe("proj");
  expect(snaps[1].subagent).toBe("sub");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/data/followRunner.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `buildSnapshots` (and stub the loop)**

```ts
import { discoverSessions } from "./sessions.js";
import { parseSessionHistory } from "./sessionHistory.js";
import type { GlobalConfig, SessionNode, SessionTree } from "../types/index.js";
import type { FollowEvent, FollowState, NodeSnapshot } from "./followTypes.js";
import { diffSnapshots } from "./followStream.js";
import { formatHuman, formatJson } from "./followFormat.js";

type ParseFn = (filePath: string) => SessionNode["subAgents"] extends never ? never : import("../types/index.js").ActivityEntry[];

export function buildSnapshots(
  tree: SessionTree,
  parse: (filePath: string) => import("../types/index.js").ActivityEntry[] = parseSessionHistory,
): NodeSnapshot[] {
  const out: NodeSnapshot[] = [];
  const all = [...tree.projects, ...tree.coldProjects];
  for (const project of all) {
    for (const top of project.sessions) {
      out.push(nodeOf(top, top, null, project.name, parse));
      for (const sub of top.subAgents) {
        out.push(nodeOf(sub, top, sub.agentId ?? sub.id, project.name, parse));
      }
    }
  }
  return out;
}

function nodeOf(
  node: SessionNode,
  top: SessionNode,
  subagent: string | null,
  project: string,
  parse: (filePath: string) => import("../types/index.js").ActivityEntry[],
): NodeSnapshot {
  return {
    session: top.id,
    subagent,
    provider: node.provider ?? "claude",
    project,
    projectPath: node.projectPath,
    liveState: node.liveState,
    activities: parse(node.filePath),
  };
}

export interface RunFollowOptions {
  config: GlobalConfig;
  sinceMs: number;
  json: boolean;
  include: Set<string> | null;
  intervalMs?: number;
  now?: () => number;
  write?: (line: string) => void;
}

/** The loop. Seeds cursors from `sinceMs`, then diffs every interval. */
export function runFollow(opts: RunFollowOptions): { stop: () => void } {
  const now = opts.now ?? Date.now;
  const write = opts.write ?? ((l: string) => process.stdout.write(`${l}\n`));
  const interval = opts.intervalMs ?? opts.config.refreshIntervalMs ?? 2000;
  const fmt = opts.json ? formatJson : formatHuman;

  // Seed: backfill activities with ts >= sinceMs, then set cursors to "current".
  let state: FollowState = new Map();
  const seedTree = discoverSessions(opts.config);
  const seedSnaps = buildSnapshots(seedTree);
  {
    const t = now();
    const { events, nextState } = diffSnapshots(new Map(), seedSnaps, opts.include, t);
    state = nextState;
    for (const e of events) {
      if (e.type === "activity" && e.ts < opts.sinceMs) continue; // backfill floor
      if (e.type === "lifecycle" && e.kind === "session_start") continue; // don't announce pre-existing sessions at startup
      if (e.type === "lifecycle" && e.kind === "subagent_spawn") continue;
      write(fmt(e));
    }
  }

  const tick = () => {
    const snaps = buildSnapshots(discoverSessions(opts.config));
    const { events, nextState } = diffSnapshots(state, snaps, opts.include, now());
    state = nextState;
    for (const e of events) write(fmt(e));
  };
  const handle = setInterval(tick, interval);
  return { stop: () => clearInterval(handle) };
}
```

> NOTE: `ParseFn` shim above is illustrative — the engineer should type `parse` simply as `(filePath: string) => ActivityEntry[]` and import `ActivityEntry` from `../types/index.js`. Delete the unused `ParseFn` alias.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/data/followRunner.test.ts`
Expected: PASS.

- [ ] **Step 5: Add an integration test (one real cycle over a temp fixture)**

```ts
// Append to followRunner.test.ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { runFollow } from "../../src/data/followRunner.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "follow-"));
  const proj = join(dir, "projects", "-Users-neo-proj");
  mkdirSync(proj, { recursive: true });
  // a Claude session JSONL with one assistant response
  const line = JSON.stringify({
    type: "assistant",
    message: { model: "claude-opus-4-8", content: [{ type: "text", text: "hello world" }] },
    timestamp: new Date(2_000_000).toISOString(),
  });
  writeFileSync(join(proj, "sess.jsonl"), `${line}\n`);
  process.env.CLAUDE_PROJECTS_DIR = join(dir, "projects");
});
afterEach(() => {
  delete process.env.CLAUDE_PROJECTS_DIR;
  rmSync(dir, { recursive: true, force: true });
});

it("backfills NDJSON for activity at or after --since", () => {
  const lines: string[] = [];
  const cfg = { refreshIntervalMs: 99999, hiddenSessions: [], hiddenSubAgents: [], filterPresets: [[]], hiddenProjects: [], report: { include: [], detailLimit: 0, withGit: false, format: "markdown" as const }, summary: {} };
  const { stop } = runFollow({ config: cfg, sinceMs: 1_000_000, json: true, include: null, now: () => 3_000_000, write: (l) => lines.push(l) });
  stop();
  const events = lines.map((l) => JSON.parse(l));
  const responses = events.filter((e) => e.type === "activity" && e.label === "Response");
  expect(responses.length).toBeGreaterThanOrEqual(1);
  expect(responses[0]).toMatchObject({ project: "proj", provider: "claude" });
});
```

- [ ] **Step 6: Run + verify, then commit**

Run: `npx vitest run tests/data/followRunner.test.ts`
Expected: PASS. Then:

```bash
git add src/data/followRunner.ts tests/data/followRunner.test.ts
git commit -m "feat(follow): snapshot builder + follow loop"
```

---

## Task 6: CLI wiring (`src/cli.ts`)

**Files:** Modify `src/cli.ts`

- [ ] **Step 1: Extend the `mode` union + options**

In `CliOptions`, change `mode` to include `"follow"` and add:

```ts
  // follow
  followSince?: string;     // raw --since spec
  followJson?: boolean;
  followInclude?: string[];
  followError?: string;
```

- [ ] **Step 2: Register flags + subcommand**

Add `const KNOWN_FOLLOW_FLAGS = new Set(["--since", "--json", "--include"]);` and add `"follow"` to `KNOWN_SUBCOMMANDS`.

- [ ] **Step 3: Parse the follow subcommand**

Follow the existing `report`/`summary` parse pattern: when the first token is `follow`, set `mode = "follow"`, then walk flags: `--since <spec>` → `followSince`; `--json` → `followJson = true`; `--include a,b` → `followInclude = split`. Unknown flag → `followError`. Mirror how `report` validates `--include` against the allowed type list already in this file.

- [ ] **Step 4: Help text**

In `getHelp()`, add a `follow` block:

```
  follow [--since SPEC] [--json] [--include TYPES]
                                Stream live agent events (activity + state)
    --since now|<N>h|<N>m       Where to start (default: now)
    --json                      Emit NDJSON instead of human lines
    --include TYPES             Filter activity types (comma list)
```

- [ ] **Step 5: Test the parse**

Add cases to `tests/cli.test.ts` (mirror existing report/summary cases): `follow` → `mode:"follow"`; `follow --json --since 2h` → `followJson:true, followSince:"2h"`; `follow --include bash,edit` → `followInclude:["bash","edit"]`; bad flag → `followError` set.

- [ ] **Step 6: Run + commit**

Run: `npx vitest run tests/cli.test.ts && npx tsc --noEmit`
Expected: PASS.

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "feat(follow): CLI parsing + help"
```

---

## Task 7: Dispatch in `src/main.ts`

**Files:** Modify `src/main.ts`

- [ ] **Step 1: Dispatch before importing Ink**

Where `report` / `summary` modes are handled (they run and `process.exit` without rendering the TUI), add a `follow` branch:

```ts
if (options.mode === "follow") {
  if (options.followError) {
    console.error(options.followError);
    process.exit(2);
  }
  const { parseSince } = await import("./data/followSince.js");
  const { runFollow } = await import("./data/followRunner.js");
  const since = parseSince(options.followSince, Date.now());
  if ("error" in since) {
    console.error(since.error);
    process.exit(2);
  }
  const include = options.followInclude?.length ? new Set(options.followInclude) : null;
  const { stop } = runFollow({ config, sinceMs: since.sinceMs, json: !!options.followJson, include });
  const shutdown = () => { stop(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdout.on("error", () => process.exit(0)); // EPIPE on `| head`
  return; // keep the loop alive
}
```

Match the actual structure of `main.ts` (it loads `config` before dispatch). Place this branch alongside the existing non-TUI modes so Ink/App is never imported for `follow`.

- [ ] **Step 2: Manual smoke**

Run: `npx tsx src/index.ts follow --json --since 5m` (Ctrl-C to stop). Expect NDJSON lines for any current activity.

- [ ] **Step 3: Full verification + commit**

Run: `npx vitest run && npx tsc --noEmit && npx biome check .`
Expected: all PASS / clean.

```bash
git add src/main.ts
git commit -m "feat(follow): dispatch follow mode (no TUI)"
```

---

## Task 8: Docs

**Files:** Modify `FEATURES.md`, `CHANGELOG.md`, `README.md`

- [ ] **Step 1: FEATURES.md** — document the `follow` subcommand, all flags, the NDJSON event schema (copy the `FollowEvent` shape + the three `type`s), and the consumer note (pipe to a supervisor / `> events.ndjson`).

- [ ] **Step 2: CHANGELOG.md** — under `## [Unreleased]`, add: `### Added — agenthud follow: live merged event stream (activity + state + lifecycle) across all sessions/sub-agents; human lines or --json NDJSON.`

- [ ] **Step 3: README.md** — one line in the three-layers list (or near `report`) pointing at `follow` as the live machine-readable feed.

- [ ] **Step 4: Commit**

```bash
git add FEATURES.md CHANGELOG.md README.md
git commit -m "docs(follow): document the follow subcommand + event schema"
```

---

## Deferred (follow-up issues, NOT this plan)

- `--since HH:MM | ISO | last` (absolute/clock parsing + persisted `${agenthudHome()}/follow-state.json`).
- `--cwd PATH` scoping (reuse `findContainingProject` + `DiscoverOptions.scopeToProject`).
- Colored human output.
- Richer lifecycle: `error`, `compact` (only once the signals prove reliable).

## Self-review notes

- **Spec coverage:** command/flags (Task 6/7), event model incl. all three `type`s (Task 1/2), engine reuse + delta + cursor (Task 2/5), backfill floor (Task 5 seed), human+NDJSON (Task 3), `--since now/Nh/Nm` (Task 4), `--include` (Task 2 filter + Task 6 flag), error handling incl. EPIPE/SIGINT (Task 7), testing (every task). Deferred items match the spec's later phases.
- **Type consistency:** `FollowEvent`, `NodeSnapshot`, `FollowState`, `NodeCursor` defined once (Task 1) and used unchanged downstream; `diffSnapshots(prev, snapshots, include, now) → {events, nextState}` signature is identical in Task 2 impl and Task 5 caller.
- **Known rough edge:** the `ParseFn` alias in Task 5 step 3 is illustrative noise — the implementing agent must drop it and type `parse` as `(filePath: string) => ActivityEntry[]`. Flagged inline.
