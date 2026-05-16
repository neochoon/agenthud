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
