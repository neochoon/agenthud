import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  clearDshCaches,
  decodeZstdFrames,
  dshProvider,
  getDshSessionsDir,
  isDshSessionPath,
  listZstdFrames,
  parseDshActivities,
  parseDshProjection,
  parseDshSessionHead,
  pickSessionLog,
  readDshRecords,
  readResultFile,
  zstdFrameEnd,
} = await import("../../../src/data/providers/dsh.js");

const zstdCompressSync = (
  zlib as unknown as { zstdCompressSync?: (buf: Buffer) => Buffer }
).zstdCompressSync;
const hasZstd = typeof zstdCompressSync === "function";

const NOW = 1_700_000_000_000;

const mockConfig = {
  refreshIntervalMs: 2000,
  hiddenSessions: [] as string[],
  hiddenSubAgents: [] as string[],
  filterPresets: [[]] as string[][],
  hiddenProjects: [] as string[],
};

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agenthud-dsh-"));
  process.env.DSH_HOME = home;
  delete process.env.DSH_SESSIONS_DIR;
  clearDshCaches();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  clearDshCaches();
  delete process.env.DSH_HOME;
  delete process.env.DSH_SESSIONS_DIR;
  rmSync(home, { recursive: true, force: true });
});

// --- fixtures --------------------------------------------------------------

function sessionHead(over: Record<string, unknown> = {}) {
  return {
    type: "session",
    version: 4,
    id: "session-aaaa1111-2222-3333-4444-555566667777",
    createdAt: NOW - 60_000,
    cwd: join("C:", "work", "myproject"),
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: "standard",
    ...over,
  };
}

function jsonl(records: object[]): string {
  return `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
}

/** Write `<sessions>/<projectDir>/<sessionId>/<fileName>`. */
function writeSession(
  projectDir: string,
  sessionId: string,
  body: string,
  fileName = "session.v4.jsonl",
): string {
  const dir = join(getDshSessionsDir(), projectDir, sessionId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, fileName);
  writeFileSync(path, body);
  return path;
}

/** Write a zstd log made of one frame per record batch, exactly how DSH
 * appends (one concatenated frame per commit). */
function writeFramedSession(
  projectDir: string,
  sessionId: string,
  batches: object[][],
): string {
  const compress = zstdCompressSync as (b: Buffer) => Buffer;
  const dir = join(getDshSessionsDir(), projectDir, sessionId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "session.v4.jsonl.zstd");
  const buffers = batches.map((batch) =>
    compress(Buffer.from(jsonl(batch), "utf-8")),
  );
  writeFileSync(path, Buffer.concat(buffers));
  return path;
}

/** Write the projection-cache file DSH keeps per session. */
function writeProjectionCache(
  sessionId: string,
  rows: Record<string, unknown>,
): void {
  const dir = join(home, "storages", "session_projcache", "sessions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sessionId}.json`),
    JSON.stringify({ version: 7, record: { rows } }),
  );
}

// --- zstd frame decoding ---------------------------------------------------

