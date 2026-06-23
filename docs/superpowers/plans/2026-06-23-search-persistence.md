# Search State Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make in-pane search a persistent state that survives Enter and Viewer↔Detail round-trips, with Enter's meaning on lists driven by whether the user navigated the selection.

**Architecture:** Add a `navigated` flag to `SearchState` and a `savedViewerSearch` slot in `App`. The Viewer/Tree Enter handlers (imperative, in `App.tsx`) branch on `navigated`: no-navigation → filter-confirm (keep search open); navigated → fire the row action (Viewer opens Detail, Tree selects node) while preserving/restoring the search. The Detail surface's existing two-phase model is unchanged.

**Tech Stack:** TypeScript, React, Ink, Vitest, ink-testing-library, Biome.

## Global Constraints

- All source, comments, commit messages, docs in **English**.
- Run `npx biome check --write <files>` before every commit (CI lints whole-repo Biome).
- TDD: write the failing test first, see it fail for the right reason, then implement.
- Never commit to `main` — work on branch `feat/210-search-persistence`.
- **Key escape sequences in tests (verified in this repo's ink-testing-library):** build them from the ESC byte via `String.fromCharCode(27)` — never paste a raw ESC byte into source. At the top of each `describe` that needs them: `const ESC = String.fromCharCode(27); const DOWN = ESC + "[B"; const UP = ESC + "[A";`. Then `stdin.write(DOWN)` / `stdin.write(ESC)`. A bare `"[B"` (no ESC prefix) types two literal characters into the query. In search mode `j`/`k` are typed into the query, not navigation.
- **Search prompt count is `current/total`, 1-BASED.** Empty query → `0/0`. Two matches at the first selection → `1/2`. After one ↓ → `2/2`. One match → `1/1`. Assert the exact count for the selection you expect, not the match total.
- Test timing: use condition waits (`vi.waitFor`) on committed frames, not fixed ticks. Footer markers: viewer focus → `↵: detail`; tree focus → `↵: expand`.
- Matching/narrowing logic (`activityMatch`, `treeSearch`, smart-case, panel hit-windowing) is **not** changed.

## Durable Implementation Record (controller protocol, not a code task)

After each task's review comes back clean, the SDD controller appends a 6-field
entry to a **committed** report log and a ledger line, per the user's global
workflow. The SDD `task-N-report.md` (under `.superpowers/sdd/` in the working
tree on superpowers ≥6.0.3 — git-ignored scratch, deleted by `git clean -fdx`)
is the *source*; the durable record is committed to the branch.

- File: `docs/superpowers/reports/2026-06-23-search-persistence.md`
- Per task entry (after clean review): **Intent** (one line from this plan) ·
  **What was built** · **Key decisions / trade-offs** · **Deviations from the
  plan** · **Files touched** · **Follow-ups / known gaps**.
- Running ledger line: `Task N: complete (commits <base7>..<head7>, review clean)`.
- At finish (PR): synthesize the entries into a one-page feature digest committed
  with the PR.

Known deviation to record up front: the spec's filter-confirm says "set
`committed = true`". This plan drives all Viewer/Tree behavior from `navigated`
and does **not** read `committed` for those surfaces, so it is left untouched
(YAGNI — no dead state). `committed` remains Detail-only. Record this in Task 1's
entry.

## File Structure

- `src/ui/search/searchKey.ts` — `SearchState` gains optional `navigated?: boolean`. Detail reducer (`applyDetailSearchKey`) unchanged (it spreads `...state`, so `navigated` carries through harmlessly).
- `src/ui/App.tsx` — `onOpenSearch` inits `navigated:false`; Viewer search handler (↑/↓ set `navigated`, query-edit resets it, Enter branches); `savedViewerSearch` state; `onDetailClose` restores it; Tree search handler (↑/↓ set `navigated`, Enter branches, stop closing on Enter).
- `tests/ui/App.test.tsx` — integration tests for each behavior; update the existing `#209` viewer-search test to navigate before Enter.

---

### Task 1: Viewer Enter — filter-confirm vs open-detail (driven by `navigated`)

**Files:**
- Modify: `src/ui/search/searchKey.ts` (`SearchState` interface)
- Modify: `src/ui/App.tsx` (`onOpenSearch`; the `search?.surface === "viewer"` block: `key.upArrow`/`key.downArrow`/`key.return`/typing/backspace)
- Test: `tests/ui/App.test.tsx`

**Interfaces:**
- Consumes: existing `activityMatches(mergedActivities, query)`, `scrollOffsetForCursor`, `openActivityDetail`, `setSearch`, `viewerSearchWindowStart`, `setViewerSearchWindowStart`, `edgeScrollWindowStart`.
- Produces: `SearchState.navigated?: boolean` (default-false semantics); Viewer Enter behavior — bare Enter keeps search open (filter-confirm), `↓`/`↑` then Enter opens the selected match's Detail (and, as before this task, closes the viewer search via `setSearch(null)` — round-trip preservation is added in Task 2).

- [ ] **Step 1: Add `navigated` to `SearchState`**

In `src/ui/search/searchKey.ts`, add the optional field to the interface:

```ts
export interface SearchState {
  surface: SearchSurface;
  query: string;
  index: number;
  committed: boolean; // true after Enter; false while typing (Detail surface)
  navigated?: boolean; // Tree/Viewer: has the user moved the selection with ↑/↓? default false
}
```

- [ ] **Step 2: Init `navigated` in `onOpenSearch`**

In `src/ui/App.tsx`, `onOpenSearch`:

```ts
onOpenSearch: () => {
  const surface: SearchSurface = detailMode ? "detail" : focus;
  setSearch({ surface, query: "", index: 0, committed: false, navigated: false });
  if (!detailMode && focus === "viewer") setViewerSearchWindowStart(0);
},
```

- [ ] **Step 3: Add the shared key constants to the viewer-search describe**

In `tests/ui/App.test.tsx`, in the `describe("viewer search → Enter opens Detail View", ...)` block, add right after the existing `const tick = ...` line:

```ts
  const ESC = String.fromCharCode(27);
  const DOWN = ESC + "[B";
```

- [ ] **Step 4: Write the failing test — bare Enter keeps the viewer search open**

Add inside the same `describe`. Two matching activities so the count is `1/2`:

```ts
it("bare Enter (no arrow) filter-confirms: search stays open, no detail", async () => {
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
            lastModifiedMs: Date.now(), status: "hot", modelName: null,
            subAgents: [], nonInteractive: false, firstUserPrompt: "do auth",
            liveState: null,
          },
        ],
      },
    ],
    coldProjects: [], totalCount: 1,
    timestamp: new Date().toISOString(), hiddenStats: { total: 0, active: 0 },
  };
  mockActivities = [
    { timestamp: new Date(2026, 0, 1, 9, 0, 0), type: "tool", icon: "○",
      label: "Read", detail: "auth.ts", detailBody: "READ_MARKER", detailKind: "code" },
    { timestamp: new Date(2026, 0, 1, 9, 0, 1), type: "tool", icon: "○",
      label: "Write", detail: "auth.test.ts", detailBody: "WRITE_MARKER", detailKind: "code" },
  ];

  const { stdin, lastFrame } = render(<App mode="watch" />);
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("auth.ts"), {
    timeout: 3000, interval: 25,
  });
  stdin.write("\t");
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("↵: detail"), {
    timeout: 3000, interval: 25,
  });
  stdin.write("/");
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("0/0"), {
    timeout: 3000, interval: 25,
  });
  for (const ch of "auth") { stdin.write(ch); await tick(); }
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1/2"), {
    timeout: 3000, interval: 25,
  });
  stdin.write("\r"); // bare Enter — no arrow navigation

  // Filter-confirm: search stays open (count still shown), no Detail opened.
  await tick();
  await tick();
  expect(lastFrame() ?? "").toContain("1/2");
  expect(lastFrame() ?? "").not.toContain("READ_MARKER");
  expect(lastFrame() ?? "").not.toContain("WRITE_MARKER");
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run tests/ui/App.test.tsx -t "filter-confirms"`
Expected: FAIL — current code opens the Detail (frame contains a marker) and closes search (no `1/2`).

- [ ] **Step 6: Implement the Enter branch + `navigated` set/reset**

In `src/ui/App.tsx`, in the `if (search?.surface === "viewer")` block.

Set `navigated: true` on both arrow handlers (keep the existing window-scroll calls):

```ts
if (key.upArrow) {
  if (hits.length === 0) return;
  const n = hits.length;
  const newIndex = (((search.index - 1) % n) + n) % n;
  setSearch((s) => (s ? { ...s, index: newIndex, navigated: true } : s));
  setViewerSearchWindowStart((prev) =>
    edgeScrollWindowStart(prev, newIndex, viewerRows, hits.length));
  return;
}
if (key.downArrow) {
  if (hits.length === 0) return;
  const n = hits.length;
  const newIndex = (search.index + 1) % n;
  setSearch((s) => (s ? { ...s, index: newIndex, navigated: true } : s));
  setViewerSearchWindowStart((prev) =>
    edgeScrollWindowStart(prev, newIndex, viewerRows, hits.length));
  return;
}
```

Replace the `if (key.return)` block with the navigated branch:

```ts
if (key.return) {
  if (!search.navigated) {
    // Filter-confirm: keep the narrowed search open; do NOT open a Detail.
    return;
  }
  // Navigated to a specific match → open its Detail View.
  if (hits.length > 0) {
    const safeIndex = ((search.index % hits.length) + hits.length) % hits.length;
    const hitIndex = hits[safeIndex];
    if (hitIndex !== undefined) {
      const newScrollOffset = scrollOffsetForCursor(
        mergedActivities.length, hitIndex, viewerRows);
      setViewerCursorLine(0);
      setIsLive(false);
      setScrollOffset(newScrollOffset);
      const act = mergedActivities[hitIndex];
      if (act) openActivityDetail(act);
    }
  }
  setSearch(null);
  return;
}
```

Reset `navigated: false` on typing and backspace (add to the existing updaters):

```ts
if (key.delete || key.backspace) {
  setSearch((s) =>
    s ? { ...s, query: s.query.slice(0, -1), index: 0, navigated: false } : s);
  setViewerSearchWindowStart(0);
  return;
}
if (input && !key.ctrl && input.length === 1) {
  setSearch((s) =>
    s ? { ...s, query: s.query + input, index: 0, navigated: false } : s);
  setViewerSearchWindowStart(0);
  return;
}
```

- [ ] **Step 7: Run the new test to verify it passes**

Run: `npx vitest run tests/ui/App.test.tsx -t "filter-confirms"`
Expected: PASS.

- [ ] **Step 8: Update the existing `#209` test to navigate before Enter**

The pre-existing test `opens the matched activity's detail on Enter (not just select+exit)` now requires navigation (bare Enter no longer opens Detail). It uses a single matching activity (`auth.ts`, `DETAIL_BODY_MARKER`, count `1/1`). Locate:

```ts
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1/1"), {
    timeout: 3000,
    interval: 25,
  });
  stdin.write("\r"); // Enter → open the matched activity's Detail View
```

Replace with (uses the `DOWN` constant added in Step 3):

```ts
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1/1"), {
    timeout: 3000,
    interval: 25,
  });
  // Navigating the selection (↓) makes Enter a row action; a bare Enter would
  // now filter-confirm instead of opening the Detail View. With one match the
  // count stays 1/1; the ↓ only sets the navigated flag.
  stdin.write(DOWN); // ↓ — mark the selection as navigated
  await tick();
  stdin.write("\r"); // Enter → open the navigated match's Detail View
```

- [ ] **Step 9: Run the full viewer-search describe + verify GREEN**

Run: `npx vitest run tests/ui/App.test.tsx -t "viewer search"`
Expected: PASS (both the updated `#209` test and the new filter-confirm test).

- [ ] **Step 10: Lint + commit**

```bash
npx biome check --write src/ui/search/searchKey.ts src/ui/App.tsx tests/ui/App.test.tsx
git add src/ui/search/searchKey.ts src/ui/App.tsx tests/ui/App.test.tsx
git commit -m "feat(search): viewer Enter filter-confirms unless a match was navigated (#210)"
```

---

### Task 2: Viewer ↔ Detail round-trip — preserve & restore the viewer search

**Files:**
- Modify: `src/ui/App.tsx` (new `savedViewerSearch` state near other `useState`s; the Viewer Enter navigated branch from Task 1; `onDetailClose`)
- Test: `tests/ui/App.test.tsx`

**Interfaces:**
- Consumes: Task 1's Viewer navigated-Enter branch; the `ESC`/`DOWN` constants added to the viewer-search describe in Task 1 Step 3; `viewerSearchWindowStart`/`setViewerSearchWindowStart`; `setSearch`; `setDetailMode`.
- Produces: `savedViewerSearch: { search: SearchState; windowStart: number } | null` state; on navigated-Enter the viewer search is snapshotted before opening Detail; `onDetailClose` restores it (search + hit-window) when present and clears the slot.

- [ ] **Step 1: Write the failing test — round-trip restores the viewer search + matched row**

Add to the same `describe("viewer search → Enter opens Detail View", ...)` block (uses `tick`, `ESC`, `DOWN` from Task 1). Two matching activities, distinct timestamps so `Write` is index 1:

```ts
it("restores the viewer search and the matched row after Esc out of Detail", async () => {
  mockTree = {
    projects: [
      {
        name: "proj", projectPath: "/tmp/proj", hotness: "hot",
        sessions: [
          {
            id: "s1", hideKey: "proj/s1", filePath: "/tmp/proj/s1.jsonl",
            projectPath: "/tmp/proj", projectName: "proj",
            lastModifiedMs: Date.now(), status: "hot", modelName: null,
            subAgents: [], nonInteractive: false, firstUserPrompt: "do auth",
            liveState: null,
          },
        ],
      },
    ],
    coldProjects: [], totalCount: 1,
    timestamp: new Date().toISOString(), hiddenStats: { total: 0, active: 0 },
  };
  mockActivities = [
    { timestamp: new Date(2026, 0, 1, 9, 0, 0), type: "tool", icon: "○",
      label: "Read", detail: "auth.ts", detailBody: "READ_MARKER", detailKind: "code" },
    { timestamp: new Date(2026, 0, 1, 9, 0, 1), type: "tool", icon: "○",
      label: "Write", detail: "auth.test.ts", detailBody: "WRITE_MARKER", detailKind: "code" },
  ];

  const { stdin, lastFrame } = render(<App mode="watch" />);
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("auth.ts"), {
    timeout: 3000, interval: 25,
  });
  stdin.write("\t");
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("↵: detail"), {
    timeout: 3000, interval: 25,
  });
  stdin.write("/");
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("0/0"), {
    timeout: 3000, interval: 25,
  });
  for (const ch of "auth") { stdin.write(ch); await tick(); }
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1/2"), {
    timeout: 3000, interval: 25,
  });
  stdin.write(DOWN); // ↓ → navigate to 2nd match (Write / auth.test.ts)
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("2/2"), {
    timeout: 3000, interval: 25,
  });
  stdin.write("\r"); // Enter → open that match's Detail
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("WRITE_MARKER"), {
    timeout: 3000, interval: 25,
  });
  stdin.write(ESC); // Esc → close Detail, back to viewer

  // Viewer search restored at the navigated selection (2/2), Detail closed.
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("2/2"), {
    timeout: 3000, interval: 25,
  });
  expect(lastFrame() ?? "").not.toContain("WRITE_MARKER");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/ui/App.test.tsx -t "restores the viewer search"`
Expected: FAIL — after Esc the viewer has no search (no `2/2`); Task 1 still calls `setSearch(null)` on navigated-Enter without saving.

- [ ] **Step 3: Add the `savedViewerSearch` state**

In `src/ui/App.tsx`, near the other search-related `useState`s (e.g. just after `const [search, setSearch] = useState<SearchState | null>(null);`), add:

```ts
// When a Detail is opened from an active viewer search, stash the search so
// closing the Detail (Esc) drops the user back into the same search with the
// matched row selected. Null when a Detail was opened without a viewer search.
const [savedViewerSearch, setSavedViewerSearch] = useState<{
  search: SearchState;
  windowStart: number;
} | null>(null);
```

- [ ] **Step 4: Snapshot the search in the navigated-Enter branch**

In the Viewer `if (key.return)` navigated branch (from Task 1), add the snapshot just before `openActivityDetail`:

```ts
  if (hitIndex !== undefined) {
    const newScrollOffset = scrollOffsetForCursor(
      mergedActivities.length, hitIndex, viewerRows);
    setSavedViewerSearch({ search, windowStart: viewerSearchWindowStart });
    setViewerCursorLine(0);
    setIsLive(false);
    setScrollOffset(newScrollOffset);
    const act = mergedActivities[hitIndex];
    if (act) openActivityDetail(act);
  }
```

- [ ] **Step 5: Restore on Detail close**

Replace `onDetailClose`:

```ts
onDetailClose: () => {
  setDetailMode(false);
  if (savedViewerSearch) {
    // Came here from a viewer search → restore it with the matched row.
    setSearch(savedViewerSearch.search);
    setViewerSearchWindowStart(savedViewerSearch.windowStart);
    setSavedViewerSearch(null);
  }
},
```

- [ ] **Step 6: Run the round-trip test to verify it passes**

Run: `npx vitest run tests/ui/App.test.tsx -t "restores the viewer search"`
Expected: PASS.

- [ ] **Step 7: Write the layering test — Detail's own search does not clobber the saved viewer search**

```ts
it("Detail's own search resets on Esc without losing the saved viewer search", async () => {
  mockTree = {
    projects: [
      {
        name: "proj", projectPath: "/tmp/proj", hotness: "hot",
        sessions: [
          {
            id: "s1", hideKey: "proj/s1", filePath: "/tmp/proj/s1.jsonl",
            projectPath: "/tmp/proj", projectName: "proj",
            lastModifiedMs: Date.now(), status: "hot", modelName: null,
            subAgents: [], nonInteractive: false, firstUserPrompt: "do auth",
            liveState: null,
          },
        ],
      },
    ],
    coldProjects: [], totalCount: 1,
    timestamp: new Date().toISOString(), hiddenStats: { total: 0, active: 0 },
  };
  mockActivities = [
    { timestamp: new Date(2026, 0, 1, 9, 0, 0), type: "tool", icon: "○",
      label: "Read", detail: "auth.ts", detailBody: "alpha beta gamma", detailKind: "code" },
    { timestamp: new Date(2026, 0, 1, 9, 0, 1), type: "tool", icon: "○",
      label: "Write", detail: "auth.test.ts", detailBody: "alpha beta gamma", detailKind: "code" },
  ];

  const { stdin, lastFrame } = render(<App mode="watch" />);
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("auth.ts"), {
    timeout: 3000, interval: 25,
  });
  stdin.write("\t");
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("↵: detail"), {
    timeout: 3000, interval: 25,
  });
  stdin.write("/");
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("0/0"), {
    timeout: 3000, interval: 25,
  });
  for (const ch of "auth") { stdin.write(ch); await tick(); }
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1/2"), {
    timeout: 3000, interval: 25,
  });
  stdin.write(DOWN); // ↓ navigate to 2nd match
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("2/2"), {
    timeout: 3000, interval: 25,
  });
  stdin.write("\r"); // open Detail
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("alpha"), {
    timeout: 3000, interval: 25,
  });

  // Detail's own body search, then Esc to reset it (stay in Detail).
  stdin.write("/");
  await tick();
  for (const ch of "beta") { stdin.write(ch); await tick(); }
  await tick();
  stdin.write(ESC); // Esc → reset Detail search only (still in Detail)
  await tick();
  expect(lastFrame() ?? "").toContain("alpha"); // still in Detail body

  // Esc again → close Detail → viewer search restored.
  stdin.write(ESC);
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("2/2"), {
    timeout: 3000, interval: 25,
  });
});
```

- [ ] **Step 8: Run it (guard test — should pass on Task 2 code)**

Run: `npx vitest run tests/ui/App.test.tsx -t "without losing the saved viewer search"`
Expected: PASS. If it fails, the saved search is being cleared too early — fix `onDetailClose`/snapshot so `savedViewerSearch` is only consumed on the Detail-closing Esc, then re-run.

- [ ] **Step 9: Full suite + lint + commit**

```bash
npx vitest run
npx biome check --write src/ui/App.tsx tests/ui/App.test.tsx
git add src/ui/App.tsx tests/ui/App.test.tsx
git commit -m "feat(search): preserve & restore viewer search across Detail round-trip (#210)"
```

Expected: full suite green.

---

### Task 3: Tree Enter — filter-confirm vs select-node, keep search alive

**Files:**
- Modify: `src/ui/App.tsx` (the `search?.surface === "tree"` block: `key.upArrow`/`key.downArrow`/`key.return`/typing/backspace)
- Test: `tests/ui/App.test.tsx`

**Interfaces:**
- Consumes: `treeSearchHits(displayTree, query)`, `setSelectedId`, `stopTracking`, `setSearch`, `SearchState.navigated`.
- Produces: Tree Enter behavior — bare Enter keeps the tree search open (filter-confirm); `↓`/`↑` then Enter selects/expands the navigated node and keeps the search open. Esc still ends the tree search (unchanged).

- [ ] **Step 1: Write the failing test — tree Enter keeps the search open**

Add a new top-level `describe` in `tests/ui/App.test.tsx`. Two matching sessions so the tree search has 2 hits:

```ts
describe("tree search → Enter keeps search alive", () => {
  const tick = () => new Promise((r) => setTimeout(r, 50));
  const ESC = String.fromCharCode(27);
  const DOWN = ESC + "[B";

  const twoMatchingSessions = (): SessionTree => ({
    projects: [
      {
        name: "proj", projectPath: "/tmp/proj", hotness: "hot",
        sessions: [
          {
            id: "s1", hideKey: "proj/s1", filePath: "/tmp/proj/s1.jsonl",
            projectPath: "/tmp/proj", projectName: "proj",
            lastModifiedMs: Date.now(), status: "hot", modelName: null,
            subAgents: [], nonInteractive: false,
            firstUserPrompt: "auth login", liveState: null,
          },
          {
            id: "s2", hideKey: "proj/s2", filePath: "/tmp/proj/s2.jsonl",
            projectPath: "/tmp/proj", projectName: "proj",
            lastModifiedMs: Date.now(), status: "hot", modelName: null,
            subAgents: [], nonInteractive: false,
            firstUserPrompt: "auth logout", liveState: null,
          },
        ],
      },
    ],
    coldProjects: [], totalCount: 2,
    timestamp: new Date().toISOString(), hiddenStats: { total: 0, active: 0 },
  });

  it("bare Enter filter-confirms without closing the tree search", async () => {
    mockTree = twoMatchingSessions();
    mockActivities = [];

    const { stdin, lastFrame } = render(<App mode="watch" />);
    // Tree is focused at boot ("↵: expand" footer); open tree search directly.
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("↵: expand"), {
      timeout: 3000, interval: 25,
    });
    stdin.write("/");
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("0/0"), {
      timeout: 3000, interval: 25,
    });
    for (const ch of "auth") { stdin.write(ch); await tick(); }
    await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1/2"), {
      timeout: 3000, interval: 25,
    });
    stdin.write("\r"); // bare Enter

    // Search stays open (count still rendered), not torn down.
    await tick();
    await tick();
    expect(lastFrame() ?? "").toContain("1/2");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/ui/App.test.tsx -t "filter-confirms without closing the tree"`
Expected: FAIL — current tree Enter calls `setSearch(null)`, so the count disappears.

- [ ] **Step 3: Implement the tree Enter branch + `navigated`**

In `src/ui/App.tsx`, in the `if (search?.surface === "tree")` block, set `navigated: true` on the arrows:

```ts
if (key.upArrow) {
  if (hits.length === 0) return;
  const n = hits.length;
  setSearch((s) =>
    s ? { ...s, index: (((s.index - 1) % n) + n) % n, navigated: true } : s);
  return;
}
if (key.downArrow) {
  if (hits.length === 0) return;
  const n = hits.length;
  setSearch((s) => (s ? { ...s, index: (s.index + 1) % n, navigated: true } : s));
  return;
}
```

Replace the tree `if (key.return)` block:

```ts
if (key.return) {
  if (!search.navigated) {
    // Filter-confirm: keep the narrowed tree search open.
    return;
  }
  // Navigated to a hit → select/expand it, keep the search open.
  if (hits.length > 0) {
    const safeIndex = ((search.index % hits.length) + hits.length) % hits.length;
    const hitId = hits[safeIndex];
    if (hitId !== undefined) {
      setSelectedId(hitId);
      stopTracking();
    }
  }
  return;
}
```

Reset `navigated: false` on tree typing and backspace:

```ts
if (key.delete || key.backspace) {
  setSearch((s) =>
    s ? { ...s, query: s.query.slice(0, -1), index: 0, navigated: false } : s);
  return;
}
if (input && !key.ctrl && input.length === 1) {
  setSearch((s) =>
    s ? { ...s, query: s.query + input, index: 0, navigated: false } : s);
  return;
}
```

- [ ] **Step 4: Run the tree test to verify it passes**

Run: `npx vitest run tests/ui/App.test.tsx -t "filter-confirms without closing the tree"`
Expected: PASS.

- [ ] **Step 5: Write the navigated-Enter test — select node, search stays**

Add inside the same `describe`:

```ts
it("↓ then Enter selects the navigated node and keeps the search open", async () => {
  mockTree = twoMatchingSessions();
  mockActivities = [];

  const { stdin, lastFrame } = render(<App mode="watch" />);
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("↵: expand"), {
    timeout: 3000, interval: 25,
  });
  stdin.write("/");
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("0/0"), {
    timeout: 3000, interval: 25,
  });
  for (const ch of "auth") { stdin.write(ch); await tick(); }
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("1/2"), {
    timeout: 3000, interval: 25,
  });
  stdin.write(DOWN); // ↓ navigate
  await vi.waitFor(() => expect(lastFrame() ?? "").toContain("2/2"), {
    timeout: 3000, interval: 25,
  });
  stdin.write("\r"); // Enter → select node

  // Search remains open after the selection (count still at the navigated 2/2).
  await tick();
  await tick();
  expect(lastFrame() ?? "").toContain("2/2");
});
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run tests/ui/App.test.tsx -t "selects the navigated node"`
Expected: PASS (selection logic unchanged; the only new behavior — not closing search — is already implemented in Step 3).

- [ ] **Step 7: Full suite + lint + commit**

```bash
npx vitest run
npx biome check --write src/ui/App.tsx tests/ui/App.test.tsx
git add src/ui/App.tsx tests/ui/App.test.tsx
git commit -m "feat(search): tree Enter keeps search alive (filter-confirm / select node) (#210)"
```

Expected: full suite green.

---

## Self-Review

**Spec coverage:**
- State model `navigated` → Task 1 (Steps 1–2, 6). `savedViewerSearch` slot → Task 2.
- Enter (Viewer) filter-confirm vs row-action → Task 1.
- Enter (Tree) filter-confirm vs select-node → Task 3.
- Enter (Detail) two-phase unchanged → no task (regression covered by full-suite runs in Tasks 2–3 and existing `searchKey.test.ts`).
- Esc layering rows 1–2 (Detail's own search reset; Detail close restores viewer search) → Task 2 (round-trip + layering tests). Esc row 3 (base Viewer/Tree search ends on Esc) → unchanged existing behavior; the search blocks still `setSearch(null)` on `key.escape`.
- Viewer↔Detail round-trip incl. matched-row cursor → Task 2.
- Detail independent body search → Task 2 Step 7.
- `committed=true` on filter-confirm → **deviation**: not implemented (YAGNI, nothing reads it for Viewer/Tree); recorded in the Durable Record section + Task 1 entry.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `navigated?: boolean` defined in Task 1 Step 1; read as `!search.navigated` / `search.navigated` and written `navigated: true|false` consistently in Tasks 1 & 3. `savedViewerSearch` shape `{ search: SearchState; windowStart: number }` defined and consumed consistently in Task 2.

**Test-mechanics consistency:** all arrow/Esc sends use `String.fromCharCode(27)`-built `DOWN`/`ESC` constants; all count assertions are 1-based (`0/0` empty, `1/2` first of two, `2/2` after one ↓, `1/1` single match). No raw ESC bytes in source.
