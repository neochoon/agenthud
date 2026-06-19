# Parser Version-Drift Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture each provider's already-emitted version onto `SessionNode`, add a semver compare util, and pin current parser shapes with a synthetic fixture corpus — the structure that makes a future format change cheap to handle, with no speculative branches.

**Architecture:** A new `SessionNode.version?: string` holds an **opaque, provider-defined** version string. Each provider fills it inside its existing `discoverSessions` work from its own source (claude per-line `version`, codex `session_meta.cli_version`, kiro envelope `version`, opencode `migration` latest id, kiro-ide best-effort). A new `src/data/version.ts` gives `compareVersions`/`versionGte` for the semver providers only. A per-provider synthetic fixture corpus + regression test locks the current shapes.

**Tech Stack:** TypeScript (ESM), Vitest, Biome. Node `node:sqlite` (opencode, Node 22+).

## Global Constraints

- All source, comments, commits in English.
- TDD: write the failing test, see it fail for the right reason, implement, see the related suite pass.
- Before every commit: `npx vitest run` (full suite green), `npx tsc --noEmit` clean, `npx biome check` clean (run `npx biome check --write` first).
- `SessionNode.version` is an **opaque provider-defined string** — never assume semver in shared code. `compareVersions`/`versionGte` are provided for semver providers, not mandatory.
- Capture is defensive: a missing/garbage version source yields `undefined`/`null`, never a throw.
- No new parse branches and no `toolDetails` `version?` parameter — those are out of scope (first-drift work).
- Fixtures are **synthetic** (hand-authored), never dumps of real user sessions.

---

### Task 1: `version.ts` compare util + `SessionNode.version` field

**Files:**
- Create: `src/data/version.ts`
- Modify: `src/types/index.ts` (add `version?` to `SessionNode`, after the `provider?` field ~line 38)
- Test: `tests/data/version.test.ts`

**Interfaces:**
- Produces: `compareVersions(a?: string, b?: string): -1 | 0 | 1`, `versionGte(a?: string, b?: string): boolean`, and the optional `SessionNode.version?: string`. Tasks 2–6 set `version`; Task 7 asserts it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/data/version.test.ts
import { describe, expect, it } from "vitest";
import { compareVersions, versionGte } from "../../src/data/version.js";

describe("compareVersions", () => {
  it("equal versions compare 0", () => {
    expect(compareVersions("2.1.148", "2.1.148")).toBe(0);
  });
  it("compares numerically, not lexically (2.9 < 2.10)", () => {
    expect(compareVersions("2.9", "2.10")).toBe(-1);
    expect(compareVersions("2.10", "2.9")).toBe(1);
  });
  it("a shorter prefix is less than its extension (2.1 < 2.1.1)", () => {
    expect(compareVersions("2.1", "2.1.1")).toBe(-1);
  });
  it("undefined / empty sorts as the lowest", () => {
    expect(compareVersions(undefined, "2.1")).toBe(-1);
    expect(compareVersions("2.1", undefined)).toBe(1);
    expect(compareVersions(undefined, undefined)).toBe(0);
    expect(compareVersions("", "0")).toBe(0);
  });
  it("non-numeric segments count as 0 (never throws)", () => {
    expect(compareVersions("vx", "2")).toBe(-1);
    expect(compareVersions("1.x", "1.0")).toBe(0);
  });
});

