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

  it("Read: shows the read content as code with line numbers from startLine", () => {
    expect(
      buildToolDetailBody(
        "Read",
        { file_path: "/x/a.ts", offset: 38, limit: 2 },
        { file: { content: "first\nsecond", startLine: 38, numLines: 2 } },
      ),
    ).toEqual({ text: "38: first\n39: second", kind: "code", numbered: true });
  });

  it("Read: right-aligns line numbers when the range crosses digit widths", () => {
    expect(
      buildToolDetailBody(
        "Read",
        { file_path: "/x/a.ts" },
        { file: { content: "a\nb\nc", startLine: 99, numLines: 3 } },
      ),
    ).toEqual({ text: " 99: a\n100: b\n101: c", kind: "code", numbered: true });
  });

  it("Read: preserves indentation after the line-number prefix", () => {
    expect(
      buildToolDetailBody(
        "Read",
        { file_path: "/x/a.ts" },
        { file: { content: "fn() {\n    x = 1;", startLine: 1, numLines: 2 } },
      ),
    ).toEqual({ text: "1: fn() {\n2:     x = 1;", kind: "code", numbered: true });
  });

  it("Read: drops the phantom trailing line from a final newline", () => {
    expect(
      buildToolDetailBody(
        "Read",
        { file_path: "/x/a.ts" },
        { file: { content: "x\ny\n", startLine: 5, numLines: 2 } },
      ),
    ).toEqual({ text: "5: x\n6: y", kind: "code", numbered: true });
  });

  it("Read: falls back to input offset for the start line when startLine is absent", () => {
    expect(
      buildToolDetailBody(
        "Read",
        { file_path: "/x/a.ts", offset: 10, limit: 1 },
        { file: { content: "only" } },
      ),
    ).toEqual({ text: "10: only", kind: "code", numbered: true });
  });

  it("Read without file content, and TaskUpdate/Bash tools, have no body", () => {
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

  it("Task: returns the subagent result content as kind 'code'", () => {
    expect(
      buildToolDetailBody(
        "Task",
        { description: "find auth code" },
        { content: "Found auth in src/auth.ts:42 — uses passport.\n" },
      ),
    ).toEqual({
      text: "Found auth in src/auth.ts:42 — uses passport.\n",
      kind: "code",
    });
  });

  it("Task: null when result is missing", () => {
    expect(
      buildToolDetailBody("Task", { description: "x" }, undefined),
    ).toBeNull();
  });

  it("Task: null when result has no content", () => {
    expect(buildToolDetailBody("Task", { description: "x" }, {})).toBeNull();
  });

  it("Bash: stdout only, not interrupted → trims trailing newline", () => {
    expect(
      buildToolDetailBody(
        "Bash",
        { command: "ls" },
        { stdout: "file1.ts\nfile2.ts\n", stderr: "", interrupted: false },
      ),
    ).toEqual({ text: "file1.ts\nfile2.ts", kind: "code" });
  });

  it("Bash: stderr only → just the stderr text", () => {
    expect(
      buildToolDetailBody(
        "Bash",
        { command: "cat missing" },
        {
          stdout: "",
          stderr: "cat: missing: No such file or directory\n",
          interrupted: false,
        },
      ),
    ).toEqual({
      text: "cat: missing: No such file or directory",
      kind: "code",
    });
  });

  it("Bash: stdout + stderr → stdout, blank, --- stderr ---, blank, stderr", () => {
    expect(
      buildToolDetailBody(
        "Bash",
        { command: "npm test" },
        {
          stdout: "PASS test1\nFAIL test2",
          stderr: "warning: deprecation",
          interrupted: false,
        },
      ),
    ).toEqual({
      text: "PASS test1\nFAIL test2\n\n--- stderr ---\nwarning: deprecation",
      kind: "code",
    });
  });

  it("Bash: interrupted appends [interrupted] marker after output", () => {
    expect(
      buildToolDetailBody(
        "Bash",
        { command: "long-running-thing" },
        { stdout: "started...", stderr: "", interrupted: true },
      ),
    ).toEqual({ text: "started...\n\n[interrupted]", kind: "code" });
  });

  it("Bash: interrupted only, no output → just the [interrupted] marker", () => {
    expect(
      buildToolDetailBody(
        "Bash",
        { command: "sleep 100" },
        { stdout: "", stderr: "", interrupted: true },
      ),
    ).toEqual({ text: "[interrupted]", kind: "code" });
  });

  it("Bash: null when result is missing", () => {
    expect(
      buildToolDetailBody("Bash", { command: "ls" }, undefined),
    ).toBeNull();
  });

  it("Bash: null when all three fields are absent or empty", () => {
    expect(buildToolDetailBody("Bash", { command: "ls" }, {})).toBeNull();
    expect(
      buildToolDetailBody(
        "Bash",
        { command: "ls" },
        { stdout: "", stderr: "", interrupted: false },
      ),
    ).toBeNull();
  });

  it("Bash branch does not affect non-Bash tools (Edit unaffected)", () => {
    // Sanity — adding the Bash branch shouldn't accidentally swallow
    // results that happen to carry stdout-shaped fields for unrelated
    // tools (defensive against future shape drift).
    expect(
      buildToolDetailBody(
        "Edit",
        { file_path: "/x/a.ts" },
        { stdout: "should not be used" } as unknown as never,
      ),
    ).toBeNull();
  });
});
