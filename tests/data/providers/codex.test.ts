import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const { existsSync, readdirSync, statSync, readFileSync } = await import(
  "node:fs"
);
const { codexProvider, parseCodexActivities, clearCodexMetaCache } =
  await import("../../../src/data/providers/codex.js");

const NOW = 1_700_000_000_000;

const mockConfig = {
  refreshIntervalMs: 2000,
  hiddenSessions: [] as string[],
  hiddenSubAgents: [] as string[],
  filterPresets: [[]] as string[][],
  hiddenProjects: [] as string[],
};

const ROOT = join("/tmp", "codex-test", "sessions");

function setRoot() {
  process.env.CODEX_SESSIONS_DIR = ROOT;
}

afterEach(() => {
  vi.resetAllMocks();
  clearCodexMetaCache();
  delete process.env.CODEX_SESSIONS_DIR;
});

// A rollout file is JSONL; build one from records.
function rollout(records: object[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}

function metaLine(over: Record<string, unknown> = {}) {
  return {
    type: "session_meta",
    timestamp: "2026-06-12T06:08:36.847Z",
    payload: {
      id: "parent-uuid",
      cwd: "/Users/neo/myproject",
      originator: "codex-tui",
      cli_version: "0.121.0",
      source: "cli",
      model_provider: "openai",
      ...over,
    },
  };
}

function turnCtx(model: string) {
  return {
    type: "turn_context",
    timestamp: "2026-06-12T06:08:40.000Z",
    payload: { turn_id: "t1", cwd: "/Users/neo/myproject", model },
  };
}

function userMsg(message: string) {
  return {
    type: "event_msg",
    timestamp: "2026-06-12T06:08:41.000Z",
    payload: { type: "user_message", message, images: [] },
  };
}

function tokenCount(win: number, lastTotal: number) {
  return {
    type: "event_msg",
    timestamp: "2026-06-12T06:08:50.000Z",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: { total_tokens: lastTotal },
        total_token_usage: { total_tokens: lastTotal * 10 },
        model_context_window: win,
      },
    },
  };
}

// Map nested YYYY/MM/DD readdir for a single file under ROOT.
function mockTree(files: Record<string, string>) {
  // files: { "<rolloutFileName>": "<content>" } — all placed in ROOT/2026/06/12
  const day = join(ROOT, "2026", "06", "12");
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readdirSync).mockImplementation((p) => {
    const path = String(p);
    if (path === ROOT)
      return ["2026"] as unknown as ReturnType<typeof readdirSync>;
    if (path === join(ROOT, "2026"))
      return ["06"] as unknown as ReturnType<typeof readdirSync>;
    if (path === join(ROOT, "2026", "06"))
      return ["12"] as unknown as ReturnType<typeof readdirSync>;
    if (path === day)
      return Object.keys(files) as unknown as ReturnType<typeof readdirSync>;
    return [] as unknown as ReturnType<typeof readdirSync>;
  });
  vi.mocked(statSync).mockImplementation((p) => {
    const path = String(p);
    const isFile = path.endsWith(".jsonl");
    return {
      isDirectory: () => !isFile,
      mtimeMs: NOW - 60_000,
      size: 1000,
    } as ReturnType<typeof statSync>;
  });
  vi.mocked(readFileSync).mockImplementation((p) => {
    const path = String(p);
    for (const [name, content] of Object.entries(files)) {
      if (path.endsWith(name)) return content;
    }
    return "";
  });
  vi.spyOn(Date, "now").mockReturnValue(NOW);
}

describe("codexProvider.isAvailable", () => {
  it("false when the sessions root is missing", () => {
    setRoot();
    vi.mocked(existsSync).mockReturnValue(false);
    expect(codexProvider.isAvailable()).toBe(false);
  });
  it("true when the root exists", () => {
    setRoot();
    vi.mocked(existsSync).mockReturnValue(true);
    expect(codexProvider.isAvailable()).toBe(true);
  });
});