describe("decodeZstdFrames", () => {
  it.skipIf(!hasZstd)("decodes a single frame", () => {
    const compress = zstdCompressSync as (b: Buffer) => Buffer;
    const buf = compress(Buffer.from('{"a":1}\n', "utf-8"));
    expect(decodeZstdFrames(buf)).toBe('{"a":1}\n');
  });

  it.skipIf(!hasZstd)("decodes concatenated frames in order", () => {
    const compress = zstdCompressSync as (b: Buffer) => Buffer;
    const buf = Buffer.concat([
      compress(Buffer.from("one\n", "utf-8")),
      compress(Buffer.from("two\n", "utf-8")),
      compress(Buffer.from("three\n", "utf-8")),
    ]);
    // node:zlib alone would stop after the first frame — this is the
    // reason the provider splits frames itself.
    expect(decodeZstdFrames(buf)).toBe("one\ntwo\nthree\n");
  });

  it.skipIf(!hasZstd)("reports an incomplete trailing frame as null", () => {
    const compress = zstdCompressSync as (b: Buffer) => Buffer;
    const frame = compress(Buffer.from("still being written\n", "utf-8"));
    const partial = frame.subarray(0, frame.length - 6);
    // The structural walk (unlike a decoder call, which returns the
    // partial block content) knows the frame is not complete yet.
    expect(zstdFrameEnd(partial, 0)).toBeNull();
    expect(zstdFrameEnd(frame, 0)).toBe(frame.length);
  });

  it.skipIf(!hasZstd)("keeps earlier frames when the tail is torn", () => {
    const compress = zstdCompressSync as (b: Buffer) => Buffer;
    const complete = compress(Buffer.from('{"kept":true}\n', "utf-8"));
    const torn = compress(Buffer.from('{"torn":true}\n', "utf-8"));
    const buf = Buffer.concat([complete, torn.subarray(0, 8)]);
    const frames = listZstdFrames(buf);
    expect(frames).toHaveLength(1);
    expect(decodeZstdFrames(buf)).toBe('{"kept":true}\n');
  });

  it("returns empty string for non-zstd input", () => {
    expect(decodeZstdFrames(Buffer.from("plain text\n", "utf-8"))).toBe("");
    expect(decodeZstdFrames(Buffer.alloc(0))).toBe("");
  });
});

describe("readDshRecords", () => {
  it("reads a plain (uncompressed) log as lines", () => {
    const path = writeSession("proj", "s1", jsonl([sessionHead()]));
    expect(readDshRecords(path)).toHaveLength(1);
  });

  it.skipIf(!hasZstd)("reads every frame of a multi-frame log", () => {
    const path = writeFramedSession("proj", "s2", [
      [sessionHead({ id: "s2" })],
      [{ type: "turn/start", seq: 1, time: NOW, data: { turn: 1 } }],
      [{ type: "turn/end", seq: 2, time: NOW, data: { turn: 1 } }],
    ]);
    const records = readDshRecords(path);
    expect(records).toHaveLength(3);
    expect(JSON.parse(records[0]).id).toBe("s2");
    expect(JSON.parse(records[2]).type).toBe("turn/end");
  });

  it.skipIf(!hasZstd)("keeps the newest records within the byte budget", () => {
    const path = writeFramedSession("proj", "s3", [
      [{ type: "old", seq: 1, time: NOW + 1 }],
      [{ type: "new", seq: 2, time: NOW + 2 }],
    ]);
    // A budget smaller than the second frame forces the older frame out.
    const records = readDshRecords(path, 10);
    expect(records).toHaveLength(1);
    expect(JSON.parse(records[0]).type).toBe("new");
  });
});

// --- header / cache parsing ------------------------------------------------

describe("parseDshSessionHead", () => {
  it("extracts the fields the tree needs", () => {
    const head = parseDshSessionHead(
      JSON.stringify({
        type: "session",
        version: 4,
        id: "session-1",
        cwd: "C:\\work\\proj",
        createdAt: 123,
        parentSession: "session-parent",
        origin: "subagent",
        delegationDepth: 1,
        agentPreset: "minimal",
      }),
    );
    expect(head).toEqual({
      id: "session-1",
      version: 4,
      cwd: "C:\\work\\proj",
      createdAt: 123,
      parentSession: "session-parent",
      origin: "subagent",
      delegationDepth: 1,
      agentPreset: "minimal",
    });
  });

  it("defaults the optional fields", () => {
    const head = parseDshSessionHead(
      JSON.stringify({ type: "session", id: "bare", version: 0 }),
    );
    expect(head?.parentSession).toBeNull();
    expect(head?.origin).toBeNull();
    expect(head?.delegationDepth).toBe(0);
    expect(head?.cwd).toBe("");
  });

  it("rejects non-session and malformed records", () => {
    expect(
      parseDshSessionHead(JSON.stringify({ type: "turn/end" })),
    ).toBeNull();
    expect(parseDshSessionHead("{not json")).toBeNull();
  });
});

