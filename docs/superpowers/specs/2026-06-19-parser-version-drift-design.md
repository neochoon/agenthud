# Parser version-drift seam — design

> Issue: #187 · Branch: `feat/187-parser-version-seam`

## Context

AgentHUD's session parsers hard-code the tool/entry shapes of each provider
(Claude Code, Codex, Kiro CLI, Kiro IDE, OpenCode), verified against real logs
at one point in time. Two facts make this fragile:

1. **Providers bump versions and change formats.** A field can move, rename, or
   restructure between CLI releases. The parser, written against the old shape,
   keeps running.
2. **Failure is silent.** The parsers are defensive (`?.`, `?? ""`,
   `return null`). When a shape no longer matches, they return an *empty* or
   *wrong* value rather than throwing. Nobody finds out. The AskUserQuestion
   empty-detail bug (#185) is exactly this class: not a crash, a silent blank.

Compounding it: AgentHUD reads logs going back **months**, so a format change
must not break *old* logs either — both the old and the new shape have to parse.

Meanwhile, **every provider already emits a version** that the parsers throw
away entirely:

| Provider  | Version source                                 | Example value                  | Scheme            |
|-----------|------------------------------------------------|--------------------------------|-------------------|
| claude    | per-line `version` on message entries          | `2.1.148`                      | semver            |
| codex     | `session_meta.payload.cli_version` (head, once)| `0.139.0`                      | semver            |
| kiro      | per-line envelope `version` (`{version,kind,data}`) | `v1`                      | schema tag        |
| opencode  | `migration` table — latest applied id          | `20260605042240_add_context…`  | migration id      |
| kiro-ide  | session JSON document (best-effort)            | (none confirmed on this host)  | unknown / absent  |

The version's **location, format, and meaning all differ per provider** — claude
and kiro are per-line, codex is once at the session head, opencode is a DB-wide
schema marker; claude/codex are semver, kiro is a `v1` schema tag, opencode is a
timestamp-prefixed migration id. There is **no single comparison** that fits all.

## Goal

Approach A — a **lightweight seam**. Build the structure that makes a future
format change *cheap to handle*, without building any branches that don't exist
yet (there are no known divergences today; this is preventive structure).

Concretely, after this change:

- The version each provider already emits is **captured** onto the session model.
- There is a **comparison vocabulary** for the semver providers.
- The current shapes are **pinned by a regression corpus**, so a later parser
  change (ours) or a format change that we encode breaks a test instead of
  silently blanking.
- There is a **documented convention** for adding a version-gated parse branch
  the day drift is discovered.

## Non-goals

- **Automatic upstream drift detection.** The corpus catches *our* regressions;
  it does not notify us when a provider changes its format upstream. Discovering
  that still requires a human noticing a blank row. (Possible future follow-up.)
- **A version→parser registry framework.** A central `(provider, range) →
  strategy` engine with zero entries is dead scaffolding. YAGNI. Rejected
  (this was "Approach B" in brainstorming).
- **Wiring the `toolDetails` `version?` parameter now.** The information lands on
  the session model; threading it into `summarizeToolDetail` /
  `buildToolDetailBody` is a one-line change deferred to the first real branch,
  to avoid an unused parameter today.
- **Per-entry version precision.** Captured at the **session level** only. A
  session that spans a mid-session CLI upgrade gets one representative version;
  pinning the exact upgrade boundary per entry is deferred until a real branch
  needs it.

## Architecture

### 1. Shared infrastructure

**`SessionNode.version?: string`** — a new optional field. It is an **opaque,
provider-defined string**. The infrastructure does **not** assume semver: kiro
stores `v1`, opencode stores a migration id. Consumers that compare it must use
the comparison appropriate to that provider's scheme.

**`src/data/version.ts`** — a small util for the *semver* providers:

- `compareVersions(a?: string, b?: string): -1 | 0 | 1` — split on `.`, compare
  numeric segments left to right. `undefined`, empty, and non-numeric segments
  sort as the **lowest** (so a missing version never accidentally takes a
  newer-version branch). Differing segment counts are handled (`2.9` < `2.10`,
  `2.1` < `2.1.1`).
- `versionGte(a?: string, b?: string): boolean` — `compareVersions(a, b) >= 0`,
  so a future branch reads `versionGte(v, "2.2.0")`.

These are **provided, not mandatory.** kiro compares its tag directly
(`v === "v1"`); opencode compares migration ids lexicographically (the
fixed-width timestamp prefix sorts correctly). The util exists for claude/codex.

### 2. Per-provider version capture (all 5)

Each provider fills `SessionNode.version` from its own source, inside the work it
already does in `discoverSessions` (no extra file passes):

- **claude** — capture the `version` from a message entry while discovery already
  parses the session (title/model/liveState). Representative = the latest entry
  carrying a version.
- **codex** — read `payload.cli_version` from the `session_meta` line (already
  the first line discovery inspects).
- **kiro** — read the envelope `version` (`v1`) from a line it already parses.
- **opencode** — `SELECT id FROM migration ORDER BY id DESC LIMIT 1` once per
  discovery (DB-wide; stamp every opencode session with it). Cheap, one query.
- **kiro-ide** — best-effort: read a `version`/`schema`/`format` field from the
  session JSON document if present; otherwise leave `undefined`. The absence is
  documented in the provider header (no such field was observed).

Capture is defensive throughout: any missing/garbage source yields `undefined`,
never a throw.

### 3. Regression corpus (the safety net)

`tests/fixtures/parser/<provider>/` holds **synthetic** fixtures — small,
hand-authored records that mirror each known shape, tagged with that provider's
version scheme. They are **not** dumps of real user sessions (leak risk: real
logs contain file contents, paths, prompts).

Each provider's fixtures cover its catalogued shapes — for claude: Edit
(structuredPatch), Read (file.content), Bash (stdout/stderr/interrupted), Task,
AskUserQuestion, response, thinking; for the others, the equivalent set their
parser handles.

A regression test loads each fixture, runs the real provider parser, and asserts
the resulting `ActivityEntry[]` (label / detail / body / type). This **pins the
current shapes**: a later refactor or an encoded format change that breaks an old
shape turns a test red instead of silently blanking a row. Version capture is
verified separately by the per-provider discovery tests (Tasks 2–6), not by the
corpus.

### 4. Convention for adding a branch (documented)

When drift *is* discovered (a blank/wrong row traced to a format change):

1. Add a new synthetic fixture for the new shape under the provider's dir,
   tagged with the new version.
2. Add the parse branch, gated by the provider's own comparison
   (`versionGte(v, "2.2.0")` for semver; `v === "v2"` for kiro; id compare for
   opencode). If the branch lives in `toolDetails`, thread the `version?`
   parameter at that point.
3. Keep the old fixture: both old and new shapes must continue to parse.

This convention is recorded here and pointed to from a short comment in
`toolDetails.ts` and each provider's header.

## Data flow

```
discoverSessions()
  └─ for each provider:
       parse session metadata (existing work)
       └─ extract provider-specific version  ──►  SessionNode.version  (opaque string)

parseSessionHistory() / provider parsers
  └─ produce ActivityEntry[]   (unchanged today; version param threaded only at first branch)

tests/fixtures/parser/<provider>/*  ──►  provider parser  ──►  asserted ActivityEntry[] (shapes only)
```

## Error handling

- Every capture path is wrapped so a missing or malformed version source yields
  `undefined` — discovery never fails because a version couldn't be read.
- `compareVersions` treats `undefined`/empty/non-numeric as lowest; it never
  throws on garbage input.
- The opencode `migration` query is guarded like the rest of that provider's
  SQLite access (the DB or table may be absent on older installs).

## Testing

- **`version.ts` unit tests** — `compareVersions`/`versionGte` edge cases:
  `undefined` vs value, non-numeric segments, unequal segment counts
  (`2.9` < `2.10`, `2.1` < `2.1.1`), equality.
- **Per-provider capture tests** — each provider's `discoverSessions` stamps the
  expected `version` from a fixture (and `undefined` when the source is absent,
  e.g. kiro-ide).
- **Fixture regression tests** — load each synthetic fixture, parse, assert the
  full `ActivityEntry[]` output, locking current shapes.

All via TDD: write the failing test first, confirm it fails for the right reason,
implement, confirm the related suite passes. `tsc --noEmit` and whole-repo
`biome check` clean before each commit.

## Phasing

Each phase is independently shippable and testable.

1. **Shared infra** — `src/data/version.ts` (+ tests) and the
   `SessionNode.version?` field.
2. **Capture, per provider** — one task each (claude, codex, kiro, opencode,
   kiro-ide), each with a capture test.
3. **Regression corpus** — synthetic fixtures + the snapshot regression test,
   per provider.
4. **Convention docs** — the comment pointers in `toolDetails.ts` and provider
   headers referencing this spec.

The `toolDetails` `version?` parameter and any actual parse branch are explicitly
**out of scope** here — they arrive with the first discovered drift.
