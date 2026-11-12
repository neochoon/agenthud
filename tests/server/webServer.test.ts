/**
 * Integration tests for `agenthud web` — a real HTTP server on an
 * ephemeral loopback port, driven with real requests.
 *
 * The data source is a synthetic DSH session in a temp `DSH_HOME`
 * (plain JSONL, so no zstd needed), with the Claude projects dir
 * pointed at an empty temp dir so no real corpus leaks in.
 *
 * What matters here, beyond the happy path:
 * - no token → 401 (the token is the only thing standing between the
 *   user's transcripts and any other local process);
 * - a bogus Host header → 403 (DNS-rebinding guard);
 * - `?path=` on /api/activity must match a DISCOVERED session file, so
 *   the endpoint can't be turned into an arbitrary file reader;
 * - summary requests never actually invoke an LLM here: only the
 *   validation paths that fail before spawning are exercised.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GlobalConfig } from "../../src/types/index.js";

const {
  startWebServer,
  buildActivityPayload,
  buildTreePayload,
  indexSessionFiles,
  sessionPayload,
  shortSessionId,
  summaryBodyForFile,
} = await import("../../src/server/webServer.js");
const { DEFAULT_GLOBAL_CONFIG } = await import(
  "../../src/config/globalConfig.js"
);

const CWD = join("C:", "work", "demo");
const OTHER_CWD = join("C:", "work", "other");
const SESSION_ID = "session-aaaa1111-2222-3333-4444-555566667777";
const OTHER_SESSION_ID = "session-bbbb1111-2222-3333-4444-555566667777";
// Local-time anchored so the report's date bucket is stable regardless
// of the machine's timezone.
const BASE = new Date(2023, 10, 14, 10, 0, 0).getTime();
const DAY = "2023-11-14";

function config(): GlobalConfig {
  return {
    ...DEFAULT_GLOBAL_CONFIG,
    hiddenSessions: [],
    hiddenSubAgents: [],
    hiddenProjects: [],
  };
}

/** One synthetic DSH session: header, a user turn, a tool call, a reply. */
function sessionLog(
  id: string = SESSION_ID,
  cwd: string = CWD,
  prompt = "fix the failing tests",
): string {
  const records = [
    {
      type: "session",
      version: 4,
      id,
      createdAt: BASE - 60_000,
      cwd,
      delegationDepth: 0,
      agentPreset: "standard",
    },
    {
      type: "user/message",
      seq: 1,
      time: BASE,
      data: {
        content: [{ type: "text", text: prompt }],
        source: { kind: "user" },
        role: "user",
        id: "u1",
      },
    },
    {
      type: "tool/call",
      seq: 2,
      time: BASE + 1000,
      data: { callId: "c1", name: "pwsh", arguments: '{"command":"npm test"}' },
    },
    {
      type: "assistant/message",
      seq: 3,
      time: BASE + 2000,
      data: {
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 },
        message: {
          role: "assistant",
          content: [{ type: "text", text: "All green now." }],
        },
      },
    },
  ];
  return `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
}

describe("web server", () => {
  let home: string;
  let handle: {
    url: string;
    port: number;
    token: string;
    close: () => Promise<void>;
  };
  let sessionFile: string;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "agenthud-web-"));
    const dshHome = join(home, "dsh");
    const sessionsRoot = join(dshHome, "sessions");
    const projectDir = join(sessionsRoot, "--C-work-demo--", SESSION_ID);
    mkdirSync(projectDir, { recursive: true });
    sessionFile = join(projectDir, "session.v4.jsonl");
    writeFileSync(sessionFile, sessionLog(), "utf-8");

    // A second workspace, so scope filtering is observable.
    const otherDir = join(sessionsRoot, "--C-work-other--", OTHER_SESSION_ID);
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(
      join(otherDir, "session.v4.jsonl"),
      sessionLog(OTHER_SESSION_ID, OTHER_CWD, "polish the other thing"),
      "utf-8",
    );

    // Isolate EVERY provider: a missing root makes that provider report
    // itself unavailable, so the real ~/.claude / ~/.codex / ~/.kiro /
    // ~/.dsh corpora can't leak into these assertions.
    process.env.DSH_HOME = dshHome;
    process.env.CLAUDE_PROJECTS_DIR = join(home, "no-claude");
    process.env.CODEX_SESSIONS_DIR = join(home, "no-codex");
    process.env.KIRO_SESSIONS_DIR = join(home, "no-kiro");
    process.env.KIRO_IDE_SESSIONS_DIR = join(home, "no-kiro-ide");
    process.env.OPENCODE_DB = join(home, "no-opencode.db");

    handle = await startWebServer({ config: config(), port: 0 });
  });

  afterAll(async () => {
    await handle.close();
    delete process.env.DSH_HOME;
    delete process.env.CLAUDE_PROJECTS_DIR;
    delete process.env.CODEX_SESSIONS_DIR;
    delete process.env.KIRO_SESSIONS_DIR;
    delete process.env.KIRO_IDE_SESSIONS_DIR;
    delete process.env.OPENCODE_DB;
    rmSync(home, { recursive: true, force: true });
  });

  const api = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${handle.port}${path}`, {
      ...init,
      headers: { "x-agenthud-token": handle.token, ...(init.headers ?? {}) },
    });

  it("serves the UI at / without needing the token", async () => {
    const res = await fetch(handle.url.replace(/\?.*$/, ""));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<html");
  });

  it("rejects api calls without the token", async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/tree`);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it("rejects a foreign Host header (DNS-rebinding guard)", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: handle.port,
          path: "/api/tree",
          headers: { host: "evil.example", "x-agenthud-token": handle.token },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("returns the tree with the discovered DSH project", async () => {
    const res = await api("/api/tree");
    expect(res.status).toBe(200);
    const tree = (await res.json()) as {
      projects: Array<{
        name: string;
        path: string;
        sessions: Array<{ id: string; provider: string }>;
      }>;
      totalCount: number;
    };
    const project = tree.projects.find((p) => p.path === CWD);
    expect(project).toBeDefined();
    expect(project?.name).toBe("demo");
    expect(project?.sessions[0].id).toBe(SESSION_ID);
    expect(project?.sessions[0].provider).toBe("dsh");
    expect(tree.totalCount).toBe(2);
  });

  it("filters the report by ?scope= (and widens back out when empty)", async () => {
    const scoped = await api(
      `/api/report?date=${DAY}&scope=${encodeURIComponent(CWD)}`,
    );
    const scopedText = ((await scoped.json()) as { content: string }).content;
    expect(scopedText).toContain("## demo");
    expect(scopedText).not.toContain("## other");

    const all = await api(`/api/report?date=${DAY}&scope=`);
    const allText = ((await all.json()) as { content: string }).content;
    expect(allText).toContain("## demo");
    expect(allText).toContain("## other");
  });

  it("returns activities for a discovered session", async () => {
    const res = await api(
      `/api/activity?id=${encodeURIComponent(SESSION_ID)}&path=${encodeURIComponent(sessionFile)}`,
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      count: number;
      activities: Array<{ type: string; label: string; time: string }>;
    };
    expect(payload.count).toBeGreaterThan(0);
    expect(payload.activities.some((a) => a.type === "user")).toBe(true);
    // HH:MM:SS, zero-padded.
    expect(payload.activities[0].time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("accepts a workspace whitelist (repeated ?scope= or comma form)", async () => {
    const enc = encodeURIComponent;
    const both = await api(
      `/api/report?date=${DAY}&scope=${enc(CWD)}&scope=${enc(OTHER_CWD)}`,
    );
    const bothText = ((await both.json()) as { content: string }).content;
    expect(bothText).toContain("## demo");
    expect(bothText).toContain("## other");

    const comma = await api(
      `/api/report?date=${DAY}&scope=${enc(CWD)},${enc(OTHER_CWD)}`,
    );
    const commaBody = (await comma.json()) as {
      content: string;
      scopes: string[];
    };
    expect(commaBody.scopes).toHaveLength(2);
    expect(commaBody.content).toContain("## other");
  });

  it("returns only the whitelisted project for a single-scope request", async () => {
    const one = await api(
      `/api/report?date=${DAY}&scope=${encodeURIComponent(OTHER_CWD)}`,
    );
    const text = ((await one.json()) as { content: string }).content;
    expect(text).toContain("## other");
    expect(text).not.toContain("## demo");
  });

  it("serves activities by id alone (the path is the server's own)", async () => {
    const res = await api(`/api/activity?id=${encodeURIComponent(SESSION_ID)}`);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { count: number; filePath: string };
    expect(payload.count).toBeGreaterThan(0);
    expect(payload.filePath).toBe(sessionFile);
  });

  it("refuses an activity request whose path is not that session's file", async () => {
    const res = await api(
      `/api/activity?id=${encodeURIComponent(SESSION_ID)}&path=${encodeURIComponent("C:\\Windows\\win.ini")}`,
    );
    expect(res.status).toBe(404);
  });

  it("serves a report for a date (markdown and json)", async () => {
    const md = await api(`/api/report?date=${DAY}`);
    expect(md.status).toBe(200);
    expect((await md.json()).content).toContain("# AgentHUD Report");

    const json = await api(`/api/report?date=${DAY}&format=json`);
    const body = (await json.json()) as { content: string };
    expect(JSON.parse(body.content)).toHaveProperty("date", DAY);
  });

  it("lists summaries and refuses an unknown summary file", async () => {
    const list = await api("/api/summaries");
    expect(list.status).toBe(200);
    expect(Array.isArray((await list.json()).entries)).toBe(true);

    const bad = await api("/api/summary?name=../../etc/passwd");
    expect(bad.status).toBe(404);
  });

  it("400s a summary POST whose scope does not resolve (never spawns an engine)", async () => {
    const res = await api("/api/summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: "2023-11-14",
        scopes: [join("X:", "nope")],
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("no project");
  });

  it("400s a summary POST with a malformed body", async () => {
    const res = await api("/api/summary", { method: "POST", body: "not json" });
    expect(res.status).toBe(400);
  });

  it("404s an unknown api route", async () => {
    const res = await api("/api/nope");
    expect(res.status).toBe(404);
  });
});

describe("payload builders", () => {
  const node = (over: Partial<Record<string, unknown>> = {}) =>
    ({
      id: SESSION_ID,
      hideKey: "demo/s",
      filePath: "/tmp/s.jsonl",
      projectPath: CWD,
      projectName: "demo",
      lastModifiedMs: 1_700_000_000_000,
      status: "hot",
      modelName: "cn:deepseek-v4.1-flash",
      subAgents: [],
      nonInteractive: false,
      firstUserPrompt: "fix the failing tests",
      liveState: "working",
      provider: "dsh",
      version: "v4",
      contextUsage: { used: 130_000, total: 1_000_000, percent: 13 },
      ...over,
    }) as never;

  const tree = (sessions: unknown[]) =>
    ({
      projects: [{ name: "demo", projectPath: CWD, sessions, hotness: "hot" }],
      coldProjects: [],
      totalCount: sessions.length,
      timestamp: "",
      hiddenStats: { total: 0, active: 0 },
    }) as never;

  it("shortSessionId mirrors the TUI's compact id", () => {
    expect(shortSessionId("session-9760ce18-aaaa")).toBe("9760");
    expect(shortSessionId("9760ce18")).toBe("9760");
  });

  it("maps a session node, nesting sub-agents without their own key", () => {
    const child = node({ id: "child", agentId: "child", subAgents: [] });
    const payload = sessionPayload(node({ subAgents: [child] }) as never);
    expect(payload).toMatchObject({
      short: "aaaa",
      provider: "dsh",
      status: "hot",
      live: "working",
      ctxPercent: 13,
      title: "fix the failing tests",
    });
    expect(payload.subAgents).toHaveLength(1);
    expect(payload.subAgents?.[0].id).toBe("child");
    expect(payload.subAgents?.[0]).not.toHaveProperty("subAgents");
  });

  it("wraps a tree with a timestamp and the hidden census", () => {
    const payload = buildTreePayload(tree([node()]), 42);
    expect(payload.generatedAt).toBe(42);
    expect(payload.projects[0]).toMatchObject({ name: "demo", path: CWD });
    expect(payload.totalCount).toBe(1);
    expect(payload.hidden).toEqual({ total: 0, active: 0 });
  });

  it("indexes every session file, sub-agents included", () => {
    const files = indexSessionFiles(
      tree([
        node({
          subAgents: [
            node({ id: "child", agentId: "child", filePath: "/tmp/c.jsonl" }),
          ],
        }),
      ]),
    );
    expect(files.get(SESSION_ID)).toBe("/tmp/s.jsonl");
    expect(files.get("child")).toBe("/tmp/c.jsonl");
  });

  it("maps activity body fields and drops empty ones", () => {
    const payload = buildActivityPayload("s1", "/x", [
      {
        timestamp: new Date(2026, 10, 12, 9, 5, 7),
        type: "tool",
        icon: "$",
        label: "Bash",
        detail: "npm test",
        detailBody: "ok",
        detailKind: "code",
        detailNumbered: true,
        count: 3,
      },
      {
        timestamp: new Date(2026, 10, 12, 9, 6, 8),
        type: "response",
        icon: "<",
        label: "Response",
        detail: "done",
      },
    ]);
    expect(payload.count).toBe(2);
    expect(payload.activities[0]).toMatchObject({
      time: "09:05:07",
      body: "ok",
      bodyKind: "code",
      numbered: true,
      count: 3,
    });
    expect(payload.activities[1]).not.toHaveProperty("body");
    expect(payload.activities[1]).not.toHaveProperty("count");
  });

  it("summaryBodyForFile strips the backlink block and the engine marker", () => {
    const content = [
      "<!-- agenthud-backlinks-start -->",
      "[← all summaries](./index.md)",
      "",
      "# 2026-11-12 (Thursday)",
      "<!-- agenthud-backlinks-end -->",
      "",
      "<!-- agenthud-engine: codex model: default -->",
      "",
      "## Context",
      "body",
    ].join("\n");
    const body = summaryBodyForFile(content);
    expect(body).toContain("# 2026-11-12 (Thursday)");
    expect(body).toContain("## Context");
    expect(body).not.toContain("backlinks-start");
    expect(body).not.toContain("agenthud-engine");
  });
});