describe("pickSessionLog", () => {
  it("prefers the newest format version", () => {
    expect(
      pickSessionLog([
        "session.jsonl.zstd",
        "session.v3.jsonl.zstd",
        "session.v4.jsonl.zstd",
      ]),
    ).toBe("session.v4.jsonl.zstd");
  });

  it("prefers a compressed log for the same version", () => {
    expect(pickSessionLog(["session.v4.jsonl", "session.v4.jsonl.zstd"])).toBe(
      "session.v4.jsonl.zstd",
    );
  });

  it("ignores unrelated files and returns null", () => {
    expect(pickSessionLog(["notes.txt", "session.lock"])).toBeNull();
  });
});

describe("parseDshProjection", () => {
  it("maps title, model, context gauge and open step", () => {
    const projection = parseDshProjection({
      record: {
        rows: {
          title: { val: "了解项目并评估接入dsh" },
          modelSelection: {
            val: {
              lastUsed: { provider: "workbudddy", model: "cn:deepseek-v4" },
            },
          },
          contextPressure: {
            val: { surfaceTokens: 250_000, contextWindow: 1_000_000 },
          },
          sessionStats: { val: { turns: 3, openStep: { step: 4 } } },
        },
      },
    });
    expect(projection).toEqual({
      title: "了解项目并评估接入dsh",
      model: "cn:deepseek-v4",
      contextUsage: { used: 250_000, total: 1_000_000, percent: 25 },
      openStep: true,
      turns: 3,
    });
  });

  it("treats an explicit null openStep as idle", () => {
    const projection = parseDshProjection({
      record: { rows: { sessionStats: { val: { turns: 2, openStep: null } } } },
    });
    expect(projection?.openStep).toBe(false);
  });

  it("returns null when the record is missing", () => {
    expect(parseDshProjection({})).toBeNull();
    expect(parseDshProjection(null)).toBeNull();
  });
});

describe("readResultFile", () => {
  it("unwraps the numbered <content> block", () => {
    const text = [
      "<path>C:\\work\\a.ts</path>",
      "<type>file</type>",
      "<content>",
      "41: const a = 1;",
      "42: const b = 2;",
      "</content>",
    ].join("\n");
    expect(readResultFile(text)).toEqual({
      content: "const a = 1;\nconst b = 2;",
      startLine: 41,
    });
  });

  it("returns null without a content wrapper", () => {
    expect(readResultFile("exit code: 0")).toBeNull();
  });
});

// --- activity mapping ------------------------------------------------------

function activityLines(records: object[]): string[] {
  return jsonl(records).split("\n").filter(Boolean);
}

function userMessage(text: string, kind = "user") {
  return {
    type: "user/message",
    seq: 1,
    time: NOW,
    data: {
      content: [{ type: "text", text }],
      source: { kind },
      role: "user",
      id: "u1",
    },
  };
}

