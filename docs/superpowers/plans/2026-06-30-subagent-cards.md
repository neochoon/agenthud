# Sub-agent Black-Box Cards (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a **sub-agent** is selected, the Activity Viewer shows a summary header (status · steps · duration · intent · result) above the existing activity stream; main sessions are unchanged.

**Architecture:** A pure `buildSubAgentSummary(node, activities)` derives the summary from already-parsed data; `App` computes it for the selected node and passes it to `ActivityViewerPanel`, which renders a few header rows above the (existing) stream when the prop is present.

**Tech Stack:** TypeScript, React, Ink, Vitest, ink-testing-library, Biome.

## Global Constraints

- All source/comments/commit messages/docs in **English**.
- Run `npx biome check --write <files>` before every commit (CI lints whole-repo Biome).
- TDD: write the failing test first, see it fail for the right reason, then implement.
- Never commit to `main` — work on branch `feat/226-subagent-cards`.
- **Zero new data collection.** Use only existing fields: `SessionNode.{agentId, taskDescription, modelName, liveState, status}` and the selected node's already-parsed `ActivityEntry[]`.
- **isSubAgent ≡ `node.agentId` is set** (main sessions have no `agentId`).
- **status is `running | done` only** — `running` when `liveState === "working"`, else `done`. No `failed` (no reliable signal; deferred per the spec).
- **steps = count of `activities` with `type === "tool"`** (tool-call count, not turns).
- **duration = last activity `timestamp` − first activity `timestamp`** (run length); `null` when fewer than 2 activities.
- **result = the last activity with `type === "response"`** (its `detail`); `""` when none.
- Sub-agent header applies to the **non-search** viewer render only; the viewer narrow-finder path is unchanged.

## File Structure

- `src/ui/subAgentSummary.ts` — **new**. Pure: `SubAgentSummary` type, `buildSubAgentSummary`, `formatDuration`. No React, no `App` import.
- `src/ui/ActivityViewerPanel.tsx` — **modify**. New optional `subAgentSummary` prop; render header rows above the stream when set.
- `src/ui/App.tsx` — **modify**. Compute the summary for the selected node and pass it to the panel.
- Tests: `tests/ui/subAgentSummary.test.ts` (new), `tests/ui/ActivityViewerPanel.test.tsx`, `tests/ui/App.test.tsx`.

---

### Task 1: `buildSubAgentSummary` + `formatDuration` (pure)

**Files:**
- Create: `src/ui/subAgentSummary.ts`
- Test: `tests/ui/subAgentSummary.test.ts`

**Interfaces:**
- Consumes: `SessionNode`, `ActivityEntry` from `../types/index.js`.
- Produces:
  - `interface SubAgentSummary { status: "running" | "done"; steps: number; durationMs: number | null; intent: string; result: string; model: string | null }`
  - `buildSubAgentSummary(node: SessionNode, activities: ActivityEntry[]): SubAgentSummary | null` — `null` when `!node.agentId`.
  - `formatDuration(ms: number): string` — e.g. `5s`, `2m14s`, `1h1m`.

- [ ] **Step 1: Write the failing test**

Create `tests/ui/subAgentSummary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ActivityEntry, SessionNode } from "../../src/types/index.js";
import {
  buildSubAgentSummary,
  formatDuration,
} from "../../src/ui/subAgentSummary.js";

const node = (over: Partial<SessionNode> = {}): SessionNode => ({
  id: "id1",
  hideKey: "p/id1",
  filePath: "/tmp/id1.jsonl",
  projectPath: "/tmp/p",
  projectName: "p",
  lastModifiedMs: 0,
  status: "hot",
  modelName: "sonnet-4.6",
  subAgents: [],
  nonInteractive: false,
  firstUserPrompt: null,
  liveState: null,
  ...over,
});

const tool = (ms: number): ActivityEntry => ({
  timestamp: new Date(ms),
  type: "tool",
  icon: "○",
  label: "Read",
  detail: "x.ts",
});
const response = (ms: number, text: string): ActivityEntry => ({
  timestamp: new Date(ms),
  type: "response",
  icon: "✦",
  label: "Response",
  detail: text,
});

describe("buildSubAgentSummary", () => {
  it("returns null for a main session (no agentId)", () => {
    expect(buildSubAgentSummary(node(), [tool(0)])).toBeNull();
  });

  it("derives steps, duration, result, intent for a finished sub-agent", () => {
    const acts = [tool(1000), tool(2000), response(5000, "All done")];
    const s = buildSubAgentSummary(
      node({ agentId: "agent-abc", taskDescription: "Do the thing" }),
      acts,
    );
    expect(s).toEqual({
      status: "done",
      steps: 2,
      durationMs: 4000,
      intent: "Do the thing",
      result: "All done",
      model: "sonnet-4.6",
    });
  });

  it("reports running when liveState is working", () => {
    const s = buildSubAgentSummary(
      node({ agentId: "a", liveState: "working" }),
      [tool(0)],
    );
    expect(s?.status).toBe("running");
  });

  it("handles 0 and 1 activities (null duration, empty result)", () => {
    expect(
      buildSubAgentSummary(node({ agentId: "a" }), []),
    ).toMatchObject({ steps: 0, durationMs: null, result: "" });
    expect(
      buildSubAgentSummary(node({ agentId: "a" }), [tool(10)]),
    ).toMatchObject({ steps: 1, durationMs: null });
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes, hours", () => {
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(134000)).toBe("2m14s");
    expect(formatDuration(3_660_000)).toBe("1h1m");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run tests/ui/subAgentSummary.test.ts`
