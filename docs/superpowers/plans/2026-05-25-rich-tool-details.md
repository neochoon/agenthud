# Rich Tool Activity Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich tool activity rows (Edit/Write line range + change counts, Read range, TaskUpdate status change, TaskCreate subject) and render Edit diffs / Write content in the detail view, by correlating each `tool_use` with its `toolUseResult`.

**Architecture:** A new pure `src/data/toolDetails.ts` holds per-tool formatting (`summarizeToolDetail` for the row, `buildToolDetailBody` for the detail view). `parseActivitiesFromLines` does a pre-pass mapping `tool_use_id → toolUseResult`, then feeds inputs+results to those functions. `DetailViewPanel` renders an optional `detailBody` with `detailKind`-driven coloring, reusing the existing diff/code line classifiers.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Ink, Vitest, Biome. Spec: `docs/superpowers/specs/2026-05-25-rich-tool-details-design.md`. Issue: #84.

**Constraints discovered:**
- `getToolDetail` is currently exported from `src/data/activityParser.ts` and imported by `tests/data/activityParser.test.ts`. It moves to `toolDetails.ts`; `activityParser.ts` re-exports it so that existing import keeps resolving.
- CI runs `npx tsc --noEmit` (type-checks `src/` only) + `npm run build`; it does NOT run Biome. Lint locally on changed files only.
- `ActivityEntry` is defined in `src/types/index.ts`; `DetailViewPanel` already colors `type:"commit"` via `classifyDiffLines` and everything else via `classifyCodeFences` (`src/ui/lineColoring.ts`).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/types/index.ts` | `ActivityEntry` += `detailBody?`, `detailKind?` | Modify |
| `src/data/toolDetails.ts` | Pure per-tool formatting: `ToolInput`, `ToolUseResult`, `getToolDetail`, `summarizeToolDetail`, `buildToolDetailBody` | Create |
| `src/data/activityParser.ts` | `tool_use_id → toolUseResult` pre-pass; use toolDetails; re-export `getToolDetail` | Modify |
| `src/ui/DetailViewPanel.tsx` | Render `detailBody` with `detailKind` coloring | Modify |
| `tests/data/toolDetails.test.ts` | Unit tests for the two formatters | Create |
| `tests/data/activityParser.test.ts` | Correlation + enrichment | Modify |
| `tests/ui/DetailViewPanel.test.tsx` | Diff/content body rendering | Modify |

---

## Task 1: `toolDetails.ts` pure module + `ActivityEntry` fields

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/data/toolDetails.ts`
- Test: `tests/data/toolDetails.test.ts`

This task leaves `activityParser.ts` untouched (it keeps its own `getToolDetail`), so the build stays green; wiring happens in Task 2.

- [ ] **Step 1: Write the failing tests**

