// tests/ui/App.autoPause.test.tsx
//
// Isolated on purpose: this test drives fake timers to advance the 60s refresh
// poll. Run alongside the ~50 real-timer tests in App.test.tsx, leftover
// intervals from un-unmounted prior renders bleed into the fake-timer window and
// make it order-dependent. A dedicated file gets vitest's per-file module
// isolation, so it runs clean every time.
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import type { ActivityEntry, SessionTree } from "../../src/types/index.js";

vi.mock("../../src/config/globalConfig.js", () => ({
  loadGlobalConfig: () => ({
    refreshIntervalMs: 60000,
    hiddenSessions: [],
    hiddenSubAgents: [],
    filterPresets: [[], ["response"], ["commit"]],
  }),
  hasProjectLevelConfig: () => false,
}));

let mockTree: SessionTree = {
  projects: [],
  coldProjects: [],
  totalCount: 0,
  timestamp: new Date(1_800_000_000_000).toISOString(),
  hiddenStats: { total: 0, active: 0 },
};

vi.mock("../../src/data/sessions.js", () => ({
  discoverSessions: () => mockTree,
  getProjectsDir: () => "/tmp/nonexistent-projects-dir",
}));

let mockActivities: ActivityEntry[] = [];
vi.mock("../../src/data/sessionHistory.js", () => ({
  parseSessionHistory: () => mockActivities,
}));

vi.setConfig({ testTimeout: 20000 });

const { App } = await import("../../src/ui/App.js");

describe("App — cursor-anchor auto-pause budget", () => {
  const ESC = String.fromCharCode(27);
  const DOWN = `${ESC}[B`;
  const UP = `${ESC}[A`;
  const RECENT = 1_800_000_000_000; // fixed ms, independent of the fake clock

  // A TOP-LEVEL session that carries an agentId (all buildSubAgentSummary needs)
  // so the viewer renders the black-box header. A top-level node stays in the
  // flattened list across the 60s refresh, so refresh's "selected item
  // disappeared → fall back to parent" path never fires and the selection stays
  // put while activities grow.
  const agentSessionTree = (): SessionTree => ({
    projects: [
      {
        name: "proj",
        projectPath: "/tmp/proj",
        hotness: "hot",
        sessions: [
          {
            id: "s1",
            hideKey: "proj/s1",
            filePath: "/tmp/proj/s1.jsonl",
            projectPath: "/tmp/proj",
            projectName: "proj",
            lastModifiedMs: RECENT,
            status: "hot",
            modelName: "sonnet-4.6",
            subAgents: [],
            nonInteractive: false,
            firstUserPrompt: "p",
            liveState: "working",
            agentId: "agent-abc",
            taskDescription: "DO_THE_THING",
          },
        ],
      },
    ],
    coldProjects: [],
    totalCount: 1,
    timestamp: new Date(RECENT).toISOString(),
    hiddenStats: { total: 0, active: 0 },
  });

  it("auto-pauses using the header-reduced budget for a live sub-agent (fix #1)", async () => {
    // The cursor-anchor auto-pause effect must budget against the stream that's
    // actually rendered (viewerRows − header height), not the full viewerRows.
    // With the cursor parked at the true top of the reduced window, ONE new
    // activity must push its anchored row off-screen → auto-PAUSE. Under the old
    // unreduced viewerRows the effect would see headroom (the header gap) and
    // stay LIVE.
    vi.useFakeTimers();
    try {
      mockTree = agentSessionTree();
      // Enough activities to overflow the viewer window so the cursor can climb
      // to the reduced top with content above it.
      mockActivities = Array.from({ length: 40 }, (_, i) => ({
        timestamp: new Date(2026, 0, 1, 9, 0, i),
        type: "tool" as const,
        icon: "○",
        label: "Read",
        detail: `f${i}.ts`,
      }));

      const { stdin, lastFrame } = render(<App mode="watch" />);
      await vi.advanceTimersByTimeAsync(250); // mount + initial load

      // Select the agent session (its viewer header divider shows once selected).
      for (let i = 0; i < 60; i++) {
        if ((lastFrame() ?? "").includes("drill in")) break;
        stdin.write(DOWN);
        await vi.advanceTimersByTimeAsync(60);
      }
      expect(lastFrame() ?? "").toContain("drill in");

      stdin.write("\t"); // focus tree → viewer
      await vi.advanceTimersByTimeAsync(60);

      // Wait until the live window is fully populated (newest row f39 present)
      // before measuring — counting a half-filled frame would misjudge the top.
      for (let i = 0; i < 40; i++) {
        if ((lastFrame() ?? "").includes("f39.ts")) break;
        await vi.advanceTimersByTimeAsync(60);
      }
      expect(lastFrame() ?? "").toContain("f39.ts");

      // When live and full, the viewer shows exactly `viewerStreamRows` stream
      // rows — read that budget off the frame instead of recomputing the layout.
      const streamRows = (lastFrame() ?? "")
        .split("\n")
        .filter((l) => /Read: f\d/.test(l)).length;
      expect(streamRows).toBeGreaterThan(3);

      // Climb to the top row of the visible window (cursor = streamRows−1) while
      // staying LIVE. One more ↑ would scroll+pause, so press exactly that many.
      for (let i = 0; i < streamRows - 1; i++) {
        stdin.write(UP);
        await vi.advanceTimersByTimeAsync(15);
      }
      expect(lastFrame() ?? "").toContain("LIVE"); // cursor at top, still live

      // One new activity arrives; the 60s poll re-reads the grown stream without
      // resetting the cursor (selection is stable — see the tree note above).
      mockActivities = [
        ...mockActivities,
        {
          timestamp: new Date(2026, 0, 1, 9, 1, 0),
          type: "tool",
          icon: "○",
          label: "Read",
          detail: "new.ts",
        },
      ];
      mockTree = agentSessionTree();
      await vi.advanceTimersByTimeAsync(60000); // fire the refresh poll
      // Let the re-render settle; poll so a lagged frame doesn't flake.
      for (let i = 0; i < 20; i++) {
        if ((lastFrame() ?? "").includes("PAUSED")) break;
        await vi.advanceTimersByTimeAsync(100);
      }
      expect(lastFrame() ?? "").toContain("PAUSED");
    } finally {
      vi.useRealTimers();
    }
  });
});
