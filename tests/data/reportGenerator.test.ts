import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry, SessionNode } from "../../src/types/index.js";

vi.mock("../../src/data/sessionHistory.js", () => ({
  parseSessionHistory: vi.fn(),
}));
vi.mock("node:fs", () => ({
  statSync: vi.fn(),
  existsSync: vi.fn(),
}));
vi.mock("../../src/data/gitCommits.js", () => ({
  parseGitCommits: vi.fn().mockReturnValue([]),
}));

const { parseSessionHistory } = await import(
  "../../src/data/sessionHistory.js"
);
const { statSync } = await import("node:fs");
const { parseGitCommits } = await import("../../src/data/gitCommits.js");
const { generateReport } = await import("../../src/data/reportGenerator.js");

const DAY = new Date(2026, 4, 14); // local midnight May 14

function localTime(isoUtc: string): string {
  const d = new Date(isoUtc);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function makeSession(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: "abc123",
    hideKey: "myproject/abc123",
    filePath: "/home/.claude/projects/-myproject/abc123.jsonl",
    projectPath: "/Users/neo/myproject",
    projectName: "myproject",
    lastModifiedMs: new Date("2026-05-14T10:00:00Z").getTime(),
    status: "hot",
    modelName: null,
    subAgents: [],
    ...overrides,
  };
}

function makeActivity(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    timestamp: new Date("2026-05-14T10:23:00Z"),
    type: "tool",
    icon: "$",
    label: "Bash",
    detail: "npm test",
    ...overrides,
  };
}

