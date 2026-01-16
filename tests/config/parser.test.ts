import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock fs module
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { existsSync, readFileSync } from "node:fs";
import {
  getDefaultConfig,
  parseConfig,
  parseInterval,
} from "../../src/config/parser.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

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

  it("returns default tests config", () => {
    const config = getDefaultConfig();

    expect(config.panels.tests.enabled).toBe(true);
    expect(config.panels.tests.interval).toBeNull(); // manual
    expect(config.panels.tests.command).toBeUndefined();
  });

  it("returns default width of 70", () => {
    const config = getDefaultConfig();

    expect(config.width).toBe(70);
  });
});

describe("parseConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("when config file does not exist", () => {
    it("returns default config", () => {
      mockExistsSync.mockReturnValue(false);

      const { config } = parseConfig();

      expect(config).toEqual(getDefaultConfig());
    });

    it("returns no warnings", () => {
      mockExistsSync.mockReturnValue(false);

      const { warnings } = parseConfig();

      expect(warnings).toEqual([]);
    });
  });

  describe("when config file exists", () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
    });

    it("parses valid YAML config", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  git:
    enabled: true
    interval: 60s
  tests:
    enabled: true
    command: npm test -- --json
    interval: manual
`);

      const { config } = parseConfig();

      expect(config.panels.git.enabled).toBe(true);
      expect(config.panels.git.interval).toBe(60000);
      expect(config.panels.tests.enabled).toBe(true);
      expect(config.panels.tests.command).toBe("npm test -- --json");
      expect(config.panels.tests.interval).toBeNull();
    });

    it("uses defaults for missing panels", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  git:
    enabled: false
`);

      const { config } = parseConfig();

      expect(config.panels.git.enabled).toBe(false);
      expect(config.panels.tests.enabled).toBe(true); // default
    });

    it("uses defaults for missing fields", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  git:
    enabled: false
`);

      const { config } = parseConfig();

      expect(config.panels.git.enabled).toBe(false);
      expect(config.panels.git.interval).toBe(30000); // default
    });

    it("handles empty config file", () => {
      mockReadFileSync.mockReturnValue("");

      const { config } = parseConfig();

      expect(config).toEqual(getDefaultConfig());
    });

    it("handles config with only panels key", () => {
      mockReadFileSync.mockReturnValue("panels:");

      const { config } = parseConfig();

      expect(config).toEqual(getDefaultConfig());
    });

    it("parses claude panel max_activities", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  claude:
    enabled: true
    interval: 10s
    max_activities: 25
`);

      const { config } = parseConfig();

      expect(config.panels.claude.enabled).toBe(true);
      expect(config.panels.claude.interval).toBe(10000);
      expect(config.panels.claude.maxActivities).toBe(25);
    });

    it("uses undefined for max_activities when not specified", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  claude:
    enabled: true
`);

      const { config } = parseConfig();

      expect(config.panels.claude.maxActivities).toBeUndefined();
    });
  });

  describe("warnings", () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
    });

    it("warns on invalid interval format", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  git:
    interval: invalid
`);

      const { warnings, config } = parseConfig();

      expect(warnings).toContain(
        "Invalid interval 'invalid' for git panel, using default",
      );
      expect(config.panels.git.interval).toBe(30000); // default
    });

    it("warns on invalid YAML syntax", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  git:
    enabled: [invalid yaml
`);

      const { warnings, config } = parseConfig();

      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain("Failed to parse config");
      expect(config).toEqual(getDefaultConfig());
    });

    it("treats unknown panel as custom panel", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  unknown:
    enabled: true
    command: echo test
`);

      const { config, warnings } = parseConfig();

      // Unknown panels are now treated as custom panels, not warnings
      expect(warnings).not.toContain("Unknown panel 'unknown' in config");
      expect(config.customPanels).toBeDefined();
      expect(config.customPanels?.unknown).toBeDefined();
    });
  });

  describe("custom panels", () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
    });

    it("parses custom panel with command", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  docker:
    enabled: true
    command: docker ps --format json
    renderer: list
    interval: 30s
`);

      const { config, warnings } = parseConfig();

      expect(config.customPanels).toBeDefined();
      expect(config.customPanels?.docker).toBeDefined();
      expect(config.customPanels?.docker.enabled).toBe(true);
      expect(config.customPanels?.docker.command).toBe(
        "docker ps --format json",
      );
      expect(config.customPanels?.docker.renderer).toBe("list");
      expect(config.customPanels?.docker.interval).toBe(30000);
      expect(warnings).not.toContain("Unknown panel 'docker' in config");
    });

    it("parses custom panel with source", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  status:
    enabled: true
    source: .agenthud/status.json
    renderer: status
    interval: manual
`);

      const { config } = parseConfig();

      expect(config.customPanels?.status.source).toBe(".agenthud/status.json");
      expect(config.customPanels?.status.renderer).toBe("status");
      expect(config.customPanels?.status.interval).toBeNull();
    });

    it("defaults renderer to list", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  custom:
    enabled: true
    command: echo test
`);

      const { config } = parseConfig();

      expect(config.customPanels?.custom.renderer).toBe("list");
    });

    it("defaults interval to 30s for custom panels", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  custom:
    enabled: true
    command: echo test
`);

      const { config } = parseConfig();

      expect(config.customPanels?.custom.interval).toBe(30000);
    });

    it("parses multiple custom panels", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  docker:
    enabled: true
    command: docker ps
  k8s:
    enabled: true
    command: kubectl get pods
    renderer: progress
`);

      const { config } = parseConfig();

      expect(Object.keys(config.customPanels!)).toHaveLength(2);
      expect(config.customPanels?.docker).toBeDefined();
      expect(config.customPanels?.k8s).toBeDefined();
      expect(config.customPanels?.k8s.renderer).toBe("progress");
    });

    it("handles mixed built-in and custom panels", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  git:
    enabled: true
    interval: 60s
  docker:
    enabled: true
    command: docker ps
`);

      const { config } = parseConfig();

      expect(config.panels.git.interval).toBe(60000);
      expect(config.customPanels?.docker).toBeDefined();
    });

    it("warns on invalid renderer", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  custom:
    enabled: true
    command: echo test
    renderer: invalid
`);

      const { config, warnings } = parseConfig();

      expect(warnings).toContain(
        "Invalid renderer 'invalid' for custom panel, using 'list'",
      );
      expect(config.customPanels?.custom.renderer).toBe("list");
    });

    it("ignores disabled custom panels", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  docker:
    enabled: false
    command: docker ps
`);

      const { config } = parseConfig();

      expect(config.customPanels?.docker.enabled).toBe(false);
    });
  });

  describe("panel order", () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
    });

    it("preserves panel order from config.yaml", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  git:
    enabled: true
  docker:
    enabled: true
    command: docker ps
  tests:
    enabled: true
`);

      const { config } = parseConfig();

      // Config order is preserved, missing built-in panels (project, claude, other_sessions) added at end
      expect(config.panelOrder).toEqual([
        "git",
        "docker",
        "tests",
        "project",
        "claude",
        "other_sessions",
      ]);
    });

    it("returns default order when no config file", () => {
      mockExistsSync.mockReturnValue(false);

      const { config } = parseConfig();

      expect(config.panelOrder).toEqual([
        "project",
        "git",
        "tests",
        "claude",
        "other_sessions",
      ]);
    });

    it("includes disabled panels in order (enabled checked at render time)", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  git:
    enabled: true
  docker:
    enabled: false
    command: docker ps
  tests:
    enabled: true
`);

      const { config } = parseConfig();

      // panelOrder should include all panels from config, regardless of enabled state
      // The enabled state is checked at render time
      // Missing built-in panels (project, claude, other_sessions) added at end
      expect(config.panelOrder).toEqual([
        "git",
        "docker",
        "tests",
        "project",
        "claude",
        "other_sessions",
      ]);
    });
  });

  describe("width setting", () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
    });

    it("uses default width when not specified", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  git:
    enabled: true
`);

      const { config } = parseConfig();

      expect(config.width).toBe(70);
    });

    it("parses custom width from config", () => {
      mockReadFileSync.mockReturnValue(`
width: 80

panels:
  git:
    enabled: true
`);

      const { config } = parseConfig();

      expect(config.width).toBe(80);
    });

    it("clamps width to minimum of 50", () => {
      mockReadFileSync.mockReturnValue(`
width: 30
`);

      const { config, warnings } = parseConfig();

      expect(config.width).toBe(50);
      expect(warnings).toContain("Width 30 is too small, using minimum of 50");
    });

    it("clamps width to maximum of 120", () => {
      mockReadFileSync.mockReturnValue(`
width: 150
`);

      const { config, warnings } = parseConfig();

      expect(config.width).toBe(120);
      expect(warnings).toContain(
        "Width 150 is too large, using maximum of 120",
      );
    });
  });

  describe("wideLayoutThreshold setting", () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(true);
    });

    it("uses default wideLayoutThreshold of null (disabled) when not specified", () => {
      mockReadFileSync.mockReturnValue(`
panels:
  git:
    enabled: true
`);

      const { config } = parseConfig();

      expect(config.wideLayoutThreshold).toBeNull();
    });

    it("parses wideLayoutThreshold from config", () => {
      mockReadFileSync.mockReturnValue(`
wideLayoutThreshold: 180

panels:
  git:
    enabled: true
`);

      const { config } = parseConfig();

      expect(config.wideLayoutThreshold).toBe(180);
    });

    it("accepts wideLayoutThreshold with snake_case", () => {
      mockReadFileSync.mockReturnValue(`
wide_layout_threshold: 200
`);

      const { config } = parseConfig();

      expect(config.wideLayoutThreshold).toBe(200);
    });

    it("warns when wideLayoutThreshold is too small", () => {
      mockReadFileSync.mockReturnValue(`
wideLayoutThreshold: 100
`);

      const { config, warnings } = parseConfig();

      expect(config.wideLayoutThreshold).toBe(140);
      expect(warnings).toContain(
        "wideLayoutThreshold 100 is too small, using minimum of 140",
      );
    });
  });
});
