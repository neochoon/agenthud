import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseConfig,
  parseInterval,
  getDefaultConfig,
  setFsMock,
  resetFsMock,
  type FsMock,
  type Config,
} from "../src/config/parser.js";

describe("parseInterval", () => {
  it("parses seconds", () => {
    expect(parseInterval("30s")).toBe(30000);
  });

  it("parses minutes", () => {
    expect(parseInterval("5m")).toBe(300000);
  });

  it("parses manual as null", () => {
    expect(parseInterval("manual")).toBeNull();
  });

  it("returns null for invalid interval", () => {
    expect(parseInterval("invalid")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseInterval("")).toBeNull();
  });
});

describe("getDefaultConfig", () => {
  it("returns default git config", () => {
    const config = getDefaultConfig();

    expect(config.panels.git.enabled).toBe(true);
    expect(config.panels.git.interval).toBe(30000); // 30s
  });

  it("returns default plan config", () => {
    const config = getDefaultConfig();

    expect(config.panels.plan.enabled).toBe(true);
    expect(config.panels.plan.interval).toBe(10000); // 10s
    expect(config.panels.plan.source).toBe(".agenthud/plan.json");
  });

  it("returns default tests config", () => {
    const config = getDefaultConfig();

    expect(config.panels.tests.enabled).toBe(true);
    expect(config.panels.tests.interval).toBeNull(); // manual
    expect(config.panels.tests.command).toBeUndefined();
  });
});

describe("parseConfig", () => {
  let fsMock: FsMock;
  let warnings: string[];

  beforeEach(() => {
    warnings = [];
    fsMock = {
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
    };
    setFsMock(fsMock);
  });

  afterEach(() => {
    resetFsMock();
  });

  describe("when config file does not exist", () => {
    it("returns default config", () => {
      fsMock.existsSync.mockReturnValue(false);

      const { config } = parseConfig();

      expect(config).toEqual(getDefaultConfig());
    });

    it("returns no warnings", () => {
      fsMock.existsSync.mockReturnValue(false);

      const { warnings } = parseConfig();

      expect(warnings).toEqual([]);
    });
  });

  describe("when config file exists", () => {
    beforeEach(() => {
      fsMock.existsSync.mockReturnValue(true);
    });

    it("parses valid YAML config", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  git:
    enabled: true
    interval: 60s
  plan:
    enabled: false
    interval: 5s
  tests:
    enabled: true
    command: npm test -- --json
    interval: manual
`);

      const { config } = parseConfig();

      expect(config.panels.git.enabled).toBe(true);
      expect(config.panels.git.interval).toBe(60000);
      expect(config.panels.plan.enabled).toBe(false);
      expect(config.panels.plan.interval).toBe(5000);
      expect(config.panels.tests.enabled).toBe(true);
      expect(config.panels.tests.command).toBe("npm test -- --json");
      expect(config.panels.tests.interval).toBeNull();
    });

    it("uses defaults for missing panels", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  git:
    enabled: false
`);

      const { config } = parseConfig();

      expect(config.panels.git.enabled).toBe(false);
      expect(config.panels.plan.enabled).toBe(true); // default
      expect(config.panels.tests.enabled).toBe(true); // default
    });

    it("uses defaults for missing fields", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  git:
    enabled: false
`);

      const { config } = parseConfig();

      expect(config.panels.git.enabled).toBe(false);
      expect(config.panels.git.interval).toBe(30000); // default
    });

    it("handles empty config file", () => {
      fsMock.readFileSync.mockReturnValue("");

      const { config } = parseConfig();

      expect(config).toEqual(getDefaultConfig());
    });

    it("handles config with only panels key", () => {
      fsMock.readFileSync.mockReturnValue("panels:");

      const { config } = parseConfig();

      expect(config).toEqual(getDefaultConfig());
    });
  });

  describe("warnings", () => {
    beforeEach(() => {
      fsMock.existsSync.mockReturnValue(true);
    });

    it("warns on invalid interval format", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  git:
    interval: invalid
`);

      const { warnings, config } = parseConfig();

      expect(warnings).toContain("Invalid interval 'invalid' for git panel, using default");
      expect(config.panels.git.interval).toBe(30000); // default
    });

    it("warns on invalid YAML syntax", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  git:
    enabled: [invalid yaml
`);

      const { warnings, config } = parseConfig();

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain("Failed to parse config");
      expect(config).toEqual(getDefaultConfig());
    });

    it("warns on unknown panel", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  unknown:
    enabled: true
`);

      const { warnings } = parseConfig();

      expect(warnings).toContain("Unknown panel 'unknown' in config");
    });
  });

  describe("custom source path", () => {
    beforeEach(() => {
      fsMock.existsSync.mockReturnValue(true);
    });

    it("reads custom plan source", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  plan:
    source: custom/plan.json
`);

      const { config } = parseConfig();

      expect(config.panels.plan.source).toBe("custom/plan.json");
    });
  });
});
