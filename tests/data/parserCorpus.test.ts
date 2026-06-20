/**
 * Per-provider fixture regression corpus. Each describe block feeds a
 * synthetic fixture (mirroring real provider shapes) through the real
 * parser and asserts the exact ActivityEntry[] the parser currently
 * produces. A later parser or fixture-encoding change turns a test red
 * instead of silently blanking a row.
 *
 * Design decisions:
 * - Fixtures are SYNTHETIC, never real user data.
 * - Expected values are locked from the parser's real output, not
 *   hand-written guesses. Run once to get the received array, copy it
 *   into the toEqual, re-run → green. The brief calls this the
 *   "snapshot-locking" method.
 * - We assert `label:detail` tuples (compact) rather than full objects
 *   so the corpus stays readable and diffs stay focused on what
 *   actually matters to a reviewer scanning the output.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseActivitiesFromLines } from "../../src/data/providers/claude-activity.js";
import { parseCodexActivities } from "../../src/data/providers/codex.js";
import { parseKiroActivitiesFromLines } from "../../src/data/providers/kiro-activity.js";
import { parseActivities as parseOpencode } from "../../src/data/providers/opencode.js";

const FIX = fileURLToPath(new URL("../fixtures/parser", import.meta.url));

const lines = (rel: string): string[] =>
  readFileSync(join(FIX, rel), "utf8").split("\n").filter(Boolean);

// ---------------------------------------------------------------------------
// Claude v2.1
// ---------------------------------------------------------------------------
describe("parser corpus: claude v2.1", () => {
  it("parses the known shapes into stable activity labels/details", () => {
    const { activities } = parseActivitiesFromLines(lines("claude/v2.1.jsonl"));
    expect(activities.length).toBeGreaterThan(0);
    const summary = activities.map((a) => `${a.label}:${a.detail}`);
    expect(summary).toMatchInlineSnapshot(`
      [
        "Thinking:I need to update the function signature.",
        "Edit:a.ts L1-1 +1 -1",
        "Response:Done — the function signature is updated.",
      ]
    `);
  });
});

// ---------------------------------------------------------------------------
// Codex v0.139
// ---------------------------------------------------------------------------
describe("parser corpus: codex v0.139", () => {
  it("parses the known shapes into stable activity labels/details", () => {
    const { activities } = parseCodexActivities(lines("codex/v0.139.jsonl"));
    expect(activities.length).toBeGreaterThan(0);
    const summary = activities.map((a) => `${a.label}:${a.detail}`);
    expect(summary).toMatchInlineSnapshot(`
      [
        "User:Fix the broken tests in the auth module",
        "Bash:npm test -- auth",
        "Response:I've run the tests and fixed the failing assertions in the auth module.",
        "Task:Review the auth module changes for security issues",
      ]
    `);
  });
});

// ---------------------------------------------------------------------------
// Kiro v1
// ---------------------------------------------------------------------------
describe("parser corpus: kiro v1", () => {
  it("parses the known shapes into stable activity labels/details", () => {
    const { activities } = parseKiroActivitiesFromLines(lines("kiro/v1.jsonl"));
    expect(activities.length).toBeGreaterThan(0);
    const summary = activities.map((a) => `${a.label}:${a.detail}`);
    expect(summary).toMatchInlineSnapshot(`
      [
        "User:Refactor the database connection pool",
        "Response:I'll refactor the connection pool for better reliability.",
        "Read:/src/db/pool.ts",
        "Edit:/src/db/pool.ts",
        "Response:The connection pool has been refactored with retry logic.",
      ]
    `);
  });
});

// ---------------------------------------------------------------------------
// opencode parts envelope
// ---------------------------------------------------------------------------
describe("parser corpus: opencode parts", () => {
  it("parses the known shapes into stable activity labels/details", () => {
    const { activities } = parseOpencode(lines("opencode/parts.jsonl"));
    expect(activities.length).toBeGreaterThan(0);
    const summary = activities.map((a) => `${a.label}:${a.detail}`);
    expect(summary).toMatchInlineSnapshot(`
      [
        "User:Add error handling to the API client",
        "Thinking:I should wrap the fetch calls in try/catch blocks.",
        "Read:/src/api/client.ts",
        "Response:I've added error handling to the API client.",
      ]
    `);
  });
});