Expected: FAIL — `buildSubAgentSummary`/`formatDuration` not found (module missing).

- [ ] **Step 3: Implement**

Create `src/ui/subAgentSummary.ts`:

```ts
/**
 * Derive a sub-agent's "black-box" summary (intent → status/steps/duration →
 * result) from data already on the node and its parsed activity stream. Pure;
 * returns null for main sessions (which have no agentId and keep full detail).
 */
import type { ActivityEntry, SessionNode } from "../types/index.js";

export interface SubAgentSummary {
  status: "running" | "done";
  steps: number;
  durationMs: number | null;
  intent: string;
  result: string;
  model: string | null;
}

export function buildSubAgentSummary(
  node: SessionNode,
  activities: ActivityEntry[],
): SubAgentSummary | null {
  if (!node.agentId) return null;
  const steps = activities.filter((a) => a.type === "tool").length;
  const durationMs =
    activities.length >= 2
      ? activities[activities.length - 1].timestamp.getTime() -
        activities[0].timestamp.getTime()
      : null;
  let result = "";
  for (let i = activities.length - 1; i >= 0; i--) {
    if (activities[i].type === "response") {
      result = activities[i].detail;
      break;
    }
  }
  return {
    status: node.liveState === "working" ? "running" : "done",
    steps,
    durationMs,
    intent: node.taskDescription ?? "",
    result,
    model: node.modelName,
  };
}

export function formatDuration(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run tests/ui/subAgentSummary.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
npx biome check --write src/ui/subAgentSummary.ts tests/ui/subAgentSummary.test.ts
git add src/ui/subAgentSummary.ts tests/ui/subAgentSummary.test.ts
git commit -m "feat(subagent): pure buildSubAgentSummary + formatDuration (#226)"
```

---

### Task 2: Render the summary header in `ActivityViewerPanel`

**Files:**
- Modify: `src/ui/ActivityViewerPanel.tsx` (props interface; the non-search render tail)
- Test: `tests/ui/ActivityViewerPanel.test.tsx`

**Interfaces:**
- Consumes: `SubAgentSummary`, `formatDuration` from `./subAgentSummary.js` (Task 1).
- Produces: `ActivityViewerPanelProps.subAgentSummary?: SubAgentSummary | null`. When set, the panel renders header rows (chip + intent, optional result, an `─ activity (↵ drill in)` divider) above the stream and shrinks the stream's row budget so the box height is unchanged.

- [ ] **Step 1: Write the failing test**

Add to `tests/ui/ActivityViewerPanel.test.tsx`:

```ts
describe("ActivityViewerPanel — sub-agent summary header", () => {
  const summary = {
    status: "done" as const,
    steps: 3,
    durationMs: 134000,
    intent: "Research the thing",
    result: "Recommends option B",
    model: "sonnet-4.6",
  };

  it("renders the header (intent/result/steps) when subAgentSummary is set", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
        subAgentSummary={summary}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("Research the thing"); // intent
    expect(out).toContain("3 steps"); // metric chip
    expect(out).toContain("Recommends option B"); // result
    expect(out).toContain("activity"); // divider label
    expect(out).toContain("Read"); // stream still present below
  });

  it("renders no header for a main session (prop absent)", () => {
    const { lastFrame } = render(
      <ActivityViewerPanel
        {...baseProps}
        activities={[makeActivity("Read", 0)]}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).not.toContain("3 steps");
    expect(out).not.toContain("↵ drill in");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run tests/ui/ActivityViewerPanel.test.tsx -t "sub-agent summary header"`
Expected: FAIL — header text (`Research the thing`, `3 steps`) absent (prop ignored).

- [ ] **Step 3: Add the prop + import**

In `src/ui/ActivityViewerPanel.tsx`, add the import near the other local imports:

```ts
import type { SubAgentSummary } from "./subAgentSummary.js";
import { formatDuration } from "./subAgentSummary.js";
```

