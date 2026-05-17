import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
const {
  loadGlobalConfig,
  DEFAULT_GLOBAL_CONFIG,
  hideSession,
  hideSubAgent,
  hideProject,
  hasProjectLevelConfig,
} = await import("../../src/config/globalConfig.js");

const STATE_PATH = join(homedir(), ".agenthud", "state.yaml");
const CONFIG_PATH = join(homedir(), ".agenthud", "config.yaml");

afterEach(() => {
  vi.resetAllMocks();
});

describe("loadGlobalConfig", () => {
  it("returns defaults when config file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(writeFileSync).mockImplementation(() => {});
    const config = loadGlobalConfig();
    expect(config.refreshIntervalMs).toBe(2000);
    expect(config.hiddenSessions).toEqual([]);
    expect(config.hiddenSubAgents).toEqual([]);
    expect(config.hiddenProjects).toEqual([]);
  });

  it("overrides refreshInterval from config file", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith("config.yaml"),
    );
    vi.mocked(readFileSync).mockReturnValue("refreshInterval: 5s\n");
    const config = loadGlobalConfig();
    expect(config.refreshIntervalMs).toBe(5000);
  });

  it("ignores unknown keys", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith("config.yaml"),
    );
    vi.mocked(readFileSync).mockReturnValue("unknownKey: value\n");
    const config = loadGlobalConfig();
    expect(config).toEqual(expect.objectContaining(DEFAULT_GLOBAL_CONFIG));
  });

  it("reads hide fields from state.yaml", () => {
    const stateYaml = `hiddenSessions:
  - foo/bar
hiddenProjects:
  - secret
`;
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith("state.yaml"),
    );
    vi.mocked(readFileSync).mockReturnValue(stateYaml);

    const config = loadGlobalConfig();
    expect(config.hiddenSessions).toEqual(["foo/bar"]);
    expect(config.hiddenProjects).toEqual(["secret"]);
  });

  it("reads hiddenSubAgents from state.yaml", () => {
    const stateYaml = `hiddenSubAgents:
  - agent-xyz
`;
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith("state.yaml"),
    );
    vi.mocked(readFileSync).mockReturnValue(stateYaml);

    const config = loadGlobalConfig();
    expect(config.hiddenSubAgents).toEqual(["agent-xyz"]);
  });

  it("defaults hiddenProjects to empty array when neither file exists", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(writeFileSync).mockImplementation(() => {});
    const config = loadGlobalConfig();
    expect(config.hiddenProjects).toEqual([]);
  });

  it("migrates hide fields from config.yaml to state.yaml on first load", () => {
    const configYaml = `refreshInterval: 5s
hiddenSessions:
  - migrate-me
`;
    vi.mocked(existsSync).mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("config.yaml") || s === join(homedir(), ".agenthud");
    });
    vi.mocked(readFileSync).mockImplementation((p) =>
      String(p).endsWith("config.yaml") ? configYaml : "",
    );

    const writeCalls: { path: string; content: string }[] = [];
    vi.mocked(writeFileSync).mockImplementation((p, c) => {
      writeCalls.push({ path: String(p), content: String(c) });
    });

    const config = loadGlobalConfig();
    expect(config.hiddenSessions).toEqual(["migrate-me"]);

    // Should have written state.yaml AND rewritten config.yaml without hide field
    const stateWrite = writeCalls.find((w) => w.path.endsWith("state.yaml"));
    const configWrite = writeCalls.find((w) => w.path.endsWith("config.yaml"));
    expect(stateWrite?.content).toContain("migrate-me");
    expect(configWrite?.content).not.toContain("hiddenSessions");
    expect(configWrite?.content).toContain("refreshInterval"); // config field preserved
  });

  it("auto-creates config.yaml with defaults when missing", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const writeCalls: { path: string; content: string }[] = [];
    vi.mocked(writeFileSync).mockImplementation((p, c) => {
      writeCalls.push({ path: String(p), content: String(c) });
    });

    loadGlobalConfig();

    const configWrite = writeCalls.find((w) => w.path.endsWith("config.yaml"));
    expect(configWrite).toBeDefined();
    expect(configWrite!.content).toContain("refreshInterval");
    expect(configWrite!.content).toContain("filterPresets");
    // Should NOT contain hide fields (those live in state.yaml)
    expect(configWrite!.content).not.toContain("hiddenSessions");
  });

  it("state.yaml values win over legacy config.yaml values when both present", () => {
    const configYaml = `hiddenSessions:
  - legacy-session
`;
    const stateYaml = `hiddenSessions:
  - state-session
`;
    vi.mocked(existsSync).mockImplementation((p) => {
      const s = String(p);
      return s.endsWith("config.yaml") || s.endsWith("state.yaml");
    });
    vi.mocked(readFileSync).mockImplementation((p) =>
      String(p).endsWith("state.yaml") ? stateYaml : configYaml,
    );
    vi.mocked(writeFileSync).mockImplementation(() => {});

    const config = loadGlobalConfig();
    // state.yaml wins because it has non-empty content
    expect(config.hiddenSessions).toEqual(["state-session"]);
  });
});

