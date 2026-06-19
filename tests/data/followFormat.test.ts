import { describe, expect, it } from "vitest";
import { formatHuman, formatJson } from "../../src/data/followFormat.js";
import type { FollowEvent } from "../../src/data/followTypes.js";

const base = {
  ts: 1718000000000,
  provider: "claude",
  project: "agenthud",
  projectPath: "/p",
  session: "cbe5773f00",
  subagent: null,
};

describe("formatJson", () => {
  it("is a single JSON line that round-trips", () => {
    const e: FollowEvent = {
      ...base,
      type: "activity",
      label: "Edit",
      detail: "src/x.ts",
    };
    const line = formatJson(e);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toMatchObject({
      type: "activity",
      session: "cbe5773f00",
      label: "Edit",
    });
  });
});

describe("formatHuman", () => {
  it("labels with project/session and the activity", () => {
    const e: FollowEvent = {
      ...base,
      type: "activity",
      label: "Edit",
      detail: "src/x.ts",
    };
    const line = formatHuman(e);
    expect(line).toContain("agenthud/cbe5773f"); // project/short-session
    expect(line).toContain("Edit");
    expect(line).toContain("src/x.ts");
  });

  it("includes the sub-agent segment when present", () => {
    const e: FollowEvent = {
      ...base,
      subagent: "code-reviewer",
      type: "activity",
      label: "Read",
      detail: "f.ts",
    };
    expect(formatHuman(e)).toContain("agenthud/cbe5773f/code-reviewer");
  });

  it("renders a state transition", () => {
    const e: FollowEvent = {
      ...base,
      type: "state",
      from: "working",
      to: "waiting",
    };
    const line = formatHuman(e);
    expect(line).toContain("waiting");
  });

  it("renders a lifecycle kind", () => {
    const e: FollowEvent = { ...base, type: "lifecycle", kind: "session_end" };
    expect(formatHuman(e)).toContain("session_end");
  });
});

describe("formatHuman is newline-safe", () => {
  it("flattens a multi-line activity detail to a single line", () => {
    const e: FollowEvent = {
      ...base,
      type: "activity",
      label: "Response",
      detail: "line one\nline two\tthree",
    };
    const line = formatHuman(e);
    expect(line).not.toContain("\n");
    expect(line).toContain("line one line two three");
  });
});
