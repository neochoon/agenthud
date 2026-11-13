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
import {
  execInputDetail,
  parseCodexActivities,
} from "../../src/data/providers/codex.js";
import { parseDshActivities } from "../../src/data/providers/dsh.js";
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
// DSH v4 event log
// ---------------------------------------------------------------------------
describe("parser corpus: dsh v4", () => {
  it("parses the known shapes into stable activity labels/details", () => {
    const { activities } = parseDshActivities(lines("dsh/v4.jsonl"));
    expect(activities.length).toBeGreaterThan(0);
    const summary = activities.map((a) => `${a.label}:${a.detail}`);
    expect(summary).toMatchInlineSnapshot(`
      [
        "User:The approval policy changed. Nothing else to do.",
        "User:Fix the failing tests in the auth module",
        "Thinking:I should run the suite first and read the auth module.",
        "Read:auth.ts",
        "Bash:npm test -- auth",
        "Response:I've fixed the failing assertion in the auth module.",
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

// ---------------------------------------------------------------------------
// Codex v0.167 (0.163+ role-tagged transcript)
//
// The format this provider originally parsed (`event_msg/user_message`,
// `agent_message`, named `exec_command` function calls) is GONE from
// every rollout on disk since CLI 0.163 — which silently produced zero
// activities, so codex sessions were invisible in reports and summaries.
// These cases lock the new shapes in.
// ---------------------------------------------------------------------------
describe("codex v0.167 format", () => {
  const fx = () => lines("codex/v0.167.jsonl");

  it("parses the role-tagged transcript into stable rows", () => {
    const { activities } = parseCodexActivities(fx());
    const summary = activities.map((a) => `${a.label}:${a.detail}`);
    expect(summary).toMatchInlineSnapshot(`
      [
        "User:读下这个文档",
        "Thinking:**Checking the fixture**",
        "Bash:Get-Content -LiteralPath 'AGENT.md' -Encoding UTF8",
        "Response:已读完 AGENT.md，文档介绍的是四旋翼联合实验系统。",
        "AskUserQuestion:是否允许沿用原差分账号？",
      ]
    `);
  });

  it("skips the developer/system prompt as a user turn", () => {
    const { activities } = parseCodexActivities(fx());
    const users = activities.filter((a) => a.type === "user");
    expect(users).toHaveLength(1);
    expect(users[0].detail).toBe("读下这个文档");
    expect(
      users.some((u) => (u.detailBody ?? "").includes("agent based on GPT-6")),
    ).toBe(false);
  });

  it("reads the plaintext reasoning summary, not the encrypted blob", () => {
    const { activities } = parseCodexActivities(fx());
    const thinking = activities.filter((a) => a.type === "thinking");
    expect(thinking).toHaveLength(1);
    expect(thinking[0].detail).toContain("Checking the fixture");
  });

  it("unwraps the exec orchestrator to the inner shell command", () => {
    const { activities } = parseCodexActivities(fx());
    const bash = activities.filter((a) => a.label === "Bash");
    expect(bash).toHaveLength(1);
    expect(bash[0].detail).toBe(
      "Get-Content -LiteralPath 'AGENT.md' -Encoding UTF8",
    );
    // The matching custom_tool_call_output becomes the expandable body.
    expect(bash[0].detailBody).toContain("# PX4 开发环境");
  });

  it("does not double-count the item_completed mirror", () => {
    const { activities } = parseCodexActivities(fx());
    // One exec call → exactly one Bash row, even though the log also
    // carries an item_completed/CommandExecution for the same command.
    expect(activities.filter((a) => a.label === "Bash")).toHaveLength(1);
    expect(activities.filter((a) => a.type === "response")).toHaveLength(1);
  });

  it("maps the human-in-the-loop tool to AskUserQuestion", () => {
    const { activities } = parseCodexActivities(fx());
    expect(activities.some((a) => a.label === "AskUserQuestion")).toBe(true);
  });

  it("still reports the model and the context gauge", () => {
    const { modelName } = parseCodexActivities(fx());
    expect(modelName).toBe("gpt-6.1-sol");
  });
});

describe("execInputDetail", () => {
  it("extracts the tool and its cmd from the exec source", () => {
    expect(
      execInputDetail('text(await tools.exec_command({cmd:"git status"}));'),
    ).toEqual({ tool: "exec_command", detail: "git status" });
  });

  it("falls back to another string field when there is no cmd", () => {
    expect(
      execInputDetail('await tools.read_file({path:"src/a.ts"});'),
    ).toEqual({ tool: "read_file", detail: "src/a.ts" });
  });

  it("returns the bare tool name when nothing is recognizable", () => {
    expect(execInputDetail("await tools.wait({})").tool).toBe("wait");
    expect(execInputDetail(undefined)).toEqual({ tool: "exec", detail: "" });
  });

  it("unescapes quotes inside the command", () => {
    const parsed = execInputDetail(
      'text(await tools.exec_command({cmd:"echo \\"hi\\""}));',
    );
    expect(parsed.detail).toBe('echo "hi"');
  });
});
