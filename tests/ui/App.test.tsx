// tests/ui/App.test.tsx
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/globalConfig.js", () => ({
  loadGlobalConfig: () => ({
    refreshIntervalMs: 60000,
    sessionTimeoutMs: 30 * 60 * 1000,
    logDir: "/tmp/logs",
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

describe("App", () => {
  it("renders without crashing when there are no sessions", () => {
    const { lastFrame } = render(<App mode="once" />);
    expect(lastFrame()).toContain("No Claude sessions");
  });

  it("renders AgentHUD version in watch mode", () => {
    const { lastFrame } = render(<App mode="watch" />);
    expect(lastFrame()).toContain("AgentHUD v");
  });
});
