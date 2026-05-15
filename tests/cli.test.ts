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
