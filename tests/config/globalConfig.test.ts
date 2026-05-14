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
const { loadGlobalConfig, DEFAULT_GLOBAL_CONFIG, hideSession, hideSubAgent } =
  await import("../../src/config/globalConfig.js");

afterEach(() => {
  vi.resetAllMocks();
});

describe("loadGlobalConfig", () => {
  it("returns defaults when config file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const config = loadGlobalConfig();
    expect(config.refreshIntervalMs).toBe(2000);
    expect(config.logDir).toBe(join(homedir(), ".agenthud", "logs"));
    expect(config.hiddenSessions).toEqual([]);
    expect(config.hiddenSubAgents).toEqual([]);
  });

  it("overrides refreshInterval from config file", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("refreshInterval: 5s\n");
    const config = loadGlobalConfig();
    expect(config.refreshIntervalMs).toBe(5000);
  });

  it("parses hiddenSessions array from config file", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      "hiddenSessions:\n  - abc123\n  - def456\n",
    );
    const config = loadGlobalConfig();
    expect(config.hiddenSessions).toEqual(["abc123", "def456"]);
  });

  it("parses hiddenSubAgents array from config file", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      "hiddenSubAgents:\n  - agent-xyz\n",
    );
    const config = loadGlobalConfig();
    expect(config.hiddenSubAgents).toEqual(["agent-xyz"]);
  });

  it("ignores unknown keys", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("unknownKey: value\n");
    const config = loadGlobalConfig();
    expect(config).toEqual(expect.objectContaining(DEFAULT_GLOBAL_CONFIG));
  });
});

describe("hideSession", () => {
  it("writes session id to hiddenSessions in config", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(writeFileSync).mockImplementation(() => {});

    hideSession("abc123");

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const written = String(vi.mocked(writeFileSync).mock.calls[0][1]);
    expect(written).toContain("abc123");
  });

  it("does not add duplicate id", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      "hiddenSessions:\n  - abc123\n",
    );
    vi.mocked(writeFileSync).mockImplementation(() => {});

    hideSession("abc123");

    expect(writeFileSync).not.toHaveBeenCalled();
  });
});

describe("hideSubAgent", () => {
  it("writes sub-agent id to hiddenSubAgents in config", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(writeFileSync).mockImplementation(() => {});

    hideSubAgent("agent-xyz");

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const written = String(vi.mocked(writeFileSync).mock.calls[0][1]);
    expect(written).toContain("agent-xyz");
  });
});
