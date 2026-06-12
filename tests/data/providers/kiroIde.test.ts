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
const { kiroIdeProvider, parseKiroIdeActivities } = await import(
  "../../../src/data/providers/kiro-ide.js"
);

const NOW = 1_700_000_000_000;

const mockConfig = {
  refreshIntervalMs: 2000,
  hiddenSessions: [] as string[],
  hiddenSubAgents: [] as string[],
  filterPresets: [[]] as string[][],
  hiddenProjects: [] as string[],
};

// The env override points the provider at a fixed root so tests are
// platform-independent (the macOS default lives under
// ~/Library/Application Support which doesn't exist on CI Linux).
const ROOT = join("/tmp", "kiro-ide-test", "workspace-sessions");

function setRoot() {
  process.env.KIRO_IDE_SESSIONS_DIR = ROOT;
}

afterEach(() => {
  vi.resetAllMocks();
  delete process.env.KIRO_IDE_SESSIONS_DIR;
});

const WS_B64 = Buffer.from("/Users/neo/myproject").toString("base64");

function sessionJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    sessionId: "ide-1111",
    title: "Refactor the auth flow",
    workspaceDirectory: "/Users/neo/myproject",
    selectedModel: "auto",
    contextUsagePercentage: 12.34,
    active: false,
    sessionType: "vibe",
    history: [
      {
        message: {
          role: "user",
          content: [{ type: "text", text: "hello." }],
          id: "m1",
        },
      },
      {
        message: { role: "assistant", content: "On it.", id: "m2" },
        executionId: "e1",
      },
    ],
    ...overrides,
  });
}

function indexJson() {
  return JSON.stringify([
    {
      sessionId: "ide-1111",
      title: "Refactor the auth flow",
      dateCreated: String(NOW - 100_000),
      workspaceDirectory: "/Users/neo/myproject",
    },
  ]);
}

describe("kiroIdeProvider.isAvailable", () => {
  it("returns false when the storage root does not exist", () => {
    setRoot();
    vi.mocked(existsSync).mockReturnValue(false);
    expect(kiroIdeProvider.isAvailable()).toBe(false);
  });

  it("returns true when the root exists", () => {
    setRoot();
    vi.mocked(existsSync).mockReturnValue(true);
    expect(kiroIdeProvider.isAvailable()).toBe(true);
  });
});

describe("kiroIdeProvider.discoverSessions", () => {
  it("discovers a session from the workspace index and groups by workspaceDirectory", () => {
    setRoot();
    const wsDir = join(ROOT, WS_B64);
    const sessFile = join(wsDir, "ide-1111.json");

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === ROOT)
        return [WS_B64] as unknown as ReturnType<typeof readdirSync>;
      if (path === wsDir)
        return ["sessions.json", "ide-1111.json"] as unknown as ReturnType<
          typeof readdirSync
        >;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation((p) => {
      const path = String(p);
      return {
        isDirectory: () => !path.endsWith(".json"),
        mtimeMs: NOW - 60_000,
        size: 1000,
      } as ReturnType<typeof statSync>;
    });
    vi.mocked(readFileSync).mockImplementation((p) => {
      const path = String(p);
      if (path === join(wsDir, "sessions.json")) return indexJson();
      if (path === sessFile) return sessionJson();
      return "";
    });
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = kiroIdeProvider.discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].name).toBe("myproject");
    expect(tree.projects[0].projectPath).toBe("/Users/neo/myproject");
    const s = tree.projects[0].sessions[0];
    expect(s.id).toBe("ide-1111");
    expect(s.firstUserPrompt).toBe("Refactor the auth flow");
    expect(s.modelName).toBe("auto");
    expect(s.provider).toBe("kiro-ide");
    expect(s.hideKey).toBe("myproject/ide-1111");
  });

  it("extracts contextUsage percent (200K assumed window)", () => {
    setRoot();
    const wsDir = join(ROOT, WS_B64);

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === ROOT)
        return [WS_B64] as unknown as ReturnType<typeof readdirSync>;
      if (path === wsDir)
        return ["sessions.json", "ide-1111.json"] as unknown as ReturnType<
          typeof readdirSync
        >;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation(
      (p) =>
        ({
          isDirectory: () => !String(p).endsWith(".json"),
          mtimeMs: NOW - 60_000,
          size: 100,
        }) as ReturnType<typeof statSync>,
    );
    vi.mocked(readFileSync).mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("sessions.json")) return indexJson();
      if (path.endsWith("ide-1111.json"))
        return sessionJson({ contextUsagePercentage: 42.6 });
      return "";
    });
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = kiroIdeProvider.discoverSessions(mockConfig);
    const ctx = tree.projects[0].sessions[0].contextUsage;
    expect(ctx?.percent).toBe(43);
    expect(ctx?.total).toBe(200_000);
  });

  it("marks hidden sessions but keeps them in the tree", () => {
    setRoot();
    const wsDir = join(ROOT, WS_B64);

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockImplementation((p) => {
      const path = String(p);
      if (path === ROOT)
        return [WS_B64] as unknown as ReturnType<typeof readdirSync>;
      if (path === wsDir)
        return ["sessions.json", "ide-1111.json"] as unknown as ReturnType<
          typeof readdirSync
        >;
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    vi.mocked(statSync).mockImplementation(
      (p) =>
        ({
          isDirectory: () => !String(p).endsWith(".json"),
          mtimeMs: NOW - 60_000,
          size: 100,
        }) as ReturnType<typeof statSync>,
    );
    vi.mocked(readFileSync).mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("sessions.json")) return indexJson();
      if (path.endsWith("ide-1111.json")) return sessionJson();
      return "";
    });
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    const tree = kiroIdeProvider.discoverSessions({
      ...mockConfig,
      hiddenSessions: ["myproject/ide-1111"],
    });
    expect(tree.projects[0].sessions[0].hidden).toBe(true);
    expect(tree.hiddenStats.total).toBe(1);
  });

  it("returns empty tree when the root is missing", () => {
    setRoot();
    vi.mocked(existsSync).mockReturnValue(false);
    const tree = kiroIdeProvider.discoverSessions(mockConfig);
    expect(tree.projects).toHaveLength(0);
    expect(tree.totalCount).toBe(0);
  });
});

describe("parseKiroIdeActivities", () => {
  it("maps history user/assistant entries to activities", () => {
    const lines = sessionJson().split("\n");
    const { activities } = parseKiroIdeActivities(lines);
    expect(activities).toHaveLength(2);
    expect(activities[0].type).toBe("user");
    expect(activities[0].detail).toBe("hello.");
    expect(activities[1].type).toBe("response");
    expect(activities[1].detail).toBe("On it.");
  });

  it("handles assistant content as plain string and user content as block array", () => {
    const json = sessionJson({
      history: [
        {
          message: {
            role: "user",
            content: [
              { type: "text", text: "first line" },
              { type: "text", text: "second block" },
            ],
            id: "m1",
          },
        },
        {
          message: {
            role: "assistant",
            content: "multi\nline\nanswer",
            id: "m2",
          },
        },
      ],
    });
    const { activities } = parseKiroIdeActivities([json]);
    expect(activities[0].detail).toBe("first line");
    expect(activities[1].detail).toBe("multi");
    expect(activities[1].detailBody).toBe("multi\nline\nanswer");
  });

  it("returns empty result on malformed JSON", () => {
    const { activities } = parseKiroIdeActivities(["not json at all"]);
    expect(activities).toHaveLength(0);
  });
});