Create `tests/data/toolDetails.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildToolDetailBody,
  summarizeToolDetail,
} from "../../src/data/toolDetails.js";

const editHunks = [
  { oldStart: 45, oldLines: 3, newStart: 45, newLines: 3, lines: [" ctx", "-old", "+new"] },
];

describe("summarizeToolDetail", () => {
  it("Edit: basename + line range + change counts", () => {
    expect(
      summarizeToolDetail("Edit", { file_path: "/x/App.tsx" }, { structuredPatch: editHunks }),
    ).toBe("App.tsx L45-47 +1 -1");
  });

  it("Edit: spans multiple hunks and drops a zero count side", () => {
    const hunks = [
      { oldStart: 10, oldLines: 0, newStart: 10, newLines: 2, lines: ["+a", "+b"] },
      { oldStart: 40, oldLines: 0, newStart: 42, newLines: 1, lines: ["+c"] },
    ];
    expect(
      summarizeToolDetail("Edit", { file_path: "/x/a.ts" }, { structuredPatch: hunks }),
    ).toBe("a.ts L10-42 +3");
  });

  it("Edit: no structuredPatch falls back to basename", () => {
    expect(summarizeToolDetail("Edit", { file_path: "/x/a.ts" }, undefined)).toBe("a.ts");
  });

  it("Write: range + added count from structuredPatch", () => {
    const hunks = [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 65, lines: Array(65).fill("+x") }];
    expect(
      summarizeToolDetail("Write", { file_path: "/x/package.json" }, { structuredPatch: hunks }),
    ).toBe("package.json L1-65 +65");
  });

  it("Write: no patch derives range from content line count", () => {
    expect(
      summarizeToolDetail("Write", { file_path: "/x/a.ts", content: "l1\nl2\nl3" }, undefined),
    ).toBe("a.ts L1-3 +3");
  });

  it("Read: range from result.file startLine/numLines", () => {
    expect(
      summarizeToolDetail("Read", { file_path: "/x/a.ts" }, { file: { startLine: 60, numLines: 130 } }),
    ).toBe("a.ts L60-189");
  });

  it("Read: range from input offset/limit when no result", () => {
    expect(
      summarizeToolDetail("Read", { file_path: "/x/a.ts", offset: 60, limit: 130 }, undefined),
    ).toBe("a.ts L60-189");
  });

  it("Read: bare basename when no range info", () => {
    expect(summarizeToolDetail("Read", { file_path: "/x/a.ts" }, undefined)).toBe("a.ts");
  });

  it("TaskUpdate: status change", () => {
    expect(
      summarizeToolDetail("TaskUpdate", { taskId: "1" }, { statusChange: { from: "pending", to: "in_progress" } }),
    ).toBe("#1 pending→in_progress");
  });

  it("TaskUpdate: falls back to updatedFields, then input status", () => {
    expect(
      summarizeToolDetail("TaskUpdate", { taskId: "2" }, { updatedFields: ["subject", "status"] }),
    ).toBe("#2 subject, status");
    expect(summarizeToolDetail("TaskUpdate", { taskId: "3", status: "completed" }, undefined)).toBe(
      "#3 completed",
    );
  });

  it("TaskCreate: subject", () => {
    expect(summarizeToolDetail("TaskCreate", { subject: "Do the thing" }, undefined)).toBe("Do the thing");
  });

  it("other tools fall back to existing detail (command/basename)", () => {
    expect(summarizeToolDetail("Bash", { command: "npm test" }, undefined)).toBe("npm test");
    expect(summarizeToolDetail("Grep", { pattern: "foo" }, undefined)).toBe("foo");
  });
});

describe("buildToolDetailBody", () => {
  it("Edit: reconstructs a unified diff with kind 'diff'", () => {
    const body = buildToolDetailBody("Edit", { file_path: "/x/App.tsx" }, { structuredPatch: editHunks });
    expect(body).toEqual({
      text: "@@ -45,3 +45,3 @@\n ctx\n-old\n+new",
      kind: "diff",
    });
  });

  it("Edit: null when no structuredPatch", () => {
    expect(buildToolDetailBody("Edit", { file_path: "/x/a.ts" }, undefined)).toBeNull();
  });

  it("Write: content body with kind 'code'", () => {
    expect(
      buildToolDetailBody("Write", { file_path: "/x/a.ts", content: "hello\nworld" }, undefined),
    ).toEqual({ text: "hello\nworld", kind: "code" });
  });

  it("Read and Task tools have no body", () => {
    expect(buildToolDetailBody("Read", { file_path: "/x/a.ts", offset: 1, limit: 5 }, undefined)).toBeNull();
    expect(buildToolDetailBody("TaskUpdate", { taskId: "1" }, undefined)).toBeNull();
    expect(buildToolDetailBody("Bash", { command: "ls" }, undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/data/toolDetails.test.ts`
Expected: FAIL — cannot resolve `../../src/data/toolDetails.js`.

- [ ] **Step 3: Add `ActivityEntry` fields**

In `src/types/index.ts`, extend the `ActivityEntry` interface (after `count?: number;`):

```ts
export interface ActivityEntry {
  timestamp: Date;
  type: "tool" | "response" | "user" | "thinking" | "commit";
  icon: string;
  label: string;
  detail: string;
  count?: number;
  detailBody?: string; // full multi-line body for the detail view (diff or file content)
  detailKind?: "diff" | "code"; // how the detail view should color detailBody
}
```