describe("versionGte", () => {
  it("true when equal or greater, false when less", () => {
    expect(versionGte("2.2.0", "2.2.0")).toBe(true);
    expect(versionGte("2.3.0", "2.2.0")).toBe(true);
    expect(versionGte("2.1.0", "2.2.0")).toBe(false);
    expect(versionGte(undefined, "2.2.0")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data/version.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/data/version.js"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/data/version.ts
/**
 * Compare provider CLI versions that use a dotted semver-ish scheme
 * (claude `2.1.148`, codex `0.139.0`). Not every provider uses this:
 * kiro is a `v1` schema tag, opencode is a migration id — they compare
 * their own way. So this is a helper for the semver providers, not a
 * mandated interface. `SessionNode.version` stays an opaque string.
 */
export function compareVersions(a?: string, b?: string): -1 | 0 | 1 {
  const pa = segments(a);
  const pb = segments(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** `a >= b` under {@link compareVersions}. Reads as `versionGte(v, "2.2.0")`. */
export function versionGte(a?: string, b?: string): boolean {
  return compareVersions(a, b) >= 0;
}

// "2.1.148" -> [2,1,148]. Missing/empty/non-numeric segments become 0
// so an unknown version sorts lowest and never takes a newer-version branch.
function segments(v?: string): number[] {
  if (!v) return [];
  return v.split(".").map((s) => {
    const n = Number.parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}
```

- [ ] **Step 4: Add the model field**

In `src/types/index.ts`, in `interface SessionNode`, immediately after the `provider?: ...;` line, add:

```ts
  /**
   * Origin CLI/schema version of this session, captured per provider:
   * claude per-line `version` (`2.1.148`), codex `session_meta.cli_version`
   * (`0.139.0`), kiro envelope `version` (`v1`), opencode latest `migration`
   * id, kiro-ide best-effort. An OPAQUE, provider-defined string — do not
   * assume semver in shared code (see src/data/version.ts). Undefined when
   * the source is absent. The seam for version-gated parsing of format drift.
   */
  version?: string;
```

- [ ] **Step 5: Run tests + typecheck to verify pass**

Run: `npx vitest run tests/data/version.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
npx biome check --write src/data/version.ts tests/data/version.test.ts src/types/index.ts
git add src/data/version.ts tests/data/version.test.ts src/types/index.ts
git commit -m "feat(version): compareVersions util + SessionNode.version field

Shared infra for the parser version-drift seam: an opaque provider-defined
version string on SessionNode plus a semver compare helper for the semver
providers (claude/codex). Refs #187"
```

---

### Task 2: Claude version capture

Claude writes a `version` field on every message entry (`2.1.148`). Capture the most recent one during the existing tail scan and stamp it on the node.

**Files:**
- Modify: `src/data/providers/claude.ts` — `computeSessionTail` (~line 315) and its return type; the two node-build sites (~528–550, ~676–695)
- Test: `tests/data/providers/claude-version.test.ts`

**Interfaces:**
- Consumes: `SessionNode.version` (Task 1).
- Produces: a pure exported helper `readClaudeVersion(tailLines: string[]): string | undefined` for direct unit testing (no claude provider test harness exists today).

- [ ] **Step 1: Write the failing test**

```ts
// tests/data/providers/claude-version.test.ts
import { describe, expect, it } from "vitest";
import { readClaudeVersion } from "../../../src/data/providers/claude.js";

describe("readClaudeVersion", () => {
  it("returns the version of the most recent entry that carries one", () => {
    const lines = [
      JSON.stringify({ type: "user", version: "2.1.100" }),
      JSON.stringify({ type: "assistant", version: "2.1.148", message: {} }),
    ];
    expect(readClaudeVersion(lines)).toBe("2.1.148");
  });
  it("skips entries without a version and falls back to an earlier one", () => {
    const lines = [
      JSON.stringify({ type: "user", version: "2.1.100" }),
      JSON.stringify({ type: "summary" }), // no version
    ];
    expect(readClaudeVersion(lines)).toBe("2.1.100");
  });
  it("returns undefined when no entry has a version", () => {
    expect(readClaudeVersion([JSON.stringify({ type: "summary" })])).toBeUndefined();
    expect(readClaudeVersion(["not json"])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data/providers/claude-version.test.ts`
Expected: FAIL — `readClaudeVersion` is not exported.

- [ ] **Step 3: Add the pure helper in `src/data/providers/claude.ts`**

Add near the other exported parse helpers (e.g. just below the imports / above `computeSessionTail`):

```ts
/**
 * The session's representative version = the version of the LAST tail
 * entry that carries one. Claude stamps `version` on every message
 * entry; a long session that spanned a CLI upgrade reports its latest.
 * Returns undefined when no entry has a version. Pure — unit-tested.
 */
export function readClaudeVersion(tailLines: string[]): string | undefined {
  let version: string | undefined;
  for (const line of tailLines) {
    try {
      const entry = JSON.parse(line);
      if (typeof entry.version === "string") version = entry.version;
    } catch {
      // skip non-JSON lines
    }
  }
  return version;
}
```

- [ ] **Step 4: Thread it through `computeSessionTail`**

In `computeSessionTail` (`src/data/providers/claude.ts` ~315), add `version` to the return. The function already builds `const tail = content.trim().split("\n").filter(Boolean).slice(-50);`.

Add to the return type in BOTH `readSessionTail` (~305) and `computeSessionTail` (~322):

```ts
  version: string | undefined;
```

Change the two early `return { modelName: null, liveState: null, contextUsage: null };` lines (in `computeSessionTail`) to:

```ts
    return { modelName: null, liveState: null, contextUsage: null, version: undefined };
```

Change the success return (~372) to include the captured version:

```ts
    return {
      modelName,
      liveState: detectLiveState(tail, mtimeMs, now, isSubAgent),
      contextUsage,
      version: readClaudeVersion(tail),
    };
```

- [ ] **Step 5: Stamp it on the node at both build sites**

At ~528 and ~676 the code destructures `const { modelName, liveState, contextUsage } = readSessionTail(...)`. Add `version` to each destructure:

```ts
          const { modelName, liveState, contextUsage, version } = readSessionTail(
```

and in each `SessionNode` object literal that follows (alongside `contextUsage: contextUsage ?? undefined,`) add:

```ts
            version,
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/data/providers/claude-version.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
npx biome check --write src/data/providers/claude.ts tests/data/providers/claude-version.test.ts
git add src/data/providers/claude.ts tests/data/providers/claude-version.test.ts
git commit -m "feat(claude): capture per-session version from tail entries

Refs #187"
```

---

### Task 3: Codex version capture

Codex emits `cli_version` once in the `session_meta` payload (`0.139.0`). The meta parser already reads that payload.

**Files:**
- Modify: `src/data/providers/codex.ts` — the `session_meta` branch (~166), the `CodexMeta` type + `value = {...}` assembly (~196), and the node build (~256)
- Test: `tests/data/providers/codex.test.ts` (extend; harness already has `metaLine({ cli_version })`)

**Interfaces:**
- Consumes: `SessionNode.version`.
- Produces: `CodexMeta.version?: string` populated from `payload.cli_version`.

- [ ] **Step 1: Write the failing test**

Add to `tests/data/providers/codex.test.ts` (uses the file's existing `setRoot`/fs-mock/`rollout`/`metaLine` harness — read the top of the file first):

```ts
it("captures cli_version onto SessionNode.version", () => {
  setRoot();
  // (mirror the file's existing mock setup for a single rollout file —
  //  readdirSync → one dated dir → one rollout, statSync mtime, etc.)
  const node = firstSession(); // the file's existing helper that runs
                               // codexProvider.discoverSessions and returns
                               // the first session node
  expect(node.version).toBe("0.121.0"); // metaLine() default cli_version
});
```

If the file lacks a `firstSession()` helper, assert against `codexProvider.discoverSessions(mockConfig, NOW)` the same way the neighbouring tests do, reading `.projects[0].sessions[0].version`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data/providers/codex.test.ts -t "cli_version"`
Expected: FAIL — `node.version` is `undefined`.

- [ ] **Step 3: Capture `cli_version` in the meta parser**

In `src/data/providers/codex.ts`, add a field to the `CodexMeta` type/interface:

```ts
  version?: string;
```

In the meta parse loop, declare alongside the other locals (~148):

```ts
    let cliVersion: string | null = null;
```

In the `rec.type === "session_meta"` branch (~166), add:

```ts
        cliVersion = typeof p.cli_version === "string" ? p.cli_version : null;
```

In the `value = { ... }` assembly (~196), add:

```ts
        version: cliVersion ?? undefined,
```

- [ ] **Step 4: Stamp the node**

In the node build object literal (~256, next to `provider: "codex",`):

```ts
    version: meta.version,
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/data/providers/codex.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
npx biome check --write src/data/providers/codex.ts tests/data/providers/codex.test.ts
git add src/data/providers/codex.ts tests/data/providers/codex.test.ts
git commit -m "feat(codex): capture cli_version onto SessionNode.version

Refs #187"
```

---

### Task 4: Kiro version capture

Kiro CLI wraps each line in an envelope `{version, kind, data}` where `version` is a schema tag (`v1`). Capture the first envelope's version.

**Files:**
- Modify: `src/data/providers/kiro.ts` — the raw line-parse that builds the `raw` object, and the node build (~259–273)
- Test: `tests/data/providers/kiro.test.ts` (extend; uses its own harness)

**Interfaces:**
- Consumes: `SessionNode.version`.
- Produces: a pure exported helper `readKiroEnvelopeVersion(lines: string[]): string | undefined`.

- [ ] **Step 1: Write the failing test**

Add to `tests/data/providers/kiro.test.ts`:

```ts
import { readKiroEnvelopeVersion } from "../../../src/data/providers/kiro.js";

describe("readKiroEnvelopeVersion", () => {
  it("returns the first envelope's version tag", () => {
    const lines = [
      JSON.stringify({ version: "v1", kind: "Prompt", data: {} }),
      JSON.stringify({ version: "v1", kind: "AssistantMessage", data: {} }),
    ];
    expect(readKiroEnvelopeVersion(lines)).toBe("v1");
  });
  it("returns undefined when no line carries a version", () => {
    expect(readKiroEnvelopeVersion([JSON.stringify({ kind: "Prompt" })])).toBeUndefined();
    expect(readKiroEnvelopeVersion(["nope"])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data/providers/kiro.test.ts -t "readKiroEnvelopeVersion"`
Expected: FAIL — not exported.

- [ ] **Step 3: Add the pure helper in `src/data/providers/kiro.ts`**

```ts
/**
 * Kiro CLI wraps each JSONL line in `{version, kind, data}`. `version`
 * is a schema tag (`v1`), not semver. Returns the first envelope's tag,
 * or undefined if none parse. Pure — unit-tested.
 */
export function readKiroEnvelopeVersion(lines: string[]): string | undefined {
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const env = JSON.parse(line);
      if (typeof env.version === "string") return env.version;
    } catch {
      // skip
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Wire it into discovery**

In `src/data/providers/kiro.ts`, where the session's `.jsonl` content is read during discovery (the raw-parse that produces `raw`), capture the version. If the raw parse already splits the file into `lines`, reuse them; otherwise read the jsonl text and split. Set on the `raw` object a `version` field, then in the node literal (~272, next to `provider: "kiro",`):

```ts
    version: raw.version,
```

If `raw` is a typed local, add `version?: string` to that type and assign `version: readKiroEnvelopeVersion(lines)` where `raw` is built. (The kiro `.jsonl` is read in the same function — locate the `readFileSync(jsonlPath...)` / split and pass those lines.)

- [ ] **Step 5: Add the wiring test**

Add to `tests/data/providers/kiro.test.ts`, following the file's existing discovery harness, a session whose jsonl lines carry `version: "v1"`, and assert the resulting node's `.version === "v1"`.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run tests/data/providers/kiro.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
npx biome check --write src/data/providers/kiro.ts tests/data/providers/kiro.test.ts
git add src/data/providers/kiro.ts tests/data/providers/kiro.test.ts
git commit -m "feat(kiro): capture envelope schema version onto SessionNode.version

Refs #187"
```

---

### Task 5: OpenCode version capture

OpenCode is a SQLite DB. Its schema version = the latest applied row in the `migration` table (id like `20260605042240_add_context_epoch_agent`, lexically ordered by the timestamp prefix). It is DB-wide — read once, stamp every opencode session.

**Files:**
- Modify: `src/data/providers/opencode.ts` — add a `readSchemaVersion(db)` query, call once in discovery, stamp the node (~205)
- Test: `tests/data/providers/opencode.test.ts` (extend; add a `migration` row to the test DB)

**Interfaces:**
- Consumes: `SessionNode.version`.
- Produces: `node.version` set to the latest migration id (or undefined if the table is empty/absent).

- [ ] **Step 1: Write the failing test**

Add to `tests/data/providers/opencode.test.ts`, following its existing DB-setup harness. In the schema-creation step add the migration table + a row:

```ts
db.exec("CREATE TABLE migration (id TEXT, time_completed INTEGER)");
db.exec(
  "INSERT INTO migration (id, time_completed) VALUES " +
  "('20260101000000_init', 1), ('20260605042240_add_context_epoch_agent', 2)",
);
```

Then assert:

```ts
it("stamps the latest migration id as the session version", () => {
  const node = firstSession(); // the file's existing discovery helper
  expect(node.version).toBe("20260605042240_add_context_epoch_agent");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data/providers/opencode.test.ts -t "migration"`
Expected: FAIL — `node.version` is `undefined`.

- [ ] **Step 3: Add the query + wire it**

In `src/data/providers/opencode.ts`, add a helper near the other DB queries:

```ts
/**
 * OpenCode's schema version = the latest applied migration id (the ids
 * are timestamp-prefixed, so the lexical max is the newest). DB-wide;
 * read once per discovery. Undefined when the table is absent/empty.
 */
function readSchemaVersion(db: DatabaseSync): string | undefined {
  try {
    const row = db
      .prepare("SELECT id FROM migration ORDER BY id DESC LIMIT 1")
      .get() as { id?: string } | undefined;
    return typeof row?.id === "string" ? row.id : undefined;
  } catch {
    return undefined; // table may not exist on older installs
  }
}
```

(Use the same `DatabaseSync` type/handle the file already opens. If the file names its handle differently, match it.)

In `discoverSessions`, after the DB is opened and before building nodes, call it once:

```ts
  const schemaVersion = readSchemaVersion(db);
```

In the node build literal (~205, next to `provider: "opencode",`):

```ts
    version: schemaVersion,
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/data/providers/opencode.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
npx biome check --write src/data/providers/opencode.ts tests/data/providers/opencode.test.ts
git add src/data/providers/opencode.ts tests/data/providers/opencode.test.ts
git commit -m "feat(opencode): capture latest migration id as SessionNode.version

Refs #187"
```

---

### Task 6: Kiro-IDE version capture (best-effort)

Kiro IDE stores a session as one JSON document. No version field was observed on the test host, so this is best-effort: read a `version`/`schemaVersion` field if present, else leave `undefined`. Wiring the seam matters even when the source is currently absent.

**Files:**
- Modify: `src/data/providers/kiro-ide.ts` — the parsed-file type (~121) and node build (~183)
- Test: `tests/data/providers/kiroIde.test.ts` (extend)

**Interfaces:**
- Consumes: `SessionNode.version`.
- Produces: `node.version` from `file.version` when present, else undefined.

- [ ] **Step 1: Write the failing test**

Add to `tests/data/providers/kiroIde.test.ts`, following its harness. One session whose JSON doc includes `version: "ide-3"`, plus one without:

```ts
it("captures a version field from the session JSON when present", () => {
  const node = sessionFrom({ version: "ide-3" /* + the harness's required fields */ });
  expect(node.version).toBe("ide-3");
});
it("leaves version undefined when the JSON has no version field", () => {
  const node = sessionFrom({ /* no version */ });
  expect(node.version).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data/providers/kiroIde.test.ts -t "version"`
Expected: FAIL — `node.version` undefined in the present-field case.

- [ ] **Step 3: Read the field**

In `src/data/providers/kiro-ide.ts`, add to the parsed-file type/interface (the `KiroIdeFile`-style shape, ~121):

```ts
  version?: string;
```

In the node build (~183, next to `provider: "kiro-ide",`):

```ts
    version: typeof file?.version === "string" ? file.version : undefined,
```

- [ ] **Step 4: Document the gap**

In the file header comment, add a Gotcha bullet:

```
 * - `version` is best-effort: no version/schema field was observed in
 *   Kiro IDE session JSON on the dev host, so SessionNode.version is
 *   usually undefined for this provider. The read is wired so it lights
 *   up automatically if a future Kiro IDE build adds the field.
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/data/providers/kiroIde.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
npx biome check --write src/data/providers/kiro-ide.ts tests/data/providers/kiroIde.test.ts
git add src/data/providers/kiro-ide.ts tests/data/providers/kiroIde.test.ts
git commit -m "feat(kiro-ide): best-effort version capture onto SessionNode.version

Refs #187"
```

---

### Task 7: Per-provider fixture regression corpus

Synthetic fixtures that mirror each provider's catalogued shapes, fed through the real activity parser, with the resulting `ActivityEntry[]` asserted — pinning current shapes so a later parser change or an encoded format change turns a test red instead of silently blanking.

**Files:**
- Create: `tests/fixtures/parser/claude/v2.1.jsonl`, `tests/fixtures/parser/codex/v0.139.jsonl`, `tests/fixtures/parser/kiro/v1.jsonl`, `tests/fixtures/parser/opencode/parts.json`
- Create: `tests/data/parserCorpus.test.ts`

**Interfaces:**
- Consumes: `parseActivitiesFromLines` (claude-activity.ts:99), `parseCodexActivities` (codex.ts:429), `parseKiroActivitiesFromLines` (kiro-activity.ts:94), `parseActivities` (opencode.ts:379). Each returns `ParseResult` with an `.activities: ActivityEntry[]`.

- [ ] **Step 1: Create the Claude fixture**

`tests/fixtures/parser/claude/v2.1.jsonl` — one assistant entry with a tool_use Edit, one user entry with its tool_result, one assistant text response. Each line tagged `"version":"2.1.148"`. Example (single line per JSONL row; expand the tool shapes to match what `parseActivitiesFromLines` expects, mirroring real entries):

```
{"type":"assistant","version":"2.1.148","timestamp":"2026-06-19T00:00:00Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Edit","input":{"file_path":"/x/a.ts"}}]}}
{"type":"user","version":"2.1.148","timestamp":"2026-06-19T00:00:01Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1"}]},"toolUseResult":{"structuredPatch":[{"oldStart":1,"oldLines":1,"newStart":1,"newLines":1,"lines":["-a","+b"]}]}}
{"type":"assistant","version":"2.1.148","timestamp":"2026-06-19T00:00:02Z","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}
```

- [ ] **Step 2: Write the failing Claude corpus test**

```ts
// tests/data/parserCorpus.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseActivitiesFromLines } from "../../src/data/providers/claude-activity.js";

const FIX = join(__dirname, "..", "fixtures", "parser");
const lines = (rel: string) =>
  readFileSync(join(FIX, rel), "utf8").split("\n").filter(Boolean);

describe("parser corpus: claude v2.1", () => {
  it("parses the known shapes into stable activity labels/details", () => {
    const { activities } = parseActivitiesFromLines(lines("claude/v2.1.jsonl"));
    const summary = activities.map((a) => `${a.label}:${a.detail}`);
    expect(summary).toEqual([
      "Edit:a.ts L1-1 +1 -1",
      "Response:done",
    ]);
  });
});
```

(Adjust the expected `summary` to the parser's actual output by running it once; the point is to LOCK whatever the current correct output is. Replace any guessed label like `Response` with the real one the parser emits.)

- [ ] **Step 3: Run, capture the real output, lock it**

Run: `npx vitest run tests/data/parserCorpus.test.ts`
Expected: FAIL with a diff. Copy the **received** array into the `toEqual(...)` so the assertion encodes the parser's current real output. Re-run → PASS. (This is the snapshot-locking step; never invent the expected values — take them from the real parser.)

- [ ] **Step 4: Add codex, kiro, opencode fixtures + assertions**

Create each fixture mirroring that provider's real shapes (codex `response_item`/`event_msg` records with `payload`; kiro `{version,kind:"AssistantMessage"|"Prompt",data}` envelopes; opencode part-envelope JSON lines as `parseActivities` consumes). For each, add a `describe` block calling the matching parser and `toEqual` the real captured output, exactly as in Steps 2–3.

```ts
import { parseCodexActivities } from "../../src/data/providers/codex.js";
import { parseKiroActivitiesFromLines } from "../../src/data/providers/kiro-activity.js";
import { parseActivities as parseOpencode } from "../../src/data/providers/opencode.js";
// one describe()/it() per provider, same lock-the-real-output method
```

- [ ] **Step 5: Run the whole corpus + full suite**

Run: `npx vitest run tests/data/parserCorpus.test.ts && npx vitest run`
Expected: PASS (all providers), full suite green.

- [ ] **Step 6: Commit**

```bash
npx biome check --write tests/data/parserCorpus.test.ts
git add tests/fixtures/parser tests/data/parserCorpus.test.ts
git commit -m "test(parser): synthetic per-provider fixture corpus pinning current shapes

Refs #187"
```

---

### Task 8: Convention documentation

Point future maintainers at the spec's "add a version-gated branch" convention from the code they'll edit when drift is found.

**Files:**
- Modify: `src/data/toolDetails.ts` (header comment)
- Modify: `src/data/providers/claude.ts`, `codex.ts`, `kiro.ts`, `opencode.ts`, `kiro-ide.ts` (one header line each)

- [ ] **Step 1: Add the pointer to `toolDetails.ts`**

Add a Design-decision bullet to the file header:

```
 * - Tool shapes can drift across provider versions. When a row goes
 *   blank/wrong after a CLI upgrade, follow the version-gated-branch
 *   convention in
 *   docs/superpowers/specs/2026-06-19-parser-version-drift-design.md:
 *   add a synthetic fixture for the new shape, then branch on the
 *   session's `version` (thread the param here at that point). Keep the
 *   old fixture — old logs must still parse.
```

- [ ] **Step 2: Add a one-line pointer to each provider header**

In each of the five provider files, add to the header comment:

```
 * Version: captured onto SessionNode.version (see the parser
 * version-drift spec, docs/superpowers/specs/2026-06-19-parser-version-drift-design.md).
```

- [ ] **Step 3: Verify nothing broke**

Run: `npx vitest run && npx tsc --noEmit && npx biome check`
Expected: full suite green, tsc clean, biome clean (comments only).

- [ ] **Step 4: Commit**

```bash
git add src/data/toolDetails.ts src/data/providers/*.ts
git commit -m "docs(parser): point to the version-drift branch convention from code

Refs #187"
```

---

## Final verification (after all tasks)

- [ ] `npx vitest run` — full suite green (existing + version.test + 5 capture tests + corpus).
- [ ] `npx tsc --noEmit` — clean.
- [ ] `npx biome check` — clean.
- [ ] Manual sanity: `node dist/index.js --json` after a build, or a quick script, confirms at least claude/codex sessions now carry a non-undefined `version`.
- [ ] Independent review (fresh subagent) of the whole branch against this plan + the spec.
- [ ] PR `Closes #187`, carrying spec + plan + code.
