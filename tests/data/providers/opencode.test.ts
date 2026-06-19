import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  opencodeProvider,
  parseActivities,
  parseOpenCodeSessionActivities,
} from "../../../src/data/providers/opencode.js";
import type { GlobalConfig } from "../../../src/types/index.js";

// node:sqlite is Node 22+. Skip the whole suite where it's missing (CI Node
// 20) — the provider degrades to isAvailable() === false there, by design.
let DatabaseSync:
  | {
      new (
        path: string,
      ): {
        exec(s: string): void;
        prepare(s: string): { run(...a: unknown[]): void };
        close(): void;
      };
    }
  | undefined;
let sqliteAvailable = false;
try {
  DatabaseSync = createRequire(import.meta.url)("node:sqlite").DatabaseSync;
  sqliteAvailable = true;
} catch {
  // node:sqlite unavailable
}

const NOW = Date.now();

const config: GlobalConfig = {
  refreshIntervalMs: 2000,
  hiddenSessions: [],
  hiddenSubAgents: [],
  filterPresets: [[]],
  hiddenProjects: [],
  report: { include: [], detailLimit: 0, withGit: false, format: "markdown" },
  summary: {},
};

let dir: string;
let dbPath: string;

function buildDb(): void {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, project_id TEXT,
      directory TEXT, title TEXT, model TEXT, time_created INTEGER,
      time_updated INTEGER, time_archived INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT,
      time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
      time_created INTEGER, data TEXT);
    CREATE TABLE migration (id TEXT, time_completed INTEGER);
  `);

  db.exec(
    "INSERT INTO migration (id, time_completed) VALUES " +
      "('20260101000000_init', 1), ('20260605042240_add_context_epoch_agent', 2)",
  );

  const ins = db.prepare("INSERT INTO session VALUES (?,?,?,?,?,?,?,?,?)");
  ins.run(
    "ses_top",
    null,
    "prj",
    "/Users/neo/ocproj",
    "Top",
    '{"id":"gpt-5.5"}',
    NOW - 5000,
    NOW - 1000,
    null,
  );
  ins.run(
    "ses_child",
    "ses_top",
    "prj",
    "/Users/neo/ocproj",
    "Child task",
    '{"id":"gpt-5.5"}',
    NOW - 4000,
    NOW - 2000,
    null,
  );
  ins.run(
    "ses_arch",
    null,
    "prj",
    "/Users/neo/ocproj",
    "Archived",
    '{"id":"gpt-5.5"}',
    NOW - 9000,
    NOW - 9000,
    NOW - 8000,
  );

  const msg = db.prepare("INSERT INTO message VALUES (?,?,?,?)");
  msg.run("m_user", "ses_top", NOW - 4000, JSON.stringify({ role: "user" }));
  msg.run(
    "m_asst",
    "ses_top",
    NOW - 1000,
    JSON.stringify({
      role: "assistant",
      modelID: "gpt-5.5",
      tokens: { input: 1000, cache: { read: 4000 } },
      time: { created: NOW - 2000, completed: NOW - 1000 },
    }),
  );

  const part = db.prepare("INSERT INTO part VALUES (?,?,?,?,?)");
  part.run(
    "p1",
    "m_user",
    "ses_top",
    NOW - 4000,
    JSON.stringify({ type: "text", text: "Explain repo" }),
  );
  part.run(
    "p2",
    "m_asst",
    "ses_top",
    NOW - 3000,
    JSON.stringify({
      type: "tool",
      tool: "read",
      state: { title: "file.ts", status: "completed" },
    }),
  );
  part.run(
    "p3",
    "m_asst",
    "ses_top",
    NOW - 2500,
    JSON.stringify({ type: "reasoning", text: "thinking hard" }),
  );
  part.run(
    "p4",
    "m_asst",
    "ses_top",
    NOW - 2000,
    JSON.stringify({ type: "text", text: "Here is the answer" }),
  );
  db.close();
}

beforeEach(() => {
  if (!sqliteAvailable) return;
  dir = mkdtempSync(join(tmpdir(), "agenthud-oc-"));
  dbPath = join(dir, "opencode.db");
  buildDb();
  process.env.OPENCODE_DB = dbPath;
});

afterEach(() => {
  delete process.env.OPENCODE_DB;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!sqliteAvailable)("opencodeProvider", () => {
  it("isAvailable is true when the DB exists", () => {
    expect(opencodeProvider.isAvailable()).toBe(true);
  });

  it("isAvailable is false when the DB is missing", () => {
    process.env.OPENCODE_DB = join(dir, "nope.db");
    expect(opencodeProvider.isAvailable()).toBe(false);
  });

  it("discovers a top-level session with model, title, and project", () => {
    const tree = opencodeProvider.discoverSessions(config);
    expect(tree.projects).toHaveLength(1);
    const project = tree.projects[0];
    expect(project.name).toBe("ocproj");
    const top = project.sessions.find((s) => s.id === "ses_top");
    expect(top).toBeDefined();
    expect(top?.modelName).toBe("gpt-5.5");
    expect(top?.firstUserPrompt).toBe("Top");
    expect(top?.provider).toBe("opencode");
    expect(top?.filePath).toBe("opencode:ses_top");
  });

  it("nests a child session as a sub-agent via parent_id", () => {
    const tree = opencodeProvider.discoverSessions(config);
    const top = tree.projects[0].sessions.find((s) => s.id === "ses_top");
    expect(top?.subAgents).toHaveLength(1);
    expect(top?.subAgents[0].id).toBe("ses_child");
    expect(top?.subAgents[0].taskDescription).toBe("Child task");
  });

  it("computes a context-usage gauge from the latest assistant tokens", () => {
    const tree = opencodeProvider.discoverSessions(config);
    const top = tree.projects[0].sessions.find((s) => s.id === "ses_top");
    // used = input(1000) + cache.read(4000) = 5000
    expect(top?.contextUsage?.used).toBe(5000);
    expect(top?.contextUsage?.percent).toBe(3); // 5000 / 200000
  });

  it("excludes archived sessions", () => {
    const tree = opencodeProvider.discoverSessions(config);
    const ids = tree.projects.flatMap((p) => p.sessions.map((s) => s.id));
    expect(ids).not.toContain("ses_arch");
  });

  it("builds the activity timeline for a session in chronological order", () => {
    const acts = parseOpenCodeSessionActivities("ses_top");
    expect(acts.map((a) => a.type)).toEqual([
      "user",
      "tool",
      "thinking",
      "response",
    ]);
    expect(acts[0].detail).toBe("Explain repo");
    expect(acts[1].label).toBe("read");
    expect(acts[1].detail).toBe("file.ts");
    expect(acts[3].detail).toBe("Here is the answer");
  });

  it("stamps the latest migration id as the session version", () => {
    const tree = opencodeProvider.discoverSessions(config);
    const top = tree.projects[0].sessions.find((s) => s.id === "ses_top");
    expect(top?.version).toBe("20260605042240_add_context_epoch_agent");
  });

  it("skips a single malformed part instead of blanking the timeline", () => {
    const db = new DatabaseSync(dbPath);
    db.prepare("INSERT INTO part VALUES (?,?,?,?,?)").run(
      "p_bad",
      "m_asst",
      "ses_top",
      NOW - 2200,
      "{not valid json",
    );
    db.close();
    const acts = parseOpenCodeSessionActivities("ses_top");
    // The 4 good parts still come through; the malformed one is dropped.
    expect(acts.map((a) => a.type)).toEqual([
      "user",
      "tool",
      "thinking",
      "response",
    ]);
  });
});

// parseActivities is pure (line-based) and testable without SQLite.
describe("opencode parseActivities (pure)", () => {
  it("maps part envelopes to activity entries", () => {
    const lines = [
      JSON.stringify({
        role: "user",
        t: 1000,
        part: { type: "text", text: "hi" },
      }),
      JSON.stringify({
        role: "assistant",
        t: 2000,
        part: { type: "reasoning", text: "hmm" },
      }),
      JSON.stringify({
        role: "assistant",
        t: 3000,
        part: { type: "tool", tool: "bash", state: { title: "ls" } },
      }),
      JSON.stringify({
        role: "assistant",
        t: 4000,
        part: { type: "step-start" },
      }),
    ];
    const { activities } = parseActivities(lines);
    expect(activities.map((a) => a.type)).toEqual(["user", "thinking", "tool"]); // step-start skipped
    expect(activities[2].label).toBe("bash");
    expect(activities[2].detail).toBe("ls");
  });
});