- [ ] **Step 4: Create `src/data/toolDetails.ts`**

```ts
import { basename } from "node:path";

export interface ToolInput {
  command?: string;
  file_path?: string;
  pattern?: string;
  query?: string;
  description?: string;
  offset?: number;
  limit?: number;
  content?: string;
  subject?: string;
  taskId?: string;
  status?: string;
}

interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface ToolUseResult {
  structuredPatch?: PatchHunk[];
  content?: string;
  file?: { startLine?: number; numLines?: number };
  statusChange?: { from?: string; to?: string };
  updatedFields?: string[];
  taskId?: string;
}

function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip terminal color codes
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function getToolDetail(_toolName: string, input?: ToolInput): string {
  if (!input) return "";
  if (input.command) return stripAnsi(input.command);
  if (input.file_path) return basename(input.file_path);
  if (input.pattern) return stripAnsi(input.pattern);
  if (input.query) return stripAnsi(input.query);
  if (input.description) return stripAnsi(input.description);
  return "";
}

function rangeStr(start: number, lines: number): string {
  return `L${start}-${start + Math.max(lines, 1) - 1}`;
}

function patchSpan(hunks: PatchHunk[]): string | null {
  if (hunks.length === 0) return null;
  const start = Math.min(...hunks.map((h) => h.newStart));
  const end = Math.max(
    ...hunks.map((h) => h.newStart + Math.max(h.newLines, 1) - 1),
  );
  return `L${start}-${end}`;
}

function countChanges(hunks: PatchHunk[]): string {
  let add = 0;
  let del = 0;
  for (const h of hunks) {
    for (const line of h.lines ?? []) {
      if (line.startsWith("+")) add++;
      else if (line.startsWith("-")) del++;
    }
  }
  const parts: string[] = [];
  if (add > 0) parts.push(`+${add}`);
  if (del > 0) parts.push(`-${del}`);
  return parts.join(" ");
}

function joinParts(...parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p).join(" ");
}

export function summarizeToolDetail(
  name: string,
  input: ToolInput | undefined,
  result: ToolUseResult | undefined,
): string {
  const file = input?.file_path ? basename(input.file_path) : "";

  if (name === "Edit" || name === "Write") {
    const hunks = result?.structuredPatch;
    if (hunks && hunks.length > 0) {
      return joinParts(file, patchSpan(hunks), countChanges(hunks));
    }
    if (name === "Write") {
      const content = result?.content ?? input?.content;
      if (content) {
        const n = content.split("\n").length;
        return joinParts(file, rangeStr(1, n), `+${n}`);
      }
    }
    return file;
  }

  if (name === "Read") {
    const f = result?.file;
    if (typeof f?.startLine === "number" && typeof f?.numLines === "number") {
      return joinParts(file, rangeStr(f.startLine, f.numLines));
    }
    if (typeof input?.offset === "number" && typeof input?.limit === "number") {
      return joinParts(file, rangeStr(input.offset, input.limit));
    }
    return file;
  }

  if (name === "TaskUpdate") {
    const id = input?.taskId ?? result?.taskId;
    const idStr = id ? `#${id}` : "";
    const sc = result?.statusChange;
    if (sc?.from && sc?.to) return joinParts(idStr, `${sc.from}→${sc.to}`);
    if (result?.updatedFields?.length) {
      return joinParts(idStr, result.updatedFields.join(", "));
    }
    if (input?.status) return joinParts(idStr, input.status);
    return idStr;
  }

  if (name === "TaskCreate") {
    return input?.subject ?? "";
  }

  return getToolDetail(name, input);
}