Add to `ActivityViewerPanelProps` (after `searchWindowStart?`):

```ts
  /** When the selected node is a sub-agent, its black-box summary; renders a
   * header above the (demoted) activity stream. Absent for main sessions. */
  subAgentSummary?: SubAgentSummary | null;
```

Add `subAgentSummary` to the destructured parameters of the component (alongside `searchWindowStart`).

- [ ] **Step 4: Build the header rows and shrink the stream budget**

In the **non-search** render tail (the block that starts with `let visibleActivities` / `if (activities.length === 0)` near the end of the component), insert BEFORE `let visibleActivities`:

```tsx
  // Sub-agent black-box header (P1): fixed rows above the stream. The stream's
  // row budget shrinks by the header height so the box stays `visibleRows` tall.
  const headerLines: React.ReactElement[] = [];
  if (subAgentSummary) {
    const s = subAgentSummary;
    const boxRow = (key: string, text: string) => {
      const t = truncateByWidth(text, contentWidth - 1);
      const pad = Math.max(0, contentWidth - 1 - getDisplayWidth(t));
      return (
        <Text key={key}>
          {BOX.v} {t}
          {" ".repeat(pad)}
          {BOX.v}
        </Text>
      );
    };
    const dur = s.durationMs === null ? "" : ` · ${formatDuration(s.durationMs)}`;
    const model = s.model ? ` · ${s.model}` : "";
    const chip = `${s.status} · ${s.steps} steps${dur}${model}`;
    headerLines.push(boxRow("sa-chip", `${chip}  ${s.intent}`.trimEnd()));
    if (s.result) {
      headerLines.push(
        boxRow("sa-result", `Result: ${s.result.replace(/\s+/g, " ").trim()}`),
      );
    }
    headerLines.push(boxRow("sa-div", "─ activity (↵ drill in)"));
  }
  const streamRows = Math.max(1, visibleRows - headerLines.length);
```

Then, in that same tail, replace the three `visibleRows` uses that bound the stream with `streamRows`:

```tsx
  let visibleActivities: ActivityEntry[];
  if (activities.length === 0) {
    visibleActivities = [];
  } else if (isLive) {
    visibleActivities = activities.slice(-streamRows);
  } else {
    const end = Math.max(0, activities.length - scrollOffset);
    const start = Math.max(0, end - streamRows);
    visibleActivities = activities.slice(start, end);
  }
```

and the padding:

```tsx
  const padCount = Math.max(0, streamRows - lines.length);
```

and prepend the header to the final content:

```tsx
  const finalLines = [...headerLines, ...padded, ...lines];
```

(The `return (...)` block is unchanged — it already renders `{finalLines}` between the title and bottom lines.)

- [ ] **Step 5: Run it — verify it passes**

Run: `npx vitest run tests/ui/ActivityViewerPanel.test.tsx -t "sub-agent summary header"`
Expected: PASS.

- [ ] **Step 6: Run the whole panel suite (regression) + lint + commit**

```bash
npx vitest run tests/ui/ActivityViewerPanel.test.tsx
npx biome check --write src/ui/ActivityViewerPanel.tsx tests/ui/ActivityViewerPanel.test.tsx
git add src/ui/ActivityViewerPanel.tsx tests/ui/ActivityViewerPanel.test.tsx
git commit -m "feat(subagent): viewer renders the sub-agent summary header (#226)"
```

Expected: panel suite green (main-session renders unchanged).

---

### Task 3: Wire the summary in `App` for the selected node

**Files:**
- Modify: `src/ui/App.tsx` (import; compute `subAgentSummary`; pass the prop)
- Test: `tests/ui/App.test.tsx`

**Interfaces:**
- Consumes: `buildSubAgentSummary` (Task 1); `ActivityViewerPanel.subAgentSummary` prop (Task 2); existing `selectedSession` (the resolved selected `SessionNode`) and `mergedActivities`.
- Produces: the viewer receives a real summary when a sub-agent is selected, `null` otherwise.

- [ ] **Step 1: Write the failing test**

Add a new top-level `describe` in `tests/ui/App.test.tsx` (the file already mocks `parseSessionHistory` → `mockActivities` and `discoverSessions` → `mockTree`, and sets `vi.setConfig({ testTimeout: 20000 })`):