describe("parseDshActivities", () => {
  it("maps a user prompt and injected context separately", () => {
    const { activities } = parseDshActivities(
      activityLines([
        sessionHead(),
        userMessage("hi there", "runtime-context"),
        userMessage("do the thing"),
      ]),
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].type).toBe("user");
    expect(activities[0].detail).toBe("do the thing");
  });

  it("counts user-approval and goal messages as user input", () => {
    const { activities } = parseDshActivities(
      activityLines([
        userMessage("approval policy changed", "user-approval"),
        userMessage("new goal", "goal"),
      ]),
    );
    expect(activities.map((a) => a.detail)).toEqual([
      "approval policy changed",
      "new goal",
    ]);
  });

  it("maps assistant reasoning and text blocks", () => {
    const { activities } = parseDshActivities(
      activityLines([
        {
          type: "assistant/message",
          seq: 2,
          time: NOW,
          data: {
            turn: 1,
            step: 1,
            usage: {
              inputTokens: 100,
              cacheReadTokens: 900,
              outputTokens: 20,
            },
            message: {
              role: "assistant",
              content: [
                { type: "reasoning", text: "Check the tests first." },
                { type: "text", text: "Running the suite now." },
              ],
            },
          },
        },
      ]),
    );
    expect(activities.map((a) => `${a.label}:${a.detail}`)).toEqual([
      "Thinking:Check the tests first.",
      "Response:Running the suite now.",
    ]);
    const { tokenCount } = parseDshActivities(
      activityLines([
        {
          type: "assistant/message",
          seq: 2,
          time: NOW,
          data: {
            usage: {
              inputTokens: 100,
              cacheReadTokens: 900,
              outputTokens: 20,
            },
            message: { role: "assistant", content: [] },
          },
        },
      ]),
    );
    expect(tokenCount).toBe(1020);
  });

  it("does not double-count tool-call content blocks", () => {
    const lines = activityLines([
      {
        type: "assistant/message",
        seq: 1,
        time: NOW,
        data: {
          message: {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                id: "call-1",
                name: "pwsh",
                arguments: '{"command":"git status"}',
              },
            ],
          },
        },
      },
      {
        type: "tool/call",
        seq: 2,
        time: NOW,
        data: {
          callId: "call-1",
          name: "pwsh",
          arguments: '{"command":"git status"}',
        },
      },
    ]);
    const { activities } = parseDshActivities(lines);
    expect(activities).toHaveLength(1);
    expect(activities[0].label).toBe("Bash");
    expect(activities[0].detail).toBe("git status");
  });

  it("canonicalizes tool names and merges consecutive identical calls", () => {
    const call = (callId: string) => ({
      type: "tool/call",
      seq: 1,
      time: NOW,
      data: {
        callId,
        name: "read",
        arguments: '{"file_path":"C:\\\\w\\\\a.ts"}',
      },
    });
    const { activities } = parseDshActivities(
      activityLines([call("c1"), call("c2"), call("c3")]),
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].label).toBe("Read");
    expect(activities[0].detail).toBe("a.ts");
    expect(activities[0].count).toBe(3);
  });

  it("skips TodoWrite noise, like the Claude parser", () => {
    const { activities } = parseDshActivities(
      activityLines([
        {
          type: "tool/call",
          seq: 1,
          time: NOW,
          data: { callId: "c1", name: "todo_write", arguments: "{}" },
        },
      ]),
    );
    expect(activities).toHaveLength(0);
  });

  it("renders a Read body from its tool result", () => {
    const { activities } = parseDshActivities(
      activityLines([
        {
          type: "tool/call",
          seq: 1,
          time: NOW,
          data: {
            callId: "c1",
            name: "read",
            arguments: '{"file_path":"C:\\\\w\\\\a.ts"}',
          },
        },
        {
          type: "tool/result",
          seq: 2,
          time: NOW + 1,
          data: {
            message: {
              role: "tool",
              toolCallId: "c1",
              isError: false,
              content: [
                {
                  type: "text",
                  text: "<path>C:\\w\\a.ts</path>\n<type>file</type>\n<content>\n1: const a = 1;\n</content>",
                },
              ],
            },
          },
        },
      ]),
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].detailBody).toBe("1: const a = 1;");
    expect(activities[0].detailKind).toBe("code");
    expect(activities[0].detailNumbered).toBe(true);
  });

  it("keeps a failed tool result visible with its detail", () => {
    const { activities } = parseDshActivities(
      activityLines([
        {
          type: "tool/call",
          seq: 1,
          time: NOW,
          data: {
            callId: "c1",
            name: "pwsh",
            arguments: '{"command":"false"}',
          },
        },
        {
          type: "tool/result",
          seq: 2,
          time: NOW + 1,
          data: {
            message: {
              role: "tool",
              toolCallId: "c1",
              isError: true,
              content: [{ type: "text", text: "exit code: 1" }],
            },
          },
        },
      ]),
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].detail).toBe("false");
    expect(activities[0].detailBody).toContain("exit code: 1");
  });

  it("takes the model and start time from the log", () => {
    const { modelName, sessionStartTime } = parseDshActivities(
      activityLines([
        sessionHead({ createdAt: 1234 }),
        {
          type: "request/header",
          seq: 1,
          time: NOW,
          data: { header: { config: { model: "cn:deepseek-v4.1" } } },
        },
      ]),
    );
    expect(modelName).toBe("cn:deepseek-v4.1");
    expect(sessionStartTime?.getTime()).toBe(1234);
  });

  it("tolerates malformed lines", () => {
    const { activities } = parseDshActivities(["not json", "{}", ""]);
    expect(activities).toHaveLength(0);
  });
});

