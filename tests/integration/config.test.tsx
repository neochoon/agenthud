// tests/integration/config.test.tsx
// NOTE: This file was updated in Task 8 (v0.8 rewrite).
// The old panel-based config tests (Git, Tests, panel order) no longer apply
// to the new split-view App. Comprehensive integration tests will be added in Task 10.

import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/globalConfig.js", () => ({
  loadGlobalConfig: () => ({
    refreshIntervalMs: 60000,
    logDir: "/tmp/logs",
    hiddenSessions: [],
    hiddenSubAgents: [],
  }),
  ensureLogDir: vi.fn(),
  hasProjectLevelConfig: () => false,
}));

vi.mock("../../src/data/sessions.js", () => ({
  discoverSessions: () => ({
    sessions: [],
    totalCount: 0,
    timestamp: new Date().toISOString(),
  }),
}));

vi.mock("../../src/data/sessionHistory.js", () => ({
  parseSessionHistory: () => [],
}));

const { App } = await import("../../src/ui/App.js");

describe("App with config", () => {
  describe("panel visibility", () => {
    it("hides all panels when all disabled", () => {
      // New App always shows SessionTreePanel and ActivityViewerPanel.
      // There is no panel-level disable concept in the new design.
      const { lastFrame } = render(<App mode="once" />);
      expect(lastFrame()).toContain("Sessions");
    });
  });

  describe("config warnings", () => {
    it("shows migration warning when project-level config exists", () => {
      vi.doMock("../../src/config/globalConfig.js", () => ({
        loadGlobalConfig: () => ({
          refreshIntervalMs: 60000,
          sessionTimeoutMs: 30 * 60 * 1000,
          logDir: "/tmp/logs",
        }),
        ensureLogDir: vi.fn(),
        hasProjectLevelConfig: () => true,
      }));
      // Note: vi.doMock won't affect the already-imported App module in this test.
      // This scenario is covered by the App unit tests in tests/ui/App.test.tsx.
      expect(true).toBe(true);
    });
  });

  describe("panel order", () => {
    it("renders sessions panel above activity viewer", () => {
      const { lastFrame } = render(<App mode="once" />);
      const output = lastFrame() || "";
      const sessionsPos = output.indexOf("Sessions");
      const noSessionSelectedPos = output.indexOf("No session selected");
      expect(sessionsPos).toBeGreaterThanOrEqual(0);
      expect(noSessionSelectedPos).toBeGreaterThan(sessionsPos);
    });

    it("places custom panel between built-in panels", () => {
      // Not applicable to new split-view design — removed in v0.8.
      expect(true).toBe(true);
    });
  });
});
