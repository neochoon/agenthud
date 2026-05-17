// tests/ui/App.test.tsx
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/globalConfig.js", () => ({
  loadGlobalConfig: () => ({
    refreshIntervalMs: 60000,
    hiddenSessions: [],
    hiddenSubAgents: [],
    filterPresets: [[], ["response"], ["commit"]],
  }),
  hasProjectLevelConfig: () => false,
}));

vi.mock("../../src/data/sessions.js", () => ({
  discoverSessions: () => ({
    projects: [],
    coldProjects: [],
    totalCount: 0,
    timestamp: new Date().toISOString(),
  }),
  getProjectsDir: () => "/tmp/nonexistent-projects-dir",
}));

vi.mock("../../src/data/sessionHistory.js", () => ({
  parseSessionHistory: () => [],
}));

const { App } = await import("../../src/ui/App.js");

describe("App", () => {
  it("renders without crashing when there are no sessions", () => {
    const { lastFrame } = render(<App mode="once" />);
    expect(lastFrame()).toContain("No Claude sessions");
  });

  it("renders watch-mode shell without crashing", () => {
    const { lastFrame } = render(<App mode="watch" />);
    const out = lastFrame() ?? "";
    // The branding ("AgentHUD vX.Y.Z") is conditionally hidden on narrow
    // terminals (ink-testing-library defaults to 80 cols). Verify watch-
    // mode rendered SOMETHING by checking for any of the always-present
    // status-bar / panel indicators.
    expect(out).toMatch(/(Tab:|Projects|q: quit)/);
  });
});
