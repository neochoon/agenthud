import { describe, expect, it, vi, afterEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const { existsSync, readFileSync } = await import("node:fs");
const { loadGlobalConfig, DEFAULT_GLOBAL_CONFIG } = await import(
  "../../src/config/globalConfig.js"
);

afterEach(() => {
  vi.resetAllMocks();
});

describe("loadGlobalConfig", () => {
  it("returns defaults when config file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const config = loadGlobalConfig();
    expect(config.refreshIntervalMs).toBe(2000);
    expect(config.sessionTimeoutMs).toBe(30 * 60 * 1000);
    expect(config.logDir).toBe(join(homedir(), ".agenthud", "logs"));
  });

  it("overrides defaults with values from config file", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      "refreshInterval: 5s\nsessionTimeout: 10m\n",
    );
    const config = loadGlobalConfig();
    expect(config.refreshIntervalMs).toBe(5000);
    expect(config.sessionTimeoutMs).toBe(10 * 60 * 1000);
  });

  it("ignores unknown keys", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("unknownKey: value\n");
    const config = loadGlobalConfig();
    expect(config).toEqual(expect.objectContaining(DEFAULT_GLOBAL_CONFIG));
  });
});
