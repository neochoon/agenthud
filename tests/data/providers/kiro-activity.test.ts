import { describe, expect, it } from "vitest";
import { parseKiroActivitiesFromLines } from "../../../src/data/providers/kiro-activity.js";

const promptLine = JSON.stringify({
  version: "v1",
  kind: "Prompt",
  data: {
    message_id: "p1",
    content: [{ kind: "text", data: "이 프로젝트 분석해봐." }],
    meta: { timestamp: 1781220419 },
  },
});

const assistantTextLine = JSON.stringify({
  version: "v1",
  kind: "AssistantMessage",
  data: {
    message_id: "a1",
    content: [{ kind: "text", data: "프로젝트 구조를 살펴봤습니다." }],
  },
});

const assistantToolLine = JSON.stringify({
  version: "v1",
  kind: "AssistantMessage",
  data: {
    message_id: "a2",
    content: [
      { kind: "text", data: "" },
      {
        kind: "toolUse",
        data: {
          toolUseId: "tu_1",
          name: "read",
          input: {
            __tool_use_purpose: "프로젝트 구조 파악",
            operations: [
              { mode: "Directory", path: "/Users/neo/myproject", depth: 2 },
            ],
          },
        },
      },
    ],
  },
});

const toolResultsLine = JSON.stringify({
  version: "v1",
  kind: "ToolResults",
  data: {
    message_id: "t1",
    content: [
      {
        kind: "toolResult",
        data: { toolUseId: "tu_1", content: [], status: "success" },
      },
    ],
    results: {},
  },
});

describe("parseKiroActivitiesFromLines", () => {
  it("maps Prompt → user activity with prompt body", () => {
    const { activities } = parseKiroActivitiesFromLines([promptLine]);
    expect(activities).toHaveLength(1);
    expect(activities[0].type).toBe("user");
    expect(activities[0].detail).toBe("이 프로젝트 분석해봐.");
    expect(activities[0].timestamp.getTime()).toBe(1781220419 * 1000);
  });

  it("maps AssistantMessage text → response activity", () => {
    const { activities } = parseKiroActivitiesFromLines([assistantTextLine]);
    expect(activities).toHaveLength(1);
    expect(activities[0].type).toBe("response");
    expect(activities[0].label).toBe("Response");
    expect(activities[0].detailBody).toBe("프로젝트 구조를 살펴봤습니다.");
  });

  it("maps AssistantMessage toolUse → tool activity with summarized input", () => {
    const { activities } = parseKiroActivitiesFromLines([assistantToolLine]);
    expect(activities).toHaveLength(1);
    expect(activities[0].type).toBe("tool");
    expect(activities[0].label).toBe("read");
    // Path from operations[0].path; __tool_use_purpose stripped.
    expect(activities[0].detail).toBe("/Users/neo/myproject");
  });

  it("skips ToolResults records (handled by preceding tool entry)", () => {
    const { activities } = parseKiroActivitiesFromLines([
      promptLine,
      assistantToolLine,
      toolResultsLine,
    ]);
    // user + tool = 2, ToolResults doesn't add a third entry
    expect(activities).toHaveLength(2);
  });

  it("emits an empty result for an empty stream", () => {
    const result = parseKiroActivitiesFromLines([]);
    expect(result.activities).toHaveLength(0);
    expect(result.sessionStartTime).toBeNull();
  });

  it("inherits timestamp from prior entry when AssistantMessage has none", () => {
    const { activities } = parseKiroActivitiesFromLines([
      promptLine,
      assistantTextLine,
    ]);
    expect(activities[0].timestamp.getTime()).toBe(1781220419 * 1000);
    expect(activities[1].timestamp.getTime()).toBe(1781220419 * 1000);
  });

  it("ignores blank lines and malformed JSON without throwing", () => {
    const { activities } = parseKiroActivitiesFromLines([
      "",
      "not json",
      promptLine,
      "{}",
    ]);
    expect(activities).toHaveLength(1);
    expect(activities[0].type).toBe("user");
  });
});
