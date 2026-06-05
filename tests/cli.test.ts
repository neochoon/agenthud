import { describe, expect, it } from "vitest";
import { getHelp, parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  it("defaults to watch mode", () => {
    expect(parseArgs([])).toEqual({ mode: "watch" });
  });

  it("parses --once", () => {
    expect(parseArgs(["--once"])).toEqual({ mode: "once" });
  });

  it("parses --help", () => {
    expect(parseArgs(["--help"])).toEqual({ mode: "watch", command: "help" });
  });

  it("parses -h", () => {
    expect(parseArgs(["-h"])).toEqual({ mode: "watch", command: "help" });
  });

  it("parses --version", () => {
    expect(parseArgs(["--version"])).toEqual({
      mode: "watch",
      command: "version",
    });
  });

  it("parses -V", () => {
    expect(parseArgs(["-V"])).toEqual({ mode: "watch", command: "version" });
  });

  it("parses --cwd as a watch-mode scope flag", () => {
    expect(parseArgs(["--cwd"])).toEqual({ mode: "watch", scopeToCwd: true });
  });

  it("parses --cwd combined with --once", () => {
    expect(parseArgs(["--once", "--cwd"])).toEqual({
      mode: "once",
      scopeToCwd: true,
    });
  });

  it("does not set scopeToCwd when --cwd is absent", () => {
    const opts = parseArgs([]);
    expect(opts.scopeToCwd).toBeUndefined();
  });

  it("includes 'user' in report's default --include set", () => {
    // Without 'user', report drops every user prompt and 'Thinking' ends
    // up as the first entry of each session block — the report reads as
    // if Claude acted out of nowhere.
    const opts = parseArgs(["report"]);
    expect(opts.reportInclude).toContain("user");
  });

  describe("unknown commands and flags", () => {
    it("returns error for unknown subcommand", () => {
      const opts = parseArgs(["foobar"]);
      expect(opts.error).toContain("Unknown command");
      expect(opts.error).toContain("foobar");
    });

    it("returns error for unknown flag", () => {
      const opts = parseArgs(["--unknown"]);
      expect(opts.error).toContain("Unknown option");
      expect(opts.error).toContain("--unknown");
    });

    it("returns error for unknown flag in report subcommand", () => {
      const opts = parseArgs(["report", "--unknown"]);
      expect(opts.mode).toBe("report");
      expect(opts.reportError).toContain("Unknown option");
      expect(opts.reportError).toContain("--unknown");
    });
  });

  describe("report subcommand", () => {
    it("returns report mode with today when no date given", () => {
      const opts = parseArgs(["report"]);
      expect(opts.mode).toBe("report");
      expect(opts.reportDate).toBeDefined();
      const today = new Date();
      expect(opts.reportDate!.getFullYear()).toBe(today.getFullYear());
      expect(opts.reportDate!.getMonth()).toBe(today.getMonth());
      expect(opts.reportDate!.getDate()).toBe(today.getDate());
    });

    it("parses --date YYYY-MM-DD", () => {
      const opts = parseArgs(["report", "--date", "2026-05-14"]);
      expect(opts.mode).toBe("report");
      expect(opts.reportDate!.getFullYear()).toBe(2026);
      expect(opts.reportDate!.getMonth()).toBe(4); // May = 4
      expect(opts.reportDate!.getDate()).toBe(14);
    });

    it("parses --date today", () => {
      const opts = parseArgs(["report", "--date", "today"]);
      expect(opts.mode).toBe("report");
      const today = new Date();
      expect(opts.reportDate!.getDate()).toBe(today.getDate());
    });

    it("uses default include types when --include not given", () => {
      const opts = parseArgs(["report"]);
      expect(opts.reportInclude).toEqual([
        "user",
        "response",
        "bash",
        "edit",
        "thinking",
      ]);
    });

    it("parses --include all", () => {
      const opts = parseArgs(["report", "--include", "all"]);
      expect(opts.reportInclude).toEqual([
        "response",
        "bash",
        "edit",
        "thinking",
        "read",
        "glob",
        "user",
      ]);
    });

    it("parses --include response,edit", () => {
      const opts = parseArgs(["report", "--include", "response,edit"]);
      expect(opts.reportInclude).toEqual(["response", "edit"]);
    });

    it("accepts a -Nd value to --date without flagging it as unknown", () => {
      // The unknown-flag scan must skip values that follow flags taking
      // a value (otherwise `-1d` as a documented --date format is read
      // as an unknown flag).
      const opts = parseArgs(["report", "--date", "-1d"]);
      expect(opts.reportError).toBeUndefined();
      // -1d → yesterday at local midnight
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      expect(opts.reportDate?.getTime()).toBe(yesterday.getTime());
    });

    it("returns error for an unknown --include type (typo)", () => {
      const opts = parseArgs(["report", "--include", "response,bas"]);
      expect(opts.reportError).toBeDefined();
      expect(opts.reportError).toContain('"bas"');
      expect(opts.reportError).toContain("Valid types");
    });

    it("lists multiple unknown --include types in the error", () => {
      const opts = parseArgs(["report", "--include", "response,bas,foo"]);
      expect(opts.reportError).toBeDefined();
      expect(opts.reportError).toContain('"bas"');
      expect(opts.reportError).toContain('"foo"');
    });

    it("returns error when --include has no value", () => {
      const opts = parseArgs(["report", "--include"]);
      expect(opts.reportError).toContain("missing value");
    });

    it("returns error for invalid date", () => {
      const opts = parseArgs(["report", "--date", "not-a-date"]);
      expect(opts.mode).toBe("report");
      expect(opts.reportError).toContain("Invalid date");
    });

    it("defaults to markdown format", () => {
      const opts = parseArgs(["report"]);
      expect(opts.reportFormat).toBe("markdown");
    });

    it("parses --format json", () => {
      const opts = parseArgs(["report", "--format", "json"]);
      expect(opts.reportFormat).toBe("json");
    });

    it("parses --format markdown", () => {
      const opts = parseArgs(["report", "--format", "markdown"]);
      expect(opts.reportFormat).toBe("markdown");
    });

    it("returns error for invalid format", () => {
      const opts = parseArgs(["report", "--format", "csv"]);
      expect(opts.reportError).toContain("Invalid format");
      expect(opts.reportError).toContain("csv");
    });

    it("parses --detail-limit N", () => {
      const opts = parseArgs(["report", "--detail-limit", "500"]);
      expect(opts.reportDetailLimit).toBe(500);
    });

    it("parses --detail-limit 0 (unlimited)", () => {
      const opts = parseArgs(["report", "--detail-limit", "0"]);
      expect(opts.reportDetailLimit).toBe(0);
    });

    it("returns error for invalid --detail-limit", () => {
      const opts = parseArgs(["report", "--detail-limit", "abc"]);
      expect(opts.reportError).toContain("Invalid --detail-limit");
    });

    it("sets reportWithGit when --with-git is passed", () => {
      const opts = parseArgs(["report", "--with-git"]);
      expect(opts.reportWithGit).toBe(true);
    });

    it("reportWithGit is falsy by default", () => {
      const opts = parseArgs(["report"]);
      expect(opts.reportWithGit).toBeFalsy();
    });
  });

  describe("summary subcommand", () => {
    it("returns summary mode with today by default", () => {
      const opts = parseArgs(["summary"]);
      expect(opts.mode).toBe("summary");
      expect(opts.summaryDate).toBeDefined();
      const today = new Date();
      expect(opts.summaryDate!.getFullYear()).toBe(today.getFullYear());
      expect(opts.summaryDate!.getMonth()).toBe(today.getMonth());
      expect(opts.summaryDate!.getDate()).toBe(today.getDate());
      expect(opts.summaryForce).toBe(false);
    });

    it("parses --date", () => {
      const opts = parseArgs(["summary", "--date", "2026-05-14"]);
      expect(opts.summaryDate!.getFullYear()).toBe(2026);
      expect(opts.summaryDate!.getMonth()).toBe(4);
      expect(opts.summaryDate!.getDate()).toBe(14);
    });

    it("parses --prompt", () => {
      const opts = parseArgs(["summary", "--prompt", "just commits"]);
      expect(opts.summaryPrompt).toBe("just commits");
    });

    it("parses --force", () => {
      const opts = parseArgs(["summary", "--force"]);
      expect(opts.summaryForce).toBe(true);
    });

    it("returns error for unknown flag", () => {
      const opts = parseArgs(["summary", "--bogus"]);
      expect(opts.summaryError).toContain("Unknown option");
    });

    it("returns error for invalid date", () => {
      const opts = parseArgs(["summary", "--date", "not-a-date"]);
      expect(opts.summaryError).toContain("Invalid date");
    });

    it("parses --last 7d into a 7-day range ending today", () => {
      const opts = parseArgs(["summary", "--last", "7d"]);
      expect(opts.summaryError).toBeUndefined();
      expect(opts.summaryFrom).toBeDefined();
      expect(opts.summaryTo).toBeDefined();
      const days =
        (opts.summaryTo!.getTime() - opts.summaryFrom!.getTime()) /
          (1000 * 60 * 60 * 24) +
        1;
      expect(days).toBe(7);
      const today = new Date();
      expect(opts.summaryTo!.getDate()).toBe(today.getDate());
      // summaryDate should be undefined in range mode
      expect(opts.summaryDate).toBeUndefined();
    });

    it("returns error for malformed --last", () => {
      const opts = parseArgs(["summary", "--last", "7"]);
      expect(opts.summaryError).toContain("Invalid --last");
    });

    it("returns error for --last 0d", () => {
      const opts = parseArgs(["summary", "--last", "0d"]);
      expect(opts.summaryError).toContain("at least 1");
    });

    it("parses --from --to into a range", () => {
      const opts = parseArgs([
        "summary",
        "--from",
        "2026-05-10",
        "--to",
        "2026-05-16",
      ]);
      expect(opts.summaryError).toBeUndefined();
      expect(opts.summaryFrom!.getDate()).toBe(10);
      expect(opts.summaryTo!.getDate()).toBe(16);
    });

    it("requires both --from and --to", () => {
      const opts = parseArgs(["summary", "--from", "2026-05-10"]);
      expect(opts.summaryError).toContain("must be used together");
    });

    it("rejects --from after --to", () => {
      const opts = parseArgs([
        "summary",
        "--from",
        "2026-05-20",
        "--to",
        "2026-05-10",
      ]);
      expect(opts.summaryError).toContain("must be on or before");
    });

    it("rejects mixing --date with --last", () => {
      const opts = parseArgs([
        "summary",
        "--date",
        "2026-05-14",
        "--last",
        "3d",
      ]);
      expect(opts.summaryError).toContain("mutually exclusive");
    });

    it("rejects mixing --last with --from/--to", () => {
      const opts = parseArgs([
        "summary",
        "--last",
        "3d",
        "--from",
        "2026-05-10",
        "--to",
        "2026-05-16",
      ]);
      expect(opts.summaryError).toContain("mutually exclusive");
    });

    it("parses -y as assume-yes", () => {
      const opts = parseArgs(["summary", "--last", "3d", "-y"]);
      expect(opts.summaryAssumeYes).toBe(true);
    });

    it("parses --yes as assume-yes", () => {
      const opts = parseArgs(["summary", "--last", "3d", "--yes"]);
      expect(opts.summaryAssumeYes).toBe(true);
    });

    it("defaults assume-yes to false", () => {
      const opts = parseArgs(["summary"]);
      expect(opts.summaryAssumeYes).toBe(false);
    });

    it("parses --model and forwards the alias", () => {
      const opts = parseArgs(["summary", "--model", "sonnet"]);
      expect(opts.summaryError).toBeUndefined();
      expect(opts.summaryModel).toBe("sonnet");
    });

    it("parses --model with a full model id", () => {
      const opts = parseArgs(["summary", "--model", "claude-sonnet-4-6"]);
      expect(opts.summaryModel).toBe("claude-sonnet-4-6");
    });

    it("errors when --model has no value", () => {
      const opts = parseArgs(["summary", "--model"]);
      expect(opts.summaryError).toContain("missing value");
    });

    it("leaves summaryModel undefined when --model is not passed", () => {
      const opts = parseArgs(["summary"]);
      expect(opts.summaryModel).toBeUndefined();
    });
  });
});

describe("getHelp", () => {
  it("includes usage line", () => {
    expect(getHelp()).toContain("Usage: agenthud");
  });

  it("mentions config path", () => {
    expect(getHelp()).toContain("~/.agenthud/config.yaml");
  });
});
