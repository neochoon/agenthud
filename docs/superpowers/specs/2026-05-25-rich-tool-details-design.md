# Rich Tool Activity Details Design

## Goal

Make tool activities in the viewer informative instead of bare. Today `TaskUpdate` shows just `TaskUpdate` and `Edit` shows only the filename, because `getToolDetail` (in `activityParser.ts`) reads only a few input fields (`command`/`file_path`/`pattern`/`query`/`description`) and the parser never looks at the tool's *result*.

This feature:
1. Enriches each activity's **row summary** (`detail`) with what actually happened — line range + change counts for edits, status change for task updates, subject for task creates, read range for reads.
2. Adds a **rich detail view body** for edits (a colored unified diff) and writes (the written content), shown when the row is opened with `↵`.

The enabling capability is correlating each `tool_use` with its `toolUseResult` (which arrives in a *later* JSONL entry), keyed by `tool_use_id`.

## Data shapes (verified against real JSONL)

| tool | tool_use `input` | following `toolUseResult` |
|------|------------------|---------------------------|
| Edit | `{ file_path, old_string, new_string, replace_all }` | `{ filePath, structuredPatch:[{oldStart,oldLines,newStart,newLines,lines[]}], ... }` |
| Write | `{ file_path, content }` | `{ filePath, content, structuredPatch, ... }` |
| Read | `{ file_path, offset?, limit? }` | `{ file:{ filePath, content, numLines, startLine, totalLines } }` |
| TaskUpdate | `{ taskId, status?, ... }` | `{ success, taskId, updatedFields[], statusChange?:{from,to} }` |
| TaskCreate | `{ subject, description, activeForm }` | `{ task:{ id, subject } }` |

`structuredPatch[].lines` entries are already unified-diff strings (` context`, `-removed`, `+added`).

## State / Data model (`src/types/index.ts`)

Add two optional fields to `ActivityEntry`:

```ts
detailBody?: string;            // full multi-line body for the detail view (diff or file content)
detailKind?: "diff" | "code";   // how the detail view should color detailBody
```

`detail` (the one-line row summary) stays a `string` and just carries richer text. `type` is unchanged (`Edit`/`Write`/`Read` stay `type: "tool"`). The fields are optional because only Edit (`diff`) and Write (`code`) set `detailBody`; every other activity is unaffected and the detail view shows `detail` exactly as today.

## New module `src/data/toolDetails.ts` (pure)

Two pure functions, one responsibility each — per-tool formatting, independently testable:

```ts
export function summarizeToolDetail(
  name: string,
  input: ToolInput | undefined,
  result: ToolUseResult | undefined,
): string;

export function buildToolDetailBody(
  name: string,
  input: ToolInput | undefined,
  result: ToolUseResult | undefined,
): { text: string; kind: "diff" | "code" } | null;
```

The current `getToolDetail` fallback logic (command → file_path basename → pattern → query → description) moves here as the default branch of `summarizeToolDetail`.

### Row summary (`summarizeToolDetail`)

| tool | row `detail` | source |
|------|--------------|--------|
| Edit | `App.tsx L45-52 +3 -1` | range = `L<minNewStart>-<maxNewEnd>` across hunks; counts = `+`/`-` lines in `structuredPatch[].lines`. Omit a zero side (`+3` if no removals). No `structuredPatch` → `App.tsx` (fallback). |
| Write | `package.json L1-65 +65` | range `L1-<numLines>` (line count of `content`); counts from `structuredPatch` if present, else `+<numLines>`. |
| Read | `App.tsx L60-189` | range from `result.file.startLine`/`numLines` when present, else `input.offset`/`limit`; no offset/limit and no result range → `App.tsx`. No counts. |
| TaskUpdate | `#1 pending→in_progress` | `result.statusChange.{from,to}`; no statusChange → `#1 <updatedFields joined>`; no result → `#1 <input.status>`. |
| TaskCreate | `Explore project context…` | `input.subject` (truncation handled by the row renderer). |
| others | unchanged | existing `getToolDetail` order. |

Format details: counts rendered as `+A -D`, dropping `-D` when `D===0` and `+A` when `A===0`. Change counts count `structuredPatch[].lines` entries by first char (`+` add, `-` remove; ` ` context ignored).

