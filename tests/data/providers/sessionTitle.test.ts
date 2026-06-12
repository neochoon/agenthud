import { describe, expect, it } from "vitest";
import { pickLatestUserTitle } from "../../../src/data/providers/sessionTitle.js";

describe("pickLatestUserTitle", () => {
  it("returns null for no messages", () => {
    expect(pickLatestUserTitle([])).toBeNull();
  });

  it("returns the only message", () => {
    expect(pickLatestUserTitle(["hello"])).toBe("hello");
  });

  it("prefers the latest non-slash message over the first", () => {
    expect(
      pickLatestUserTitle([
        "open the brainstorm",
        "implement oauth",
        "ship it",
      ]),
    ).toBe("ship it");
  });

  it("skips slash commands, keeping the latest real message", () => {
    expect(
      pickLatestUserTitle([
        "fix the bug",
        "now refactor",
        "/compact",
        "/model",
      ]),
    ).toBe("now refactor");
  });

  it("falls back to the first when every later message is a slash command", () => {
    expect(pickLatestUserTitle(["fix the bug", "/clear", "/compact"])).toBe(
      "fix the bug",
    );
  });

  it("uses the first line of a multi-line message", () => {
    expect(pickLatestUserTitle(["line one\nline two\nline three"])).toBe(
      "line one",
    );
  });

  it("drops messages the noise predicate rejects", () => {
    const isNoise = (t: string) =>
      t.trimStart().startsWith("<environment_context>");
    expect(
      pickLatestUserTitle(
        ["<environment_context>\n<cwd>/x</cwd>", "real prompt"],
        isNoise,
      ),
    ).toBe("real prompt");
  });

  it("ignores blank/whitespace-only messages", () => {
    expect(pickLatestUserTitle(["", "   ", "actual"])).toBe("actual");
  });
});
