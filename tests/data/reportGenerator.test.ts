import { describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "../../src/types/index.js";
import type { SessionNode } from "../../src/types/index.js";

vi.mock("../../src/data/sessionHistory.js", () => ({
  parseSessionHistory: vi.fn(),
}));
vi.mock("node:fs", () => ({
  statSync: vi.fn(),
  existsSync: vi.fn(),
}));

const { parseSessionHistory } = await import("../../src/data/sessionHistory.js");
const { statSync } = await import("node:fs");
const { generateReport } = await import("../../src/data/reportGenerator.js");

const DAY = new Date("2026-05-14T00:00:00.000Z"); // UTC midnight

function makeSession(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: "abc123",
    hideKey: "myproject/abc123",
    filePath: "/home/.claude/projects/-myproject/abc123.jsonl",
    projectPath: "/Users/neo/myproject",
    projectName: "myproject",
    lastModifiedMs: new Date("2026-05-14T10:00:00Z").getTime(),
    status: "hot",
    modelName: null,
    subAgents: [],
    ...overrides,
  };
}

function makeActivity(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    timestamp: new Date("2026-05-14T10:23:00Z"),
    type: "tool",
    icon: "$",
    label: "Bash",
    detail: "npm test",
    ...overrides,
  };
}

describe("generateReport", () => {
  it("returns no-activity message when no sessions match the date", () => {
    vi.mocked(statSync).mockReturnValue({ mtimeMs: new Date("2026-05-13T10:00:00Z").getTime() } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([]);

    const result = generateReport([makeSession()], { date: DAY, include: ["response", "bash", "edit", "thinking"] });
    expect(result).toBe("No activity found for 2026-05-14.");
  });

  it("includes session with activity on target date", () => {
    vi.mocked(statSync).mockReturnValue({ mtimeMs: new Date("2026-05-14T10:00:00Z").getTime() } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({ type: "response", icon: "<", label: "Response", detail: "Did the thing." }),
    ]);

    const result = generateReport([makeSession()], { date: DAY, include: ["response"] });
    expect(result).toContain("## myproject");
    expect(result).toContain("[10:23] < Response: Did the thing.");
  });

  it("excludes activities not on target date", () => {
    vi.mocked(statSync).mockReturnValue({ mtimeMs: new Date("2026-05-14T10:00:00Z").getTime() } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({ timestamp: new Date("2026-05-13T09:00:00Z"), type: "response", icon: "<", label: "Response", detail: "Yesterday." }),
      makeActivity({ timestamp: new Date("2026-05-14T11:00:00Z"), type: "response", icon: "<", label: "Response", detail: "Today." }),
    ]);

    const result = generateReport([makeSession()], { date: DAY, include: ["response"] });
    expect(result).not.toContain("Yesterday.");
    expect(result).toContain("Today.");
  });

  it("excludes activity types not in include list", () => {
    vi.mocked(statSync).mockReturnValue({ mtimeMs: new Date("2026-05-14T10:00:00Z").getTime() } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({ type: "tool", icon: "○", label: "Read", detail: "some/file.ts" }),
      makeActivity({ type: "response", icon: "<", label: "Response", detail: "Done." }),
    ]);

    const result = generateReport([makeSession()], { date: DAY, include: ["response"] });
    expect(result).not.toContain("Read");
    expect(result).toContain("Done.");
  });

  it("truncates detail to 120 chars", () => {
    vi.mocked(statSync).mockReturnValue({ mtimeMs: new Date("2026-05-14T10:00:00Z").getTime() } as ReturnType<typeof statSync>);
    const longDetail = "x".repeat(200);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({ type: "response", icon: "<", label: "Response", detail: longDetail }),
    ]);

    const result = generateReport([makeSession()], { date: DAY, include: ["response"] });
    expect(result).toContain("x".repeat(120));
    expect(result).not.toContain("x".repeat(121));
  });

  it("includes report header with date", () => {
    vi.mocked(statSync).mockReturnValue({ mtimeMs: new Date("2026-05-14T10:00:00Z").getTime() } as ReturnType<typeof statSync>);
    vi.mocked(parseSessionHistory).mockReturnValue([
      makeActivity({ type: "response", icon: "<", label: "Response", detail: "Done." }),
    ]);

    const result = generateReport([makeSession()], { date: DAY, include: ["response"] });
    expect(result).toContain("# AgentHUD Report: 2026-05-14");
  });
});