### Detail-view body (`buildToolDetailBody`)

| tool | body | kind |
|------|------|------|
| Edit | unified diff reconstructed per hunk: `@@ -<oldStart>,<oldLines> +<newStart>,<newLines> @@` followed by `hunk.lines.join("\n")`, hunks separated by newline. No `structuredPatch` → `null`. | `diff` |
| Write | `result.content ?? input.content`. No content → `null`. | `code` |
| Read / TaskUpdate / TaskCreate / others | `null` | — |

## Parser (`src/data/activityParser.ts`)

`parseActivitiesFromLines(lines)` gains a correlation step:

1. **Pre-pass:** scan `lines` once for `user` entries; for each `tool_result` block in `message.content`, map `tool_use_id → entry.toolUseResult`. Build `resultsById: Map<string, ToolUseResult>`.
2. **Main pass (existing loop):** for each `tool_use` block, capture `block.id`, look up `resultsById.get(id)`, and set:
   - `detail = summarizeToolDetail(name, input, result)`
   - `const body = buildToolDetailBody(name, input, result)` → if non-null, set `detailBody = body.text`, `detailKind = body.kind`.
   - Replaces the current `getToolDetail(...)` call.

The dedup that merges consecutive identical tool activities (`last.label === name && last.detail === detail`) is unchanged but now keys on the richer `detail`, so two edits to the same file at different ranges no longer collapse into one (an incidental improvement). When a merge does occur, the kept entry retains its `detailBody`.

Side effect (intended, positive): `reportGenerator` consumes the same activities, so `agenthud report` output gets the same richer one-line detail for free. The detail-view body is viewer-only.

## Detail view (`src/ui/DetailViewPanel.tsx`)

```ts
const body = activity.detailBody ?? activity.detail;
const classifier =
  activity.detailKind === "diff" ? classifyDiffLines :
  activity.detailKind === "code" ? classifyCodeFences :
  (activity.type === "commit" ? classifyDiffLines : classifyCodeFences);
const allLines = wrapClassified(body, contentWidth, classifier);
```

Opening an Edit row renders the same green/red/cyan diff coloring already used for git commits (`classifyDiffLines` + `getLineStyle` in `lineColoring.ts`) — no new coloring code. Write renders as code (cyan via `classifyCodeFences`). Everything without `detailBody` behaves exactly as today.

## Testing (TDD)

1. **`tests/data/toolDetails.test.ts`** — `summarizeToolDetail` and `buildToolDetailBody` per tool:
   - Edit: single hunk → `App.tsx L45-52 +3 -1`; multi-hunk span; removals-only / additions-only count formatting; no `structuredPatch` → bare basename + `null` body; diff body header + lines reconstruction.
   - Write: `L1-N +N`; body = content/`code`.
   - Read: range from result; range from input offset/limit; no range → basename; body `null`.
   - TaskUpdate: statusChange → `#1 from→to`; no statusChange → updatedFields; no result → input status.
   - TaskCreate: subject.
   - other tool (Bash/Glob) → unchanged fallback string, body `null`.
2. **`tests/data/activityParser.test.ts`** (extend) — correlation: a tool_use followed by a later `user` entry carrying `toolUseResult` produces an Edit activity with the diff `detailBody`/`detailKind`; missing result degrades gracefully (basename detail, no body).
3. **`tests/ui/DetailViewPanel.test.tsx`** (extend) — an Edit activity with a `diff` `detailBody` renders added lines green / removed red / `@@` cyan; a Write activity with `code` body renders cyan; an activity with no `detailBody` still renders `detail` as before.

Write tests first, confirm they fail for the right reason, then implement.

## Out of Scope (follow-ups)

- **MultiEdit** (not present in this project's logs) — `summarizeToolDetail`/`buildToolDetailBody` fall through to the default branch; can be added later.
- **Read detail-view body** (showing the read content) — Read gets a row range only this pass.
- **Bash output** in the detail view (from `toolUseResult`) — separate concern.
- Change-count display style alternatives (e.g. `+3/-1`) — using `+3 -1`.