// --- discovery -------------------------------------------------------------

describe("dshProvider.discoverSessions", () => {
  it("groups sessions by cwd and stamps the provider + version", () => {
    const cwd = join("C:", "work", "myproject");
    writeSession(
      "--C-work-myproject--",
      "session-aaaa1111-2222-3333-4444-555566667777",
      jsonl([sessionHead({ cwd })]),
    );

    const tree = dshProvider.discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].name).toBe("myproject");
    expect(tree.projects[0].projectPath).toBe(cwd);
    const node = tree.projects[0].sessions[0];
    expect(node.id).toBe("session-aaaa1111-2222-3333-4444-555566667777");
    expect(node.provider).toBe("dsh");
    expect(node.version).toBe("v4");
    expect(node.hideKey).toBe(`myproject/${node.id}`);
    expect(node.filePath.endsWith("session.v4.jsonl")).toBe(true);
    expect(tree.totalCount).toBe(1);
  });

  it("links a sub-agent to its parent via parentSession", () => {
    const cwd = join("C:", "work", "myproject");
    const parentId = "session-parent";
    writeSession("proj", parentId, jsonl([sessionHead({ id: parentId, cwd })]));
    writeSession(
      "proj",
      "session-child",
      jsonl([
        sessionHead({
          id: "session-child",
          cwd,
          parentSession: parentId,
          origin: "subagent",
          delegationDepth: 1,
        }),
      ]),
    );
    writeProjectionCache("session-child", {
      title: { val: "Side: review the data layer" },
    });

    const tree = dshProvider.discoverSessions(mockConfig);
    expect(tree.projects[0].sessions).toHaveLength(1);
    const parent = tree.projects[0].sessions[0];
    expect(parent.id).toBe(parentId);
    expect(parent.subAgents).toHaveLength(1);
    expect(parent.subAgents[0].agentId).toBe("session-child");
    expect(parent.subAgents[0].taskDescription).toBe(
      "Side: review the data layer",
    );
    expect(tree.totalCount).toBe(2);
  });

  it("surfaces an orphan sub-agent at top level", () => {
    writeSession(
      "proj",
      "session-orphan",
      jsonl([
        sessionHead({
          id: "session-orphan",
          parentSession: "session-missing",
          origin: "subagent",
          delegationDepth: 1,
        }),
      ]),
    );

    const tree = dshProvider.discoverSessions(mockConfig);
    const ids = [
      ...tree.projects.flatMap((p) => p.sessions.map((s) => s.id)),
      ...tree.coldProjects.flatMap((p) => p.sessions.map((s) => s.id)),
    ];
    expect(ids).toContain("session-orphan");
  });

  it("reads title, model, gauge and live state from the projection cache", () => {
    const id = "session-withcache";
    writeSession("proj", id, jsonl([sessionHead({ id })]));
    writeProjectionCache(id, {
      title: { val: "Fix the failing tests" },
      modelSelection: {
        val: { lastUsed: { model: "cn:deepseek-v4.1-flash" } },
      },
      contextPressure: {
        val: { surfaceTokens: 400_000, contextWindow: 1_000_000 },
      },
      sessionStats: { val: { turns: 2, openStep: { step: 3 } } },
    });

    const node =
      dshProvider.discoverSessions(mockConfig).projects[0].sessions[0];
    expect(node.firstUserPrompt).toBe("Fix the failing tests");
    expect(node.modelName).toBe("cn:deepseek-v4.1-flash");
    expect(node.contextUsage).toEqual({
      used: 400_000,
      total: 1_000_000,
      percent: 40,
    });
    expect(node.liveState).toBe("working");
  });

  it("reports waiting once the last step closed", () => {
    const id = "session-idle";
    writeSession("proj", id, jsonl([sessionHead({ id })]));
    writeProjectionCache(id, {
      sessionStats: { val: { turns: 1, openStep: null } },
    });
    const node =
      dshProvider.discoverSessions(mockConfig).projects[0].sessions[0];
    expect(node.liveState).toBe("waiting");
  });

  it("respects hiddenSessions / hiddenSubAgents", () => {
    const cwd = join("C:", "work", "myproject");
    writeSession(
      "proj",
      "session-h",
      jsonl([sessionHead({ id: "session-h", cwd })]),
    );

    const tree = dshProvider.discoverSessions({
      ...mockConfig,
      hiddenSessions: ["myproject/session-h"],
    });
    expect(tree.projects[0].sessions[0].hidden).toBe(true);
    expect(tree.hiddenStats.total).toBe(1);
    expect(tree.hiddenStats.active).toBe(1);
  });

  it("honours scopeToProject", () => {
    const keep = join("C:", "work", "keep");
    const drop = join("C:", "work", "drop");
    writeSession("a", "s-a", jsonl([sessionHead({ id: "s-a", cwd: keep })]));
    writeSession("b", "s-b", jsonl([sessionHead({ id: "s-b", cwd: drop })]));

    const tree = dshProvider.discoverSessions(mockConfig, {
      scopeToProjects: [keep],
    });
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].projectPath).toBe(keep);
  });

  it("splits cold projects out of the active list", () => {
    const coldCwd = join("C:", "work", "coldproject");
    const path = writeSession(
      "cold",
      "session-cold",
      jsonl([sessionHead({ id: "session-cold", cwd: coldCwd })]),
    );
    // Two days old → cold.
    const old = new Date(NOW - 2 * 24 * 60 * 60 * 1000);
    utimesSync(path, old, old);

    const tree = dshProvider.discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(0);
    expect(tree.coldProjects).toHaveLength(1);
    expect(tree.coldProjects[0].sessions[0].status).toBe("cold");
  });

  it("returns an empty tree when the sessions root is missing", () => {
    process.env.DSH_SESSIONS_DIR = join(home, "definitely-missing");
    const tree = dshProvider.discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(0);
    expect(tree.totalCount).toBe(0);
  });
});

describe("dshProvider.isAvailable", () => {
  it("false when the sessions root is missing", () => {
    expect(dshProvider.isAvailable()).toBe(false);
  });

  it("true when the root exists", () => {
    mkdirSync(getDshSessionsDir(), { recursive: true });
    expect(dshProvider.isAvailable()).toBe(true);
  });
});

describe("isDshSessionPath", () => {
  it("matches the sessions root and any zstd log", () => {
    mkdirSync(getDshSessionsDir(), { recursive: true });
    expect(
      isDshSessionPath(
        join(getDshSessionsDir(), "proj", "s", "session.v4.jsonl.zstd"),
      ),
    ).toBe(true);
    expect(
      isDshSessionPath(join("D:", "elsewhere", "session.v9.jsonl.zstd")),
    ).toBe(true);
  });

  it("rejects a plain Claude path", () => {
    expect(
      isDshSessionPath(
        join("C:", "home", ".claude", "projects", "p", "s.jsonl"),
      ),
    ).toBe(false);
  });
});
