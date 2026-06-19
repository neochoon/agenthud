import { describe, expect, it } from "vitest";
import { formatEffectiveOptionsLine, getHelp, parseArgs } from "../src/cli.js";
import { DEFAULT_GLOBAL_CONFIG } from "../src/config/globalConfig.js";
import type { GlobalConfig } from "../src/types/index.js";

function makeConfig(overrides: Partial<GlobalConfig> = {}): GlobalConfig {
  return {
    ...DEFAULT_GLOBAL_CONFIG,
    ...overrides,
    report: { ...DEFAULT_GLOBAL_CONFIG.report, ...(overrides.report ?? {}) },
    summary: { ...DEFAULT_GLOBAL_CONFIG.summary, ...(overrides.summary ?? {}) },
  };
}

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

  it("parses 'watch' as a positional command (equivalent to no command)", () => {
    expect(parseArgs(["watch"])).toEqual({ mode: "watch" });
  });

  it("parses 'watch --once' the same as bare --once", () => {
    expect(parseArgs(["watch", "--once"])).toEqual({ mode: "once" });
  });

  it("parses 'watch --cwd' as scoped watch mode", () => {
    expect(parseArgs(["watch", "--cwd"])).toEqual({
      mode: "watch",
      scopeToCwd: true,
    });
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

    it("rejects impossible dates instead of letting JS normalize them", () => {
      // new Date(2026, 1, 31) silently becomes Mar 3 — the parser
      // must surface an error, not run the report for a different
      // day than the user typed. (reportDate still carries the
      // default; main.ts exits on reportError before using it.)
      const opts = parseArgs(["report", "--date", "2026-02-31"]);
      expect(opts.reportError).toBeDefined();
    });

    it("uses default include types when --include not given", () => {
      const opts = parseArgs(["report"]);
      expect(opts.reportInclude).toEqual([
        "user",
        "response",
        "bash",
        "edit",
        "thinking",
        "task",
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
        "task",
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

    describe("config-driven defaults", () => {
      it("uses config.report values when no flag is given", () => {
        const config = makeConfig({
          report: {
            include: ["bash", "edit"],
            detailLimit: 50,
            withGit: true,
            format: "json",
          },
        });
        const opts = parseArgs(["report"], config);
        expect(opts.reportInclude).toEqual(["bash", "edit"]);
        expect(opts.reportDetailLimit).toBe(50);
        expect(opts.reportWithGit).toBe(true);
        expect(opts.reportFormat).toBe("json");
      });

      it("CLI flag overrides config for --include", () => {
        const config = makeConfig({
          report: { ...DEFAULT_GLOBAL_CONFIG.report, include: ["bash"] },
        });
        const opts = parseArgs(["report", "--include", "edit"], config);
        expect(opts.reportInclude).toEqual(["edit"]);
      });

      it("CLI flag overrides config for --with-git (--with-git on)", () => {
        const config = makeConfig({
          report: { ...DEFAULT_GLOBAL_CONFIG.report, withGit: false },
        });
        const opts = parseArgs(["report", "--with-git"], config);
        expect(opts.reportWithGit).toBe(true);
      });

      it("falls back to the built-in defaults when no config is passed", () => {
        const opts = parseArgs(["report"]);
        expect(opts.reportInclude).toEqual(
          DEFAULT_GLOBAL_CONFIG.report.include,
        );
      });
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

    describe("--open / -o flag", () => {
      it("parses --open", () => {
        const opts = parseArgs(["summary", "--open"]);
        expect(opts.summaryError).toBeUndefined();
        expect(opts.summaryOpen).toBe(true);
      });

      it("parses -o", () => {
        const opts = parseArgs(["summary", "-o"]);
        expect(opts.summaryError).toBeUndefined();
        expect(opts.summaryOpen).toBe(true);
      });

      it("works alongside --last", () => {
        const opts = parseArgs(["summary", "--last", "7d", "--open"]);
        expect(opts.summaryError).toBeUndefined();
        expect(opts.summaryOpen).toBe(true);
        expect(opts.summaryFrom).toBeDefined();
      });

      it("defaults to undefined when neither flag is given", () => {
        const opts = parseArgs(["summary"]);
        expect(opts.summaryOpen).toBeUndefined();
      });
    });

    describe("--open-index / -I flag", () => {
      it("parses --open-index", () => {
        const opts = parseArgs(["summary", "--open-index"]);
        expect(opts.summaryError).toBeUndefined();
        expect(opts.summaryOpenIndex).toBe(true);
      });

      it("parses -I", () => {
        const opts = parseArgs(["summary", "-I"]);
        expect(opts.summaryError).toBeUndefined();
        expect(opts.summaryOpenIndex).toBe(true);
      });

      it("defaults to undefined when neither flag is given", () => {
        const opts = parseArgs(["summary"]);
        expect(opts.summaryOpenIndex).toBeUndefined();
      });

      it("can be combined with -o (both flags become true)", () => {
        const opts = parseArgs(["summary", "-o", "-I"]);
        expect(opts.summaryError).toBeUndefined();
        expect(opts.summaryOpen).toBe(true);
        expect(opts.summaryOpenIndex).toBe(true);
      });
    });

    describe("combined short flags (POSIX-style cluster)", () => {
      it("treats `-oI` as `-o -I`", () => {
        const opts = parseArgs(["summary", "-oI"]);
        expect(opts.summaryError).toBeUndefined();
        expect(opts.summaryOpen).toBe(true);
        expect(opts.summaryOpenIndex).toBe(true);
      });

      it("order does not matter — `-Io` works too", () => {
        const opts = parseArgs(["summary", "-Io"]);
        expect(opts.summaryError).toBeUndefined();
        expect(opts.summaryOpen).toBe(true);
        expect(opts.summaryOpenIndex).toBe(true);
      });

      it("combines with -y (`-yo` → assume-yes + open)", () => {
        const opts = parseArgs(["summary", "--last", "3d", "-yo"]);
        expect(opts.summaryError).toBeUndefined();
        expect(opts.summaryAssumeYes).toBe(true);
        expect(opts.summaryOpen).toBe(true);
      });

      it("does not split `-1d` etc. — date short-form stays intact", () => {
        // -1d is a documented --date value (1 day ago) and contains a
        // digit, so the cluster expander must leave it alone.
        const opts = parseArgs(["report", "--date", "-1d"]);
        expect(opts.reportError).toBeUndefined();
        expect(opts.reportDate).toBeDefined();
      });
    });

    describe("report-shaped options on summary", () => {
      it("parses --include and threads it through", () => {
        const opts = parseArgs(["summary", "--include", "response,user"]);
        expect(opts.summaryError).toBeUndefined();
        expect(opts.summaryInclude).toEqual(["response", "user"]);
      });

      it("parses --include all", () => {
        const opts = parseArgs(["summary", "--include", "all"]);
        expect(opts.summaryInclude).toEqual([
          "response",
          "bash",
          "edit",
          "thinking",
          "read",
          "glob",
          "user",
          "task",
        ]);
      });

      it("parses --detail-limit", () => {
        const opts = parseArgs(["summary", "--detail-limit", "0"]);
        expect(opts.summaryDetailLimit).toBe(0);
      });

      it("parses --with-git", () => {
        const opts = parseArgs(["summary", "--with-git"]);
        expect(opts.summaryWithGit).toBe(true);
      });

      it("parses --format json", () => {
        const opts = parseArgs(["summary", "--format", "json"]);
        expect(opts.summaryFormat).toBe("json");
      });
    });

    describe("config-driven defaults", () => {
      it("inherits report.* when summary section is empty", () => {
        const config = makeConfig({
          report: {
            include: ["bash", "edit"],
            detailLimit: 50,
            withGit: true,
            format: "json",
          },
          summary: {},
        });
        const opts = parseArgs(["summary"], config);
        expect(opts.summaryInclude).toEqual(["bash", "edit"]);
        expect(opts.summaryDetailLimit).toBe(50);
        expect(opts.summaryWithGit).toBe(true);
        expect(opts.summaryFormat).toBe("json");
      });

      it("summary.* overrides report.* field-by-field", () => {
        const config = makeConfig({
          report: {
            include: ["bash"],
            detailLimit: 50,
            withGit: false,
            format: "markdown",
          },
          summary: {
            include: ["edit"],
            detailLimit: 0,
            withGit: true,
            model: "haiku",
          },
        });
        const opts = parseArgs(["summary"], config);
        expect(opts.summaryInclude).toEqual(["edit"]);
        expect(opts.summaryDetailLimit).toBe(0);
        expect(opts.summaryWithGit).toBe(true);
        // format unset on summary → falls back to report
        expect(opts.summaryFormat).toBe("markdown");
        expect(opts.summaryModel).toBe("haiku");
      });

      it("CLI flag beats both summary and report config", () => {
        const config = makeConfig({
          report: { ...DEFAULT_GLOBAL_CONFIG.report, include: ["bash"] },
          summary: { include: ["edit"] },
        });
        const opts = parseArgs(["summary", "--include", "user"], config);
        expect(opts.summaryInclude).toEqual(["user"]);
      });

      it("falls back to the built-in defaults when no config is passed", () => {
        const opts = parseArgs(["summary"]);
        expect(opts.summaryInclude).toEqual(
          DEFAULT_GLOBAL_CONFIG.report.include,
        );
      });
    });
  });

  describe("follow subcommand", () => {
    it("returns follow mode by default", () => {
      const opts = parseArgs(["follow"]);
      expect(opts.mode).toBe("follow");
      expect(opts.followError).toBeUndefined();
    });

    it("parses --json and --since", () => {
      const opts = parseArgs(["follow", "--json", "--since", "2h"]);
      expect(opts.mode).toBe("follow");
      expect(opts.followJson).toBe(true);
      expect(opts.followSince).toBe("2h");
    });

    it("parses --include into a token list", () => {
      const opts = parseArgs(["follow", "--include", "bash,edit"]);
      expect(opts.followInclude).toEqual(["bash", "edit"]);
    });

    it("rejects an unknown --include type", () => {
      const opts = parseArgs(["follow", "--include", "bash,bogus"]);
      expect(opts.followError).toBeDefined();
    });

    it("sets followError on an unknown flag", () => {
      const opts = parseArgs(["follow", "--bogus"]);
      expect(opts.followError).toBeDefined();
    });
  });
});

describe("formatEffectiveOptionsLine", () => {
  it("formats report defaults compactly", () => {
    const line = formatEffectiveOptionsLine("report", {
      include: ["user", "response", "bash", "edit", "thinking"],
      detailLimit: 120,
      withGit: false,
      format: "markdown",
    });
    expect(line).toBe(
      "report → include=[user,response,bash,edit,thinking] detail-limit=120 with-git=off format=markdown",
    );
  });

  it("renders detailLimit=0 as ∞ and with-git=true as on", () => {
    const line = formatEffectiveOptionsLine("summary", {
      include: ["bash"],
      detailLimit: 0,
      withGit: true,
      model: "sonnet",
    });
    expect(line).toBe(
      "summary → include=[bash] detail-limit=∞ with-git=on model=sonnet",
    );
  });

  it("omits format/model when not set", () => {
    const line = formatEffectiveOptionsLine("report", {
      include: ["response"],
      detailLimit: 120,
      withGit: false,
    });
    expect(line).toContain("include=[response]");
    expect(line).not.toContain("format=");
    expect(line).not.toContain("model=");
  });
});

describe("getHelp", () => {
  it("includes usage line", () => {
    expect(getHelp()).toContain("Usage: agenthud");
  });

  it("mentions config path", () => {
    expect(getHelp()).toContain("~/.agenthud/config.yaml");
  });

  it("documents the follow subcommand", () => {
    expect(getHelp()).toContain("follow");
  });
});
