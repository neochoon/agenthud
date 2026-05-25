import { describe, expect, it } from "vitest";
import {
  buildToolDetailBody,
  summarizeToolDetail,
} from "../../src/data/toolDetails.js";

const editHunks = [
  {
    oldStart: 45,
    oldLines: 3,
    newStart: 45,
    newLines: 3,
    lines: [" ctx", "-old", "+new"],
  },
];

describe("summarizeToolDetail", () => {
  it("Edit: basename + line range + change counts", () => {
    expect(
      summarizeToolDetail(
        "Edit",
        { file_path: "/x/App.tsx" },
        { structuredPatch: editHunks },
      ),
    ).toBe("App.tsx L45-47 +1 -1");
  });

  it("Edit: spans multiple hunks and drops a zero count side", () => {
    const hunks = [
      {
        oldStart: 10,
        oldLines: 0,
        newStart: 10,
        newLines: 2,
        lines: ["+a", "+b"],
      },
      { oldStart: 40, oldLines: 0, newStart: 42, newLines: 1, lines: ["+c"] },
    ];
    expect(
      summarizeToolDetail(
        "Edit",
        { file_path: "/x/a.ts" },
        { structuredPatch: hunks },
      ),
    ).toBe("a.ts L10-42 +3");
  });

  it("Edit: no structuredPatch falls back to basename", () => {
    expect(
      summarizeToolDetail("Edit", { file_path: "/x/a.ts" }, undefined),
    ).toBe("a.ts");
  });

  it("Write: range + added count from structuredPatch", () => {
    const hunks = [
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 65,
        lines: Array(65).fill("+x"),
      },
    ];
    expect(
      summarizeToolDetail(
        "Write",
        { file_path: "/x/package.json" },
        { structuredPatch: hunks },
      ),
    ).toBe("package.json L1-65 +65");
  });

  it("Write: no patch derives range from content line count", () => {
    expect(
      summarizeToolDetail(
        "Write",
        { file_path: "/x/a.ts", content: "l1\nl2\nl3" },
        undefined,
      ),
    ).toBe("a.ts L1-3 +3");
  });

  it("Write: counts lines correctly when content ends with a trailing newline", () => {
    expect(
      summarizeToolDetail(
        "Write",
        { file_path: "/x/a.ts", content: "l1\nl2\n" },
        undefined,
      ),
    ).toBe("a.ts L1-2 +2");
  });

  it("Read: range from result.file startLine/numLines", () => {
    expect(
      summarizeToolDetail(
        "Read",
        { file_path: "/x/a.ts" },
        { file: { startLine: 60, numLines: 130 } },
      ),
    ).toBe("a.ts L60-189");
  });

  it("Read: range from input offset/limit when no result", () => {
    expect(
      summarizeToolDetail(
        "Read",
        { file_path: "/x/a.ts", offset: 60, limit: 130 },
        undefined,
      ),
    ).toBe("a.ts L60-189");
  });

  it("Read: bare basename when no range info", () => {
    expect(
      summarizeToolDetail("Read", { file_path: "/x/a.ts" }, undefined),
    ).toBe("a.ts");
  });

  it("TaskUpdate: status change", () => {
    expect(
      summarizeToolDetail(
        "TaskUpdate",
        { taskId: "1" },
        { statusChange: { from: "pending", to: "in_progress" } },
      ),
    ).toBe("#1 pending→in_progress");
  });

  it("TaskUpdate: falls back to updatedFields, then input status", () => {
    expect(
      summarizeToolDetail(
        "TaskUpdate",
        { taskId: "2" },
        { updatedFields: ["subject", "status"] },
      ),
    ).toBe("#2 subject, status");
    expect(
      summarizeToolDetail(
        "TaskUpdate",
        { taskId: "3", status: "completed" },
        undefined,
      ),
    ).toBe("#3 completed");
  });

  it("TaskCreate: subject", () => {
    expect(
      summarizeToolDetail("TaskCreate", { subject: "Do the thing" }, undefined),
    ).toBe("Do the thing");
  });

  it("other tools fall back to existing detail (command/basename)", () => {
    expect(
      summarizeToolDetail("Bash", { command: "npm test" }, undefined),
    ).toBe("npm test");
    expect(summarizeToolDetail("Grep", { pattern: "foo" }, undefined)).toBe(
      "foo",
    );
  });
});

describe("buildToolDetailBody", () => {
  it("Edit: reconstructs a unified diff with kind 'diff'", () => {
    const body = buildToolDetailBody(
      "Edit",
      { file_path: "/x/App.tsx" },
      { structuredPatch: editHunks },
    );
    expect(body).toEqual({
      text: "@@ -45,3 +45,3 @@\n ctx\n-old\n+new",
      kind: "diff",
    });
  });

  it("Edit: null when no structuredPatch", () => {
    expect(
      buildToolDetailBody("Edit", { file_path: "/x/a.ts" }, undefined),
    ).toBeNull();
  });

  it("Write: content body with kind 'code'", () => {
    expect(
      buildToolDetailBody(
        "Write",
        { file_path: "/x/a.ts", content: "hello\nworld" },
        undefined,
      ),
    ).toEqual({ text: "hello\nworld", kind: "code" });
  });

  it("Write: prefers content (code) even when a structuredPatch is also present", () => {
    const hunks = [
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 2,
        lines: ["+a", "+b"],
      },
    ];
    expect(
      buildToolDetailBody(
        "Write",
        { file_path: "/x/a.ts" },
        { content: "a\nb", structuredPatch: hunks },
      ),
    ).toEqual({ text: "a\nb", kind: "code" });
  });

  it("Write: falls back to a diff body when there is a patch but no content", () => {
    const hunks = [
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 2,
        lines: ["+a", "+b"],
      },
    ];
    const body = buildToolDetailBody(
      "Write",
      { file_path: "/x/a.ts" },
      { structuredPatch: hunks },
    );
    expect(body).toEqual({ text: "@@ -0,0 +1,2 @@\n+a\n+b", kind: "diff" });
  });

  it("Read and Task tools have no body", () => {
    expect(
      buildToolDetailBody(
        "Read",
        { file_path: "/x/a.ts", offset: 1, limit: 5 },
        undefined,
      ),
    ).toBeNull();
    expect(
      buildToolDetailBody("TaskUpdate", { taskId: "1" }, undefined),
    ).toBeNull();
    expect(
      buildToolDetailBody("Bash", { command: "ls" }, undefined),
    ).toBeNull();
  });
});
