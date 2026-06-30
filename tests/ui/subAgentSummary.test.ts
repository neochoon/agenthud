import { describe, expect, it } from "vitest";
import type { ActivityEntry, SessionNode } from "../../src/types/index.js";
import {
  buildSubAgentSummary,
  formatDuration,
} from "../../src/ui/subAgentSummary.js";

const node = (over: Partial<SessionNode> = {}): SessionNode => ({
  id: "id1",
  hideKey: "p/id1",
  filePath: "/tmp/id1.jsonl",
  projectPath: "/tmp/p",
  projectName: "p",
  lastModifiedMs: 0,
  status: "hot",
  modelName: "sonnet-4.6",
  subAgents: [],
  nonInteractive: false,
  firstUserPrompt: null,
  liveState: null,
  ...over,
});

const tool = (ms: number): ActivityEntry => ({
  timestamp: new Date(ms),
  type: "tool",
  icon: "○",
  label: "Read",
  detail: "x.ts",
});
const response = (ms: number, text: string): ActivityEntry => ({
  timestamp: new Date(ms),
  type: "response",
  icon: "✦",
  label: "Response",
  detail: text,
});

describe("buildSubAgentSummary", () => {
  it("returns null for a main session (no agentId)", () => {
    expect(buildSubAgentSummary(node(), [tool(0)])).toBeNull();
  });

  it("derives steps, duration, result, intent for a finished sub-agent", () => {
    const acts = [tool(1000), tool(2000), response(5000, "All done")];
    const s = buildSubAgentSummary(
      node({ agentId: "agent-abc", taskDescription: "Do the thing" }),
      acts,
    );
    expect(s).toEqual({
      status: "done",
      steps: 2,
      durationMs: 4000,
      intent: "Do the thing",
      result: "All done",
      model: "sonnet-4.6",
    });
  });

  it("reports running when liveState is working", () => {
    const s = buildSubAgentSummary(
      node({ agentId: "a", liveState: "working" }),
      [tool(0)],
    );
    expect(s?.status).toBe("running");
  });

  it("handles 0 and 1 activities (null duration, empty result)", () => {
    expect(buildSubAgentSummary(node({ agentId: "a" }), [])).toMatchObject({
      steps: 0,
      durationMs: null,
      result: "",
    });
    expect(
      buildSubAgentSummary(node({ agentId: "a" }), [tool(10)]),
    ).toMatchObject({ steps: 1, durationMs: null });
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes, hours", () => {
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(134000)).toBe("2m14s");
    expect(formatDuration(3_660_000)).toBe("1h1m");
  });
});