describe("generateReport", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseGitCommits).mockReturnValue([]);
  });
  it("returns no-activity message when no sessions match the date", () => {
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-13T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([]);

    const result = generateReport([makeSession()], {
      date: DAY,
      include: ["response", "bash", "edit", "thinking"],
    });
    expect(result).toBe("No activity found for 2026-05-14.");
  });

  it("includes session with activity on target date", () => {
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({
        type: "response",
        icon: "<",
        label: "Response",
        detail: "Did the thing.",
      }),
    ]);

    const result = generateReport([makeSession()], {
      date: DAY,
      include: ["response"],
    });
    expect(result).toContain("## myproject");
    expect(result).toContain(
      `[${localTime("2026-05-14T10:23:00Z")}] < Response: Did the thing.`,
    );
  });

  it("excludes activities not on target date", () => {
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({
        timestamp: new Date("2026-05-13T09:00:00Z"),
        type: "response",
        icon: "<",
        label: "Response",
        detail: "Yesterday.",
      }),
      makeActivity({
        timestamp: new Date("2026-05-14T11:00:00Z"),
        type: "response",
        icon: "<",
        label: "Response",
        detail: "Today.",
      }),
    ]);

    const result = generateReport([makeSession()], {
      date: DAY,
      include: ["response"],
    });
    expect(result).not.toContain("Yesterday.");
    expect(result).toContain("Today.");
  });

  it("excludes activity types not in include list", () => {
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({
        type: "tool",
        icon: "○",
        label: "Read",
        detail: "some/file.ts",
      }),
      makeActivity({
        type: "response",
        icon: "<",
        label: "Response",
        detail: "Done.",
      }),
    ]);

    const result = generateReport([makeSession()], {
      date: DAY,
      include: ["response"],
    });
    expect(result).not.toContain("Read");
    expect(result).toContain("Done.");
  });

  it("truncates detail to 120 chars", () => {
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    const longDetail = "x".repeat(200);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({
        type: "response",
        icon: "<",
        label: "Response",
        detail: longDetail,
      }),
    ]);

    const result = generateReport([makeSession()], {
      date: DAY,
      include: ["response"],
    });
    expect(result).toContain("x".repeat(120));
    expect(result).not.toContain("x".repeat(121));
  });

  it("respects detailLimit option", () => {
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    const longDetail = "y".repeat(500);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({
        type: "response",
        icon: "<",
        label: "Response",
        detail: longDetail,
      }),
    ]);

    const result = generateReport([makeSession()], {
      date: DAY,
      include: ["response"],
      detailLimit: 300,
    });
    expect(result).toContain("y".repeat(300));
    expect(result).not.toContain("y".repeat(301));
  });

  it("shows full detail when detailLimit is 0 (unlimited)", () => {
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    const longDetail = "z".repeat(2000);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({
        type: "response",
        icon: "<",
        label: "Response",
        detail: longDetail,
      }),
    ]);

    const result = generateReport([makeSession()], {
      date: DAY,
      include: ["response"],
      detailLimit: 0,
    });
    expect(result).toContain("z".repeat(2000));
  });

  it("includes report header with date", () => {
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({
        type: "response",
        icon: "<",
        label: "Response",
        detail: "Done.",
      }),
    ]);

    const result = generateReport([makeSession()], {
      date: DAY,
      include: ["response"],
    });
    expect(result).toContain("# AgentHUD Report: 2026-05-14");
  });

  it("sorts sessions by first activity timestamp", () => {
    const session1 = makeSession({
      projectName: "late-project",
      filePath: "/late.jsonl",
    });
    const session2 = makeSession({
      projectName: "early-project",
      filePath: "/early.jsonl",
    });

    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockImplementation((path) => {
      if (path === "/late.jsonl") {
        return [
          makeActivity({
            timestamp: new Date("2026-05-14T12:00:00Z"),
            type: "response",
            icon: "<",
            label: "Response",
            detail: "Late.",
          }),
        ];
      }
      return [
        makeActivity({
          timestamp: new Date("2026-05-14T08:00:00Z"),
          type: "response",
          icon: "<",
          label: "Response",
          detail: "Early.",
        }),
      ];
    });

    const result = generateReport([session1, session2], {
      date: DAY,
      include: ["response"],
    });
    const earlyIdx = result.indexOf("early-project");
    const lateIdx = result.indexOf("late-project");
    expect(earlyIdx).toBeLessThan(lateIdx);
  });

  it("includes time range in session header", () => {
    // Use offsets from local midnight so timestamps stay on the same local day in any timezone
    const ts1 = new Date(DAY.getTime() + 9 * 3600 * 1000); // 09:00 local
    const ts2 = new Date(DAY.getTime() + 14 * 3600 * 1000); // 14:00 local
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: ts1.getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({
        timestamp: ts1,
        type: "response",
        icon: "<",
        label: "Response",
        detail: "First.",
      }),
      makeActivity({
        timestamp: ts2,
        type: "response",
        icon: "<",
        label: "Response",
        detail: "Last.",
      }),
    ]);

    const fmt = (d: Date) =>
      `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

    const result = generateReport([makeSession()], {
      date: DAY,
      include: ["response"],
    });
    expect(result).toContain(`## myproject (${fmt(ts1)} – ${fmt(ts2)})`);
  });

  it("matches edit label variants for include:edit", () => {
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({
        type: "tool",
        icon: "~",
        label: "Write",
        detail: "file.ts",
      }),
      makeActivity({
        type: "tool",
        icon: "~",
        label: "TodoWrite",
        detail: "todo.md",
      }),
    ]);

    const result = generateReport([makeSession()], {
      date: DAY,
      include: ["edit"],
    });
    expect(result).toContain("Write");
    expect(result).toContain("TodoWrite");
  });

  it("matches glob/grep labels for include:read", () => {
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({ type: "tool", icon: "*", label: "Glob", detail: "*.ts" }),
      makeActivity({
        type: "tool",
        icon: "*",
        label: "Grep",
        detail: "pattern",
      }),
    ]);

    const result = generateReport([makeSession()], {
      date: DAY,
      include: ["read"],
    });
    expect(result).toContain("Glob");
    expect(result).toContain("Grep");
  });

  it("omits detail colon when detail is empty", () => {
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({
        type: "response",
        icon: "<",
        label: "Response",
        detail: "",
      }),
    ]);

    const result = generateReport([makeSession()], {
      date: DAY,
      include: ["response"],
    });
    const t = localTime("2026-05-14T10:23:00Z");
    expect(result).toContain(`[${t}] < Response`);
    expect(result).not.toContain(`[${t}] < Response:`);
  });

  it("outputs valid JSON when format is json", () => {
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({
        type: "response",
        icon: "<",
        label: "Response",
        detail: "Done.",
      }),
    ]);

    const result = generateReport([makeSession()], {
      date: DAY,
      include: ["response"],
      format: "json",
    });
    const parsed = JSON.parse(result);
    expect(parsed.date).toBe("2026-05-14");
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0].project).toBe("myproject");
    const t = localTime("2026-05-14T10:23:00Z");
    expect(parsed.sessions[0].start).toBe(t);
    expect(parsed.sessions[0].activities[0]).toEqual({
      time: t,
      icon: "<",
      label: "Response",
      detail: "Done.",
    });
  });

  it("outputs empty sessions array as JSON when no activity found", () => {
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-13T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([]);

    const result = generateReport([makeSession()], {
      date: DAY,
      include: ["response"],
      format: "json",
    });
    const parsed = JSON.parse(result);
    expect(parsed.date).toBe("2026-05-14");
    expect(parsed.sessions).toHaveLength(0);
  });

  it("nests sub-agents under parent in JSON format", () => {
    const subAgent = makeSession({
      id: "child1",
      hideKey: "myproject/child1",
      filePath: "/child1.jsonl",
      projectName: "",
      agentId: "a1b2c3",
      taskDescription: "Review the code",
      subAgents: [],
    });
    const parent = makeSession({ subAgents: [subAgent] });

    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({
        type: "response",
        icon: "<",
        label: "Response",
        detail: "Done.",
      }),
    ]);

    const result = generateReport([parent], {
      date: DAY,
      include: ["response"],
      format: "json",
    });
    const parsed = JSON.parse(result);
    expect(parsed.sessions[0].subAgents).toHaveLength(1);
    expect(parsed.sessions[0].subAgents[0].agentId).toBe("a1b2c3");
    expect(parsed.sessions[0].subAgents[0].taskDescription).toBe(
      "Review the code",
    );
    expect(parsed.sessions[0].subAgents[0].activities).toBeDefined();
  });

  it("omits subAgents key in markdown format", () => {
    const subAgent = makeSession({
      id: "child1",
      hideKey: "myproject/child1",
      filePath: "/child1.jsonl",
      projectName: "",
      subAgents: [],
    });
    const parent = makeSession({ subAgents: [subAgent] });

    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({
        type: "response",
        icon: "<",
        label: "Response",
        detail: "Done.",
      }),
    ]);

    const result = generateReport([parent], {
      date: DAY,
      include: ["response"],
    });
    expect(result).not.toContain("subAgents");
  });

  it("merges git commits into activity timeline when withGit is true", () => {
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({
        type: "response",
        icon: "<",
        label: "Response",
        detail: "Done.",
      }),
    ]);
    vi.mocked(parseGitCommits).mockReturnValue([
      {
        timestamp: new Date(2026, 4, 14, 11, 0),
        type: "commit",
        icon: "◆",
        label: "abc1234",
        detail: "feat: add report command",
      },
    ]);

    const result = generateReport([makeSession()], {
      date: DAY,
      include: ["response"],
      withGit: true,
    });
    expect(result).toContain("◆ abc1234: feat: add report command");
    expect(vi.mocked(parseGitCommits)).toHaveBeenCalledWith(
      "/Users/neo/myproject",
      DAY,
    );
  });

  it("does not call parseGitCommits when withGit is false", () => {
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: new Date("2026-05-14T10:00:00Z").getTime(),
    } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({
        type: "response",
        icon: "<",
        label: "Response",
        detail: "Done.",
      }),
    ]);

    generateReport([makeSession()], { date: DAY, include: ["response"] });
    expect(vi.mocked(parseGitCommits)).not.toHaveBeenCalled();
  });
});
