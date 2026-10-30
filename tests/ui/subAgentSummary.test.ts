import { describe, expect, it } from "vitest";
import type { ActivityEntry, SessionNode } from "../../src/types/index.js";
import {
  buildSubAgentSummary,
  formatDuration,
  subAgentHeaderRowCount,
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

  it("reports running (not done) when liveState is waiting", () => {
    // A "waiting" agent is alive/yielded, not finished. Unreachable for Claude
    // sub-agents today (sessionLiveness maps sub-agent yield → null), but the
    // header must not lie if a provider ever emits agentId + waiting.
    const s = buildSubAgentSummary(
      node({ agentId: "a", liveState: "waiting" }),
      [tool(0)],
    );
    expect(s?.status).toBe("running");
  });

  it("reports done when there is no live signal (liveState null)", () => {
    const s = buildSubAgentSummary(node({ agentId: "a", liveState: null }), [
      tool(0),
    ]);
    expect(s?.status).toBe("done");
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

describe("subAgentHeaderRowCount", () => {
  it("is 0 with no summary", () => {
    expect(subAgentHeaderRowCount(null)).toBe(0);
    expect(subAgentHeaderRowCount(undefined)).toBe(0);
  });
  it("is 2 without a result (chip + divider)", () => {
    const s = buildSubAgentSummary(node({ agentId: "a" }), [tool(0)]);
    expect(s?.result).toBe("");
    expect(subAgentHeaderRowCount(s)).toBe(2);
  });
  it("is 3 with a result (chip + result + divider)", () => {
    const s = buildSubAgentSummary(node({ agentId: "a" }), [
      tool(0),
      response(1000, "done"),
    ]);
    expect(subAgentHeaderRowCount(s)).toBe(3);
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes, hours", () => {
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(134000)).toBe("2m14s");
    expect(formatDuration(3_660_000)).toBe("1h1m");
  });
});
