import { render } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process module
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
    exec: vi.fn(),
  };
});

// Mock fs module
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { App } from "../../src/ui/App.js";

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockStatSync = vi.mocked(statSync);

describe("App with config", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default git mock
    mockExecSync.mockImplementation((cmd: any) => {
      if (String(cmd).includes("branch --show-current")) return "main\n";
      if (String(cmd).includes("git log")) return "";
      if (String(cmd).includes("git diff")) return "";
      if (String(cmd).includes("status --porcelain")) return "";
      return "";
    });

    // Default: no config file
    mockExistsSync.mockReturnValue(false);

    // Default: no projects directory for other sessions
    mockReaddirSync.mockReturnValue([]);
    mockStatSync.mockReturnValue({
      mtimeMs: 0,
      isDirectory: () => true,
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("panel visibility", () => {
    it("shows all panels with default config when command is set", () => {
      mockExistsSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) {
          return `
panels:
  tests:
    command: "npm test"
`;
        }
        return "";
      });

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).toContain("Git");
      expect(lastFrame()).toContain("Tests");
    });

    it("hides git panel when disabled", () => {
      mockExistsSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) {
          return `
panels:
  git:
    enabled: false
  tests:
    command: "npm test"
`;
        }
        return "";
      });

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).not.toContain("─ Git");
      expect(lastFrame()).toContain("Tests");
    });

    it("hides tests panel when disabled", () => {
      mockExistsSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) {
          return `
panels:
  tests:
    enabled: false
`;
        }
        return "";
      });

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).toContain("Git");
      expect(lastFrame()).not.toContain("─ Tests");
    });

    it("hides all panels when all disabled", () => {
      mockExistsSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) {
          return `
panels:
  git:
    enabled: false
  tests:
    enabled: false
`;
        }
        return "";
      });

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).not.toContain("─ Git");
      expect(lastFrame()).not.toContain("─ Tests");
    });
  });

  describe("config warnings", () => {
    it("shows warnings for invalid renderer", () => {
      mockExistsSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) {
          return `
panels:
  custom:
    enabled: true
    command: echo test
    renderer: invalid
`;
        }
        return "";
      });

      const { lastFrame } = render(<App mode="once" />);

      expect(lastFrame()).toContain("Invalid renderer 'invalid'");
    });
  });

  describe("panel order", () => {
    it("renders panels in config.yaml order", () => {
      mockExistsSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) {
          return `
panels:
  git:
    enabled: true
  docker:
    enabled: true
    command: echo "nginx"
  tests:
    enabled: true
    command: npm test
`;
        }
        return "";
      });

      const { lastFrame } = render(<App mode="once" />);
      const output = lastFrame() || "";

      // Verify order by checking positions
      const gitPos = output.indexOf("─ Git");
      const dockerPos = output.indexOf("─ Docker");
      const testsPos = output.indexOf("─ Tests");

      expect(gitPos).toBeLessThan(dockerPos);
      expect(dockerPos).toBeLessThan(testsPos);
    });

    it("places custom panel between built-in panels", () => {
      mockExistsSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((path: any) => {
        if (String(path).includes("config.yaml")) {
          return `
panels:
  git:
    enabled: true
  docker:
    enabled: true
    command: echo "nginx"
  tests:
    enabled: true
    command: npm test
`;
        }
        return "";
      });

      const { lastFrame } = render(<App mode="once" />);
      const output = lastFrame() || "";

      // Order: git -> docker -> tests
      const gitPos = output.indexOf("─ Git");
      const dockerPos = output.indexOf("─ Docker");
      const testsPos = output.indexOf("─ Tests");

      expect(gitPos).toBeLessThan(dockerPos);
      expect(dockerPos).toBeLessThan(testsPos);
    });
  });
});