describe("hideSession", () => {
  it("writes session id to state.yaml", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith("state.yaml"),
    );
    vi.mocked(readFileSync).mockReturnValue("hiddenSessions: []\n");
    vi.mocked(writeFileSync).mockImplementation(() => {});

    hideSession("proj/abc");

    const writeCalls = vi.mocked(writeFileSync).mock.calls;
    const stateWrite = writeCalls.find(([p]) =>
      String(p).endsWith("state.yaml"),
    );
    expect(stateWrite).toBeDefined();
    expect(String(stateWrite![1])).toContain("proj/abc");
  });

  it("does not add duplicate id", () => {
    vi.mocked(existsSync).mockImplementation(
      (p) =>
        String(p).endsWith("state.yaml") || String(p).endsWith("config.yaml"),
    );
    vi.mocked(readFileSync).mockImplementation((p) =>
      String(p).endsWith("state.yaml")
        ? "hiddenSessions:\n  - abc123\n"
        : "refreshInterval: 2s\n",
    );
    vi.mocked(writeFileSync).mockImplementation(() => {});

    hideSession("abc123");

    // No write at all — duplicate was detected
    const stateWrite = vi
      .mocked(writeFileSync)
      .mock.calls.find(([p]) => String(p).endsWith("state.yaml"));
    expect(stateWrite).toBeUndefined();
  });
});

describe("hideSubAgent", () => {
  it("writes sub-agent id to state.yaml", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith("state.yaml"),
    );
    vi.mocked(readFileSync).mockReturnValue("hiddenSubAgents: []\n");
    vi.mocked(writeFileSync).mockImplementation(() => {});

    hideSubAgent("agent-xyz");

    const writeCalls = vi.mocked(writeFileSync).mock.calls;
    const stateWrite = writeCalls.find(([p]) =>
      String(p).endsWith("state.yaml"),
    );
    expect(stateWrite).toBeDefined();
    expect(String(stateWrite![1])).toContain("agent-xyz");
  });
});

describe("hideProject", () => {
  it("writes project name to state.yaml", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith("state.yaml"),
    );
    vi.mocked(readFileSync).mockReturnValue("hiddenProjects: []\n");
    vi.mocked(writeFileSync).mockImplementation(() => {});

    hideProject("old-project");

    const writeCalls = vi.mocked(writeFileSync).mock.calls;
    const stateWrite = writeCalls.find(([p]) =>
      String(p).endsWith("state.yaml"),
    );
    expect(stateWrite).toBeDefined();
    expect(String(stateWrite![1])).toContain("old-project");
  });

  it("does not add duplicate project name", () => {
    vi.mocked(existsSync).mockImplementation(
      (p) =>
        String(p).endsWith("state.yaml") || String(p).endsWith("config.yaml"),
    );
    vi.mocked(readFileSync).mockImplementation((p) =>
      String(p).endsWith("state.yaml")
        ? "hiddenProjects:\n  - old-project\n"
        : "refreshInterval: 2s\n",
    );
    vi.mocked(writeFileSync).mockImplementation(() => {});

    hideProject("old-project");

    // No write to state.yaml — duplicate was detected
    const stateWrite = vi
      .mocked(writeFileSync)
      .mock.calls.find(([p]) => String(p).endsWith("state.yaml"));
    expect(stateWrite).toBeUndefined();
  });
});

describe("hasProjectLevelConfig", () => {
  it("returns true when cwd has a .agenthud/config.yaml and cwd is not home", () => {
    const cwdSpy = vi
      .spyOn(process, "cwd")
      .mockReturnValue("/Users/me/work/proj");
    vi.mocked(existsSync).mockReturnValue(true);
    try {
      expect(hasProjectLevelConfig()).toBe(true);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("returns false when cwd is the user's home directory", () => {
    // Regression: ~/.agenthud/config.yaml is the GLOBAL config; should never
    // be treated as a project-level migration target.
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(homedir());
    vi.mocked(existsSync).mockReturnValue(true);
    try {
      expect(hasProjectLevelConfig()).toBe(false);
    } finally {
      cwdSpy.mockRestore();
    }
  });
});

describe("hideSession - writes to state.yaml (explicit path check)", () => {
  it("writes to state.yaml path", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(writeFileSync).mockImplementation(() => {});

    hideSession("abc123");

    const writeCalls = vi.mocked(writeFileSync).mock.calls;
    // writeDefaultConfig writes config.yaml, updateState writes state.yaml
    const stateWrite = writeCalls.find(([p]) => String(p) === STATE_PATH);
    expect(stateWrite).toBeDefined();
    expect(String(stateWrite![1])).toContain("abc123");
    // Must NOT write hide fields to config.yaml
    const configWrite = writeCalls.find(([p]) => String(p) === CONFIG_PATH);
    if (configWrite) {
      // config.yaml write (from auto-create) should not contain the session id
      expect(String(configWrite[1])).not.toContain("abc123");
    }
  });
});