describe("codexProvider.discoverSessions", () => {
  it("discovers a top-level session, grouped by cwd", () => {
    setRoot();
    mockTree({
      "rollout-2026-06-12T16-08-36-parent-uuid.jsonl": rollout([
        metaLine(),
        turnCtx("gpt-5.4"),
        userMsg(
          "<environment_context>\n  <cwd>/x</cwd>\n</environment_context>",
        ),
        userMsg("코덱스 이 프로젝트 분석해서 보고해"),
        tokenCount(258400, 64600),
      ]),
    });

    const tree = codexProvider.discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].name).toBe("myproject");
    expect(tree.projects[0].projectPath).toBe("/Users/neo/myproject");
    const s = tree.projects[0].sessions[0];
    expect(s.id).toBe("parent-uuid");
    expect(s.provider).toBe("codex");
    expect(s.modelName).toBe("gpt-5.4");
    // title = first non-environment_context user_message
    expect(s.firstUserPrompt).toBe("코덱스 이 프로젝트 분석해서 보고해");
    // context gauge: 64600 / 258400 = 25%
    expect(s.contextUsage?.percent).toBe(25);
    expect(s.contextUsage?.total).toBe(258400);
    expect(s.hideKey).toBe("myproject/parent-uuid");
  });

  it("links sub-agents to their parent via parent_thread_id", () => {
    setRoot();
    mockTree({
      "rollout-2026-06-12T16-08-36-parent-uuid.jsonl": rollout([
        metaLine(),
        turnCtx("gpt-5.4"),
        userMsg("main task"),
      ]),
      "rollout-2026-06-12T16-18-59-child-uuid.jsonl": rollout([
        metaLine({
          id: "child-uuid",
          parent_thread_id: "parent-uuid",
          agent_role: "explorer",
          agent_nickname: "Hubble",
          source: {
            subagent: {
              thread_spawn: { parent_thread_id: "parent-uuid", depth: 1 },
            },
          },
        }),
        turnCtx("gpt-5.4"),
        userMsg("review the data layer"),
      ]),
    });

    const tree = codexProvider.discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].sessions).toHaveLength(1);
    const parent = tree.projects[0].sessions[0];
    expect(parent.id).toBe("parent-uuid");
    expect(parent.subAgents).toHaveLength(1);
    expect(parent.subAgents[0].id).toBe("child-uuid");
    expect(parent.subAgents[0].taskDescription).toBe("review the data layer");
    expect(parent.subAgents[0].provider).toBe("codex");
    expect(tree.totalCount).toBe(2);
  });

  it("treats an older subagent without parent_thread_id as top-level (orphan)", () => {
    setRoot();
    mockTree({
      "rollout-2026-01-27T13-57-33-orphan-uuid.jsonl": rollout([
        metaLine({
          id: "orphan-uuid",
          source: { subagent: "review" }, // older bare-string form, no parent
        }),
        userMsg("an old sub-agent task"),
      ]),
    });

    const tree = codexProvider.discoverSessions(mockConfig);
    // surfaced, not dropped
    const all = [
      ...tree.projects.flatMap((p) => p.sessions),
      ...tree.coldProjects.flatMap((p) => p.sessions),
    ];
    expect(all.map((s) => s.id)).toContain("orphan-uuid");
  });

  it("respects hiddenSessions config", () => {
    setRoot();
    mockTree({
      "rollout-2026-06-12T16-08-36-parent-uuid.jsonl": rollout([
        metaLine(),
        userMsg("task"),
      ]),
    });
    const tree = codexProvider.discoverSessions({
      ...mockConfig,
      hiddenSessions: ["myproject/parent-uuid"],
    });
    expect(tree.projects[0].sessions[0].hidden).toBe(true);
    expect(tree.hiddenStats.total).toBe(1);
  });

  it("empty tree when the root is missing", () => {
    setRoot();
    vi.mocked(existsSync).mockReturnValue(false);
    const tree = codexProvider.discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(0);
    expect(tree.totalCount).toBe(0);
  });

  it("captures cli_version onto SessionNode.version", () => {
    setRoot();
    mockTree({
      "rollout-2026-06-12T16-08-36-version-uuid.jsonl": rollout([
        metaLine({ id: "version-uuid" }),
        userMsg("check the version"),
      ]),
    });
    const tree = codexProvider.discoverSessions(mockConfig);
    const node =
      tree.projects[0]?.sessions[0] ?? tree.coldProjects[0]?.sessions[0];
    expect(node?.version).toBe("0.121.0");
  });
});

describe("parseCodexActivities", () => {
  it("maps user_message / agent_message events to activities", () => {
    const lines = rollout([
      metaLine(),
      userMsg("do the thing"),
      {
        type: "event_msg",
        timestamp: "2026-06-12T06:09:00.000Z",
        payload: { type: "agent_message", message: "On it." },
      },
    ]).split("\n");
    const { activities } = parseCodexActivities(lines);
    expect(activities).toHaveLength(2);
    expect(activities[0].type).toBe("user");
    expect(activities[0].detail).toBe("do the thing");
    expect(activities[1].type).toBe("response");
    expect(activities[1].detail).toBe("On it.");
  });

  it("maps exec_command function calls to Bash activities", () => {
    const lines = rollout([
      {
        type: "response_item",
        timestamp: "2026-06-12T06:09:10.000Z",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "c1",
          arguments: JSON.stringify({ cmd: "npm test", workdir: "/x" }),
        },
      },
    ]).split("\n");
    const { activities } = parseCodexActivities(lines);
    expect(activities).toHaveLength(1);
    expect(activities[0].type).toBe("tool");
    expect(activities[0].label).toBe("Bash");
    expect(activities[0].detail).toBe("npm test");
  });

  it("maps spawn_agent to a Task activity", () => {
    const lines = rollout([
      {
        type: "response_item",
        timestamp: "2026-06-12T06:09:20.000Z",
        payload: {
          type: "function_call",
          name: "spawn_agent",
          call_id: "c2",
          arguments: JSON.stringify({
            agent_type: "explorer",
            message: "review the data layer for bugs",
          }),
        },
      },
    ]).split("\n");
    const { activities } = parseCodexActivities(lines);
    expect(activities[0].type).toBe("tool");
    expect(activities[0].label).toBe("Task");
    expect(activities[0].detail).toBe("review the data layer for bugs");
  });

  it("skips the synthetic environment_context first message", () => {
    const lines = rollout([
      userMsg("<environment_context>\n<cwd>/x</cwd>\n</environment_context>"),
      userMsg("real prompt"),
    ]).split("\n");
    const { activities } = parseCodexActivities(lines);
    expect(activities).toHaveLength(1);
    expect(activities[0].detail).toBe("real prompt");
  });

  it("tolerates malformed lines", () => {
    const { activities } = parseCodexActivities(["not json", "{}", ""]);
    expect(activities).toHaveLength(0);
  });
});