export function buildToolDetailBody(
  name: string,
  input: ToolInput | undefined,
  result: ToolUseResult | undefined,
): { text: string; kind: "diff" | "code" } | null {
  if (name === "Write") {
    const content = result?.content ?? input?.content;
    if (content) return { text: content, kind: "code" };
  }
  if (name === "Edit" || name === "Write") {
    const hunks = result?.structuredPatch;
    if (hunks && hunks.length > 0) {
      const text = hunks
        .map(
          (h) =>
            `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${(h.lines ?? []).join("\n")}`,
        )
        .join("\n");
      return { text, kind: "diff" };
    }
  }
  return null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/data/toolDetails.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Lint the new/changed files**

Run: `npx biome check src/data/toolDetails.ts src/types/index.ts tests/data/toolDetails.test.ts`
Expected: clean (if it reformats with `--write`, re-stage).

- [ ] **Step 7: Commit**

```bash
git add src/types/index.ts src/data/toolDetails.ts tests/data/toolDetails.test.ts
git commit -m "feat: add toolDetails formatters for rich activity detail (#84)"
```

---

## Task 2: Correlate results and use the formatters in the parser

**Files:**
- Modify: `src/data/activityParser.ts`
- Test: `tests/data/activityParser.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("parseActivitiesFromLines", ...)` block in `tests/data/activityParser.test.ts`:

```ts
  it("enriches an Edit with range/counts and a diff body from a later result", () => {
    const editLines = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tool_1",
              name: "Edit",
              input: { file_path: "/src/App.tsx" },
            },
          ],
        },
        timestamp: "2025-01-15T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tool_1", content: "ok" }],
        },
        toolUseResult: {
          filePath: "/src/App.tsx",
          structuredPatch: [
            { oldStart: 45, oldLines: 3, newStart: 45, newLines: 3, lines: [" ctx", "-old", "+new"] },
          ],
        },
        timestamp: "2025-01-15T10:00:01.000Z",
      }),
    ];
    const result = parseActivitiesFromLines(editLines);
    const edit = result.activities.find((a) => a.label === "Edit");
    expect(edit?.detail).toBe("App.tsx L45-47 +1 -1");
    expect(edit?.detailKind).toBe("diff");
    expect(edit?.detailBody).toContain("@@ -45,3 +45,3 @@");
    expect(edit?.detailBody).toContain("+new");
  });

  it("degrades gracefully when an Edit has no matching result", () => {
    const editLines = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tool_x", name: "Edit", input: { file_path: "/src/App.tsx" } },
          ],
        },
        timestamp: "2025-01-15T10:00:00.000Z",
      }),
    ];
    const result = parseActivitiesFromLines(editLines);
    const edit = result.activities.find((a) => a.label === "Edit");
    expect(edit?.detail).toBe("App.tsx");
    expect(edit?.detailBody).toBeUndefined();
    expect(edit?.detailKind).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/data/activityParser.test.ts`
Expected: FAIL — `detail` is `"App.tsx"` not `"App.tsx L45-47 +1 -1"` and `detailBody` is undefined (parser doesn't correlate yet).

- [ ] **Step 3: Replace the `stripAnsi`/`getToolDetail` definitions and imports**

In `src/data/activityParser.ts`:

3a. Replace the top imports block so `getToolDetail` is re-exported from `toolDetails.ts` and the new helpers + types are imported. The file currently starts:

```ts
import { basename } from "node:path";
import type { ActivityEntry } from "../types/index.js";
import { ICONS } from "../types/index.js";

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
```

Replace those lines (the `node:path` import, the two type imports, and the whole `stripAnsi` function) with:

```ts
import type { ActivityEntry } from "../types/index.js";
import { ICONS } from "../types/index.js";
import type { ToolInput, ToolUseResult } from "./toolDetails.js";
import {
  buildToolDetailBody,
  getToolDetail,
  summarizeToolDetail,
} from "./toolDetails.js";

export { getToolDetail };
```

3b. Delete the entire existing `getToolDetail` function from `activityParser.ts` (the block `export function getToolDetail(...) { ... }` around lines 23-40). It now lives in `toolDetails.ts` and is re-exported above. (`parseModelName` stays.)

Note: `basename` is no longer used in `activityParser.ts` after this — its import was removed in 3a. Confirm no other `basename(` call remains in the file (`grep -n "basename" src/data/activityParser.ts` → none).

- [ ] **Step 4: Add the result pre-pass and use the formatters**

4a. Inside `parseActivitiesFromLines`, immediately after the line `const activities: ActivityEntry[] = [];` and the other accumulator declarations, add the pre-pass:

```ts
  const resultsById = new Map<string, ToolUseResult>();
  for (const line of lines) {
    let entry: {
      type?: string;
      toolUseResult?: unknown;
      message?: { content?: unknown };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "user") continue;
    const tur = entry.toolUseResult;
    if (!tur || typeof tur !== "object") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content as Array<{ type?: string; tool_use_id?: string }>) {
      if (b?.type === "tool_result" && typeof b.tool_use_id === "string") {
        resultsById.set(b.tool_use_id, tur as ToolUseResult);
      }
    }
  }
```

4b. The assistant content block interface needs an `id`. Find `interface JsonlAssistantEntry` and update its `content` block element type to include `id?: string` and to type `input` as `ToolInput`. Change:

```ts
    content: Array<{
      type: string;
      text?: string;
      thinking?: string;
      name?: string;
      input?: {
        command?: string;
        file_path?: string;
        pattern?: string;
        query?: string;
        description?: string;
      };
    }>;
```
to:
```ts
    content: Array<{
      type: string;
      id?: string;
      text?: string;
      thinking?: string;
      name?: string;
      input?: ToolInput;
    }>;
```

4c. Replace the `tool_use` handling. Find:

```ts
          } else if (block.type === "tool_use" && block.name) {
            if (block.name === "TodoWrite") continue;
            const icon =
              (ICONS as Record<string, string>)[block.name] ?? ICONS.Default;
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
              activities.push({
                timestamp,
                type: "tool",
                icon,
                label: block.name,
                detail,
              });
            }
          } else if (
```
with:
```ts
          } else if (block.type === "tool_use" && block.name) {
            if (block.name === "TodoWrite") continue;
            const icon =
              (ICONS as Record<string, string>)[block.name] ?? ICONS.Default;
            const result = block.id ? resultsById.get(block.id) : undefined;
            const detail = summarizeToolDetail(block.name, block.input, result);
            const body = buildToolDetailBody(block.name, block.input, result);
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
              const entry: ActivityEntry = {
                timestamp,
                type: "tool",
                icon,
                label: block.name,
                detail,
              };
              if (body) {
                entry.detailBody = body.text;
                entry.detailKind = body.kind;
              }
              activities.push(entry);
            }
          } else if (
```

- [ ] **Step 5: Run the parser tests to verify they pass**

Run: `npx vitest run tests/data/activityParser.test.ts`
Expected: PASS — existing tests (incl. the `getToolDetail` describe, still importing from `activityParser.js` via the re-export) plus the 2 new ones.

- [ ] **Step 6: Full suite + type-check + lint**

Run: `npx vitest run && npx tsc --noEmit && npx biome check src/data/activityParser.ts`
Expected: all tests pass; no type errors; Biome clean on the file.

- [ ] **Step 7: Commit**

```bash
git add src/data/activityParser.ts tests/data/activityParser.test.ts
git commit -m "feat: correlate tool results to enrich activity detail (#84)"
```

---

## Task 3: Render `detailBody` in the detail view

**Files:**
- Modify: `src/ui/DetailViewPanel.tsx`
- Test: `tests/ui/DetailViewPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("DetailViewPanel", ...)` block in `tests/ui/DetailViewPanel.test.tsx`:

```ts
  it("renders an Edit diff body with diff coloring", () => {
    const { lastFrame } = render(
      <DetailViewPanel
        activity={makeActivity({
          type: "tool",
          icon: "~",
          label: "Edit",
          detail: "App.tsx L45-47 +1 -1",
          detailBody: "@@ -45,3 +45,3 @@\n ctx\n-old line\n+new line",
          detailKind: "diff",
        })}
        sessionName="myproject"
        width={80}
        visibleRows={10}
        scrollOffset={0}
      />,
    );
    const frame = lastFrame() ?? "";
    // detailBody is shown (not the short row detail)
    expect(frame).toContain("+new line");
    expect(frame).toContain("@@ -45,3 +45,3 @@");
    // diff-add lines are colored green (ANSI)
    expect(frame).toContain("[32m");
  });

  it("renders a Write content body as code", () => {
    const { lastFrame } = render(
      <DetailViewPanel
        activity={makeActivity({
          type: "tool",
          icon: "~",
          label: "Write",
          detail: "a.ts L1-2 +2",
          detailBody: "const a = 1;\nconst b = 2;",
          detailKind: "code",
        })}
        sessionName="myproject"
        width={80}
        visibleRows={10}
        scrollOffset={0}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("const a = 1;");
    expect(frame).toContain("const b = 2;");
  });

  it("falls back to detail when there is no detailBody", () => {
    const { lastFrame } = render(
      <DetailViewPanel
        activity={makeActivity({ detail: "plain detail text", detailBody: undefined })}
        sessionName="myproject"
        width={80}
        visibleRows={10}
        scrollOffset={0}
      />,
    );
    expect(lastFrame()).toContain("plain detail text");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ui/DetailViewPanel.test.tsx`
Expected: FAIL — the Edit test does not find `+new line`/`@@` (the panel renders `activity.detail`, which is the short summary, and ignores `detailBody`).

- [ ] **Step 3: Use `detailBody`/`detailKind` in `DetailViewPanel`**

In `src/ui/DetailViewPanel.tsx`, find the two lines that pick the classifier and build the lines (currently):

```ts
  const classifier =
    activity.type === "commit" ? classifyDiffLines : classifyCodeFences;
  const allLines = wrapClassified(activity.detail, contentWidth, classifier);
```

Replace them with:

```ts
  const body = activity.detailBody ?? activity.detail;
  const classifier =
    activity.detailKind === "diff"
      ? classifyDiffLines
      : activity.detailKind === "code"
        ? classifyCodeFences
        : activity.type === "commit"
          ? classifyDiffLines
          : classifyCodeFences;
  const allLines = wrapClassified(body, contentWidth, classifier);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/ui/DetailViewPanel.test.tsx`
Expected: PASS — new body-rendering tests pass; existing tests (no `detailBody` → fall back to `detail`) still pass.

- [ ] **Step 5: Full suite + type-check + lint**

Run: `npx vitest run && npx tsc --noEmit && npx biome check src/ui/DetailViewPanel.tsx tests/ui/DetailViewPanel.test.tsx`
Expected: all tests pass; no type errors; Biome clean on the changed files.

- [ ] **Step 6: Commit**

```bash
git add src/ui/DetailViewPanel.tsx tests/ui/DetailViewPanel.test.tsx
git commit -m "feat: render Edit diff / Write content in the detail view (#84)"
```

---

## Self-Review

**1. Spec coverage:**
- `ActivityEntry` `detailBody`/`detailKind` → Task 1 Step 3.
- `toolDetails.ts` with `summarizeToolDetail` + `buildToolDetailBody` (Edit/Write/Read/TaskUpdate/TaskCreate + fallback) → Task 1.
- Row formats (Edit `L45-52 +3 -1`, Write `L1-N +N`, Read range, TaskUpdate `from→to`, TaskCreate subject) → Task 1 tests + impl.
- Parser `tool_use_id → toolUseResult` pre-pass + capture `block.id` + use formatters → Task 2.
- `getToolDetail` relocation with re-export (keeps existing test import working) → Task 2 Step 3.
- Detail view body + `detailKind` coloring reusing `classifyDiffLines`/`classifyCodeFences` → Task 3.
- Graceful degradation when no result → Task 2 test (Step 1, second case).
- Out-of-scope (MultiEdit, Read body, Bash output) → no tasks, intended.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step has complete code and exact commands. ✅

**3. Type consistency:** `ToolInput`/`ToolUseResult` defined in Task 1 (`toolDetails.ts`), imported in Task 2 (`activityParser.ts`). `summarizeToolDetail(name, input, result)` and `buildToolDetailBody(name, input, result)` signatures identical across Task 1 (definition), Task 1 tests, and Task 2 (call sites). `detailBody`/`detailKind` field names identical across Task 1 (type), Task 2 (parser sets them), Task 3 (panel reads them). `buildToolDetailBody` returns `{ text, kind }`; Task 2 maps to `entry.detailBody = body.text` / `entry.detailKind = body.kind`. ✅

---

## Execution Handoff

(Filled in by the writing-plans skill after save.)