```ts
describe("App — sub-agent viewer summary header", () => {
  const tick = () => new Promise((r) => setTimeout(r, 50));
  const DOWN = String.fromCharCode(27) + "[B"; // ESC prefix REQUIRED (see prior CI fixes)

  it("shows the intent header when a sub-agent row is selected", async () => {
    mockTree = {
      projects: [
        {
          name: "proj",
          projectPath: "/tmp/proj",
          hotness: "hot",
          sessions: [
            {
              id: "s1", hideKey: "proj/s1", filePath: "/tmp/proj/s1.jsonl",
              projectPath: "/tmp/proj", projectName: "proj",
              lastModifiedMs: Date.now(), status: "hot", modelName: "sonnet-4.6",
              nonInteractive: false, firstUserPrompt: "parent", liveState: null,
              subAgents: [
                {
                  id: "a1", hideKey: "proj/a1", filePath: "/tmp/proj/a1.jsonl",
                  projectPath: "/tmp/proj", projectName: "", lastModifiedMs: Date.now(),
                  status: "hot", modelName: "sonnet-4.6", subAgents: [],
                  nonInteractive: false, firstUserPrompt: null, liveState: "working",
                  agentId: "agent-abc123", taskDescription: "DO_THE_THING",
                },
              ],
            },
          ],
        },
      ],
      coldProjects: [],
      totalCount: 1,
      timestamp: new Date().toISOString(),
      hiddenStats: { total: 0, active: 0 },
    };
    mockActivities = [
      { timestamp: new Date(2026, 0, 1, 9, 0, 0), type: "tool", icon: "○", label: "Read", detail: "x.ts" },
      { timestamp: new Date(2026, 0, 1, 9, 0, 2), type: "response", icon: "✦", label: "Response", detail: "RESULT_TEXT" },
    ];

    const { stdin, lastFrame } = render(<App mode="watch" />);
    // Tree is focused at boot; selection starts on the project sentinel.
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("↵: expand"), {
      timeout: 3000, interval: 25,
    });
    // ↓ to the session, ↓ to the (running) sub-agent row.
    stdin.write(DOWN);
    await tick();
    stdin.write(DOWN);
    // The summary header (intent) only renders when the sub-agent is selected.
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("DO_THE_THING"), {
      timeout: 5000, interval: 25,
    });
    expect(lastFrame() ?? "").toContain("1 steps"); // metric chip (header-only)
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run tests/ui/App.test.tsx -t "sub-agent viewer summary header"`
Expected: FAIL — `DO_THE_THING` never appears (App doesn't compute/pass the summary).

- [ ] **Step 3: Implement the wiring**

In `src/ui/App.tsx`, add the import near the other `./` imports:

```ts
import { buildSubAgentSummary } from "./subAgentSummary.js";
```

Compute the summary just before the JSX return (near where `selectedSession` and `mergedActivities` are both in scope — `selectedSession` is the resolved node assigned around `const rawSelected = allFlat.find(...)` / `let selectedSession = rawSelected;`):

```ts
  const subAgentSummary = selectedSession
    ? buildSubAgentSummary(selectedSession, mergedActivities)
    : null;
```

Pass it to the panel — add this prop inside the existing `<ActivityViewerPanel ... />` (e.g. after `searchWindowStart={...}`):

```tsx
                subAgentSummary={subAgentSummary}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run tests/ui/App.test.tsx -t "sub-agent viewer summary header"`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck + lint + commit**

```bash
npx vitest run
npx tsc --noEmit
npx biome check --write src/ui/App.tsx tests/ui/App.test.tsx
git add src/ui/App.tsx tests/ui/App.test.tsx
git commit -m "feat(subagent): App passes the sub-agent summary to the viewer (#226)"
```

Expected: full suite green, tsc clean.

---

## Self-Review

**Spec coverage:**
- Summary header (intent/status/steps/duration/result/model) → Task 1 (data) + Task 2 (render).
- isSubAgent ≡ `agentId`; main sessions unchanged → Task 1 returns null; Task 2 "no header" test; Task 3 selects a sub-agent.
- status running/done; steps=tool count; duration=first→last; result=last response → Task 1 (Global Constraints copied verbatim).
- Layout = header + stream below, drill-in unchanged → Task 2 (header rows above existing stream; `streamRows` keeps box height; stream/`↵` untouched).
- 80-col guard via `truncateByWidth` → Task 2 `boxRow` truncates each line to `contentWidth - 1`.
- Out of scope (cost/fleet roll-up/failed/tree-row metrics) → not in any task, per spec.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `SubAgentSummary` fields (`status`/`steps`/`durationMs`/`intent`/`result`/`model`) defined in Task 1 and consumed identically in Tasks 2–3. `buildSubAgentSummary(node, activities)` / `formatDuration(ms)` signatures consistent across tasks. Prop name `subAgentSummary` consistent in Tasks 2 and 3.

**Note (minor spec deviation):** the spec's `SubAgentSummary` listed a `name` field; dropped — the panel already renders the node's display name in its title bar, so `name` would be dead. The metric chip carries status/steps/duration/model; intent/result are their own rows.
