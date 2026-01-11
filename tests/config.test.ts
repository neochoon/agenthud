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

  it("returns default width of 70", () => {
    const config = getDefaultConfig();

    expect(config.width).toBe(70);
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

    it("treats unknown panel as custom panel", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  unknown:
    enabled: true
    command: echo test
`);

      const { config, warnings } = parseConfig();

      // Unknown panels are now treated as custom panels, not warnings
      expect(warnings).not.toContain("Unknown panel 'unknown' in config");
      expect(config.customPanels).toBeDefined();
      expect(config.customPanels!.unknown).toBeDefined();
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

  describe("custom panels", () => {
    beforeEach(() => {
      fsMock.existsSync.mockReturnValue(true);
    });

    it("parses custom panel with command", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  docker:
    enabled: true
    command: docker ps --format json
    renderer: list
    interval: 30s
`);

      const { config, warnings } = parseConfig();

      expect(config.customPanels).toBeDefined();
      expect(config.customPanels!.docker).toBeDefined();
      expect(config.customPanels!.docker.enabled).toBe(true);
      expect(config.customPanels!.docker.command).toBe("docker ps --format json");
      expect(config.customPanels!.docker.renderer).toBe("list");
      expect(config.customPanels!.docker.interval).toBe(30000);
      expect(warnings).not.toContain("Unknown panel 'docker' in config");
    });

    it("parses custom panel with source", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  status:
    enabled: true
    source: .agenthud/status.json
    renderer: status
    interval: manual
`);

      const { config } = parseConfig();

      expect(config.customPanels!.status.source).toBe(".agenthud/status.json");
      expect(config.customPanels!.status.renderer).toBe("status");
      expect(config.customPanels!.status.interval).toBeNull();
    });

    it("defaults renderer to list", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  custom:
    enabled: true
    command: echo test
`);

      const { config } = parseConfig();

      expect(config.customPanels!.custom.renderer).toBe("list");
    });

    it("defaults interval to 30s for custom panels", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  custom:
    enabled: true
    command: echo test
`);

      const { config } = parseConfig();

      expect(config.customPanels!.custom.interval).toBe(30000);
    });

    it("parses multiple custom panels", () => {
      fsMock.readFileSync.mockReturnValue(`
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
      expect(config.customPanels!.docker).toBeDefined();
      expect(config.customPanels!.k8s).toBeDefined();
      expect(config.customPanels!.k8s.renderer).toBe("progress");
    });

    it("handles mixed built-in and custom panels", () => {
      fsMock.readFileSync.mockReturnValue(`
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
      expect(config.customPanels!.docker).toBeDefined();
    });

    it("warns on invalid renderer", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  custom:
    enabled: true
    command: echo test
    renderer: invalid
`);

      const { config, warnings } = parseConfig();

      expect(warnings).toContain("Invalid renderer 'invalid' for custom panel, using 'list'");
      expect(config.customPanels!.custom.renderer).toBe("list");
    });

    it("ignores disabled custom panels", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  docker:
    enabled: false
    command: docker ps
`);

      const { config } = parseConfig();

      expect(config.customPanels!.docker.enabled).toBe(false);
    });
  });

  describe("panel order", () => {
    beforeEach(() => {
      fsMock.existsSync.mockReturnValue(true);
    });

    it("preserves panel order from config.yaml", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  git:
    enabled: true
  plan:
    enabled: true
  docker:
    enabled: true
    command: docker ps
  tests:
    enabled: true
`);

      const { config } = parseConfig();

      // Config order is preserved, missing built-in panels (project) added at end
      expect(config.panelOrder).toEqual(["git", "plan", "docker", "tests", "project"]);
    });

    it("returns default order when no config file", () => {
      fsMock.existsSync.mockReturnValue(false);

      const { config } = parseConfig();

      expect(config.panelOrder).toEqual(["project", "git", "plan", "tests"]);
    });

    it("includes only enabled panels in order", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  git:
    enabled: true
  plan:
    enabled: false
  docker:
    enabled: true
    command: docker ps
  tests:
    enabled: true
`);

      const { config } = parseConfig();

      // panelOrder should include all panels from config, regardless of enabled state
      // The enabled state is checked at render time
      // Missing built-in panels (project) added at end
      expect(config.panelOrder).toEqual(["git", "plan", "docker", "tests", "project"]);
    });
  });

  describe("width setting", () => {
    beforeEach(() => {
      fsMock.existsSync.mockReturnValue(true);
    });

    it("uses default width when not specified", () => {
      fsMock.readFileSync.mockReturnValue(`
panels:
  git:
    enabled: true
`);

      const { config } = parseConfig();

      expect(config.width).toBe(70);
    });

    it("parses custom width from config", () => {
      fsMock.readFileSync.mockReturnValue(`
width: 80

panels:
  git:
    enabled: true
`);

      const { config } = parseConfig();

      expect(config.width).toBe(80);
    });

    it("clamps width to minimum of 50", () => {
      fsMock.readFileSync.mockReturnValue(`
width: 30
`);

      const { config, warnings } = parseConfig();

      expect(config.width).toBe(50);
      expect(warnings).toContain("Width 30 is too small, using minimum of 50");
    });

    it("clamps width to maximum of 120", () => {
      fsMock.readFileSync.mockReturnValue(`
width: 150
`);

      const { config, warnings } = parseConfig();

      expect(config.width).toBe(120);
      expect(warnings).toContain("Width 150 is too large, using maximum of 120");
    });
  });
});
