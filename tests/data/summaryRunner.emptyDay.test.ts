/**
 * Behavioral spec for `runSummary` when the requested date has zero
 * activity. Captures every observable side effect so future regressions
 * are loud:
 *
 *   - exit code returned by runSummary
 *   - whether `spawn` (the claude call) fired
 *   - whether the cache file was written
 *   - whether `regenerateIndex` was called
 *   - whether `openInDefaultApp` was called (and with which path)
 *
 * Tests are written against the *current behavior on this branch*
 * (PR #114, which removes the stub-file from v0.12.2). Tests that
 * currently fail document bugs the next PR has to fix; they should
 * not be deleted to make CI green.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false), // cache miss → goes to generation path
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => ""),
  writeFileSync: vi.fn(),
  createWriteStream: vi.fn(),
  copyFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    // Surfaces as a clear failure if any test ever lets the empty path
    // fall through to a real claude call.
    throw new Error("spawn() should not be called for an empty-activity day");
  }),
}));

vi.mock("../../src/data/sessions.js", () => ({
  discoverSessions: vi.fn(() => ({
    projects: [],
    coldProjects: [],
    totalCount: 0,
    timestamp: "",
  })),
  getProjectsDir: vi.fn(() => "/tmp/projects"),
}));

vi.mock("../../src/data/reportGenerator.js", () => ({
  // What generateReport returns for a date with no activity. The
  // empty-detection in summaryRunner counts `## ` lines (sessions),
  // `[HH:MM]` lines (activities), and `[HH:MM] ◆` lines (commits).
  // All three are zero for this output.
  generateReport: vi.fn(() => "No activity found for 2026-06-07.\n"),
}));

vi.mock("../../src/config/globalConfig.js", () => ({
  loadGlobalConfig: vi.fn(() => ({
    refreshIntervalMs: 2000,
    hiddenSessions: [],
    hiddenSubAgents: [],
    filterPresets: [[]],
  })),
}));

vi.mock("../../src/utils/openInDefaultApp.js", () => ({
  openInDefaultApp: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/data/summariesIndex.js", () => ({
  regenerateIndex: vi.fn(),
}));

const { spawn } = await import("node:child_process");
const { existsSync, readFileSync, unlinkSync, writeFileSync } = await import(
  "node:fs"
);
const { openInDefaultApp } = await import(
  "../../src/utils/openInDefaultApp.js"
);
const { regenerateIndex } = await import("../../src/data/summariesIndex.js");
const { runRangeSummary, runSummary } = await import(
  "../../src/data/summaryRunner.js"
);

const TARGET_DATE = new Date(2026, 5, 7); // 2026-06-07
const TODAY = new Date(2026, 5, 7);

function baseOpts(overrides: Record<string, unknown> = {}) {
  return {
    date: TARGET_DATE,
    today: TODAY,
    force: false,
    include: ["user", "response", "bash", "edit", "thinking"],
    detailLimit: 120,
    withGit: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runSummary, empty-activity day — baseline behavior (no flags)", () => {
  it("returns exit code 0 (empty day is a normal state, not an error)", async () => {
    const code = await runSummary(baseOpts());
    expect(code).toBe(0);
  });

  it("does not spawn the claude CLI", async () => {
    await runSummary(baseOpts());
    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not write a stub file to the summaries dir (v0.12.2 → 0.12.3 fix)", async () => {
    await runSummary(baseOpts());
    // The cache write was the bug v0.12.2 introduced: a "## Context …
    // No activity recorded" stub got plopped into the user's summaries
    // dir on every empty day. The fix on this branch removes it.
    const dailyWrites = vi
      .mocked(writeFileSync)
      .mock.calls.filter(([p]) => String(p).endsWith("2026-06-07.md"));
    expect(dailyWrites).toHaveLength(0);
  });

  it("does not regenerate the summaries index when no flag asks for it", async () => {
    await runSummary(baseOpts());
    // Conservative: no new daily file → nothing to add to the index.
    // (Whether `-I` should *force* a refresh is covered below.)
    expect(regenerateIndex).not.toHaveBeenCalled();
  });

  it("does not open anything (no flag asked for it)", async () => {
    await runSummary(baseOpts());
    expect(openInDefaultApp).not.toHaveBeenCalled();
  });
});

describe("runSummary, empty-activity day — `--open` / `-o`", () => {
  it("does not call openInDefaultApp (there is no file to open)", async () => {
    await runSummary(baseOpts({ open: true }));
    expect(openInDefaultApp).not.toHaveBeenCalled();
  });

  it("still returns exit 0", async () => {
    const code = await runSummary(baseOpts({ open: true }));
    expect(code).toBe(0);
  });
});

describe("runSummary, empty-activity day — `--open-index` / `-I`", () => {
  // `-I` is fundamentally different from `-o`: it asks for the
  // navigation hub, not for today's result. The hub is the user's
  // entry point to past summaries — it should open whether or not
  // today happens to be empty.
  //
  // The two tests below currently *fail* on this branch — they
  // document the regression that the next fix has to address:
  // - openInDefaultApp is gated on `!res.skipped`, so `-I` never
  //   fires on an empty day.
  // - regenerateIndex is gated the same way, so `index.md` may not
  //   even exist when the user opens it.

  it("calls openInDefaultApp on the index file even when activity is zero", async () => {
    await runSummary(baseOpts({ openIndex: true }));
    expect(openInDefaultApp).toHaveBeenCalledTimes(1);
    expect(openInDefaultApp).toHaveBeenCalledWith(
      expect.stringMatching(/index\.md$/),
    );
  });

  it("regenerates the index first so the file exists before opening", async () => {
    await runSummary(baseOpts({ openIndex: true }));
    expect(regenerateIndex).toHaveBeenCalledTimes(1);
  });

  it("does not open the (nonexistent) daily file when only `-I` was set", async () => {
    await runSummary(baseOpts({ openIndex: true }));
    const dailyOpens = vi
      .mocked(openInDefaultApp)
      .mock.calls.filter(([p]) => String(p).endsWith("2026-06-07.md"));
    expect(dailyOpens).toHaveLength(0);
  });
});

describe("runSummary, empty-activity day — combined `-oI`", () => {
  it("opens only the index (no daily file exists)", async () => {
    await runSummary(baseOpts({ open: true, openIndex: true }));
    const dailyOpens = vi
      .mocked(openInDefaultApp)
      .mock.calls.filter(([p]) => String(p).endsWith("2026-06-07.md"));
    const indexOpens = vi
      .mocked(openInDefaultApp)
      .mock.calls.filter(([p]) => String(p).endsWith("index.md"));
    expect(dailyOpens).toHaveLength(0);
    expect(indexOpens).toHaveLength(1);
  });
});

describe("runSummary, `--force` on a day that's empty AND already has a (legacy) cache file", () => {
  // Scenario: a user on 0.12.2 accumulated empty-day stub files
  // ("## Context\n\nNo activity recorded …"). They upgrade and run
  // `summary --date <past-empty-day> --force` either out of habit or
  // hoping to refresh things. We want this to be safe — no claude
  // call, no surprise file changes, and a graceful skip message.

  beforeEach(() => {
    // Force the cache existence check to return true so we exercise
    // the path where the legacy file is present on disk.
    vi.mocked(existsSync).mockImplementation((p) => {
      const path = String(p);
      // Existing cache file present.
      if (path.endsWith("2026-06-07.md")) return true;
      // Everything else (~/.agenthud dir checks, etc.) default false
      // so mkdirSync still gets called for the parent.
      return false;
    });
    vi.mocked(readFileSync).mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("2026-06-07.md")) {
        return "## Context\n\nNo activity recorded for 2026-06-07.\nLegacy stub.\n";
      }
      return "";
    });
  });

  it("does not spawn claude (the day still has no activity)", async () => {
    await runSummary(baseOpts({ force: true }));
    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not overwrite the existing (legacy stub) cache file", async () => {
    await runSummary(baseOpts({ force: true }));
    const dailyWrites = vi
      .mocked(writeFileSync)
      .mock.calls.filter(([p]) => String(p).endsWith("2026-06-07.md"));
    expect(dailyWrites).toHaveLength(0);
  });

  it("does not delete the legacy stub either (cleanup is the user's call)", async () => {
    // Conservative: refuse to delete files the user might have
    // hand-edited. Cleanup is a `rm` away.
    await runSummary(baseOpts({ force: true }));
    const dailyDeletes = vi
      .mocked(unlinkSync)
      .mock.calls.filter(([p]) => String(p).endsWith("2026-06-07.md"));
    expect(dailyDeletes).toHaveLength(0);
  });

  it("returns exit 0", async () => {
    expect(await runSummary(baseOpts({ force: true }))).toBe(0);
  });
});

describe("runSummary, empty day with a legacy cache file present (no --force)", () => {
  // Without `--force` the cache-hit short-circuit fires before the
  // empty-detection runs, so we return the cached stub as-is. This
  // documents the inherited-from-0.12.2 weirdness: the stub keeps
  // showing up in `summary --date X` output until the user deletes it.

  beforeEach(() => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p).endsWith("2026-06-07.md"),
    );
    vi.mocked(readFileSync).mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("2026-06-07.md")) {
        return "## Context\n\nNo activity recorded for 2026-06-07.\n";
      }
      return "";
    });
  });

  it("does not spawn claude (cache hit)", async () => {
    await runSummary(baseOpts());
    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not write to the cache file (read-only)", async () => {
    await runSummary(baseOpts());
    const dailyWrites = vi
      .mocked(writeFileSync)
      .mock.calls.filter(([p]) => String(p).endsWith("2026-06-07.md"));
    expect(dailyWrites).toHaveLength(0);
  });

  it("returns exit 0 from the cache-hit branch", async () => {
    expect(await runSummary(baseOpts())).toBe(0);
  });
});

describe("runRangeSummary, every day in the range is empty", () => {
  // Range mode iterates per-day, each day comes back as
  // `{ skipped: true, markdown: "" }`. With no daily markdowns to
  // combine, the meta-summary branch can't run and the runner has to
  // decide what to do at the end of an empty walk.

  function rangeOpts(overrides: Record<string, unknown> = {}) {
    return {
      from: new Date(2026, 5, 1), // 2026-06-01
      to: new Date(2026, 5, 7), // 2026-06-07
      today: new Date(2026, 5, 7),
      force: false,
      assumeYes: true, // skip the per-day Y/n confirmation
      include: ["user", "response", "bash", "edit", "thinking"],
      detailLimit: 120,
      withGit: false,
      ...overrides,
    };
  }

  it("does not spawn the meta-summary claude call (nothing to combine)", async () => {
    await runRangeSummary(rangeOpts());
    expect(spawn).not.toHaveBeenCalled();
  });

  it("returns exit 0 (consistent with `report` / daily summary on an empty period)", async () => {
    // CURRENT BEHAVIOR: returns 1 (treated as an error). The whole rest
    // of the codebase treats "no activity" as a normal state and
    // returns 0 (report does this, daily summary now does this).
    // This is the documented bug — the assertion below currently fails.
    const code = await runRangeSummary(rangeOpts());
    expect(code).toBe(0);
  });

  it("opens the index when `--open-index` is set, even though no meta was generated", async () => {
    // Same `-I` philosophy as daily: the user asked for the hub, not
    // for this range's output. The index lists past summaries
    // regardless of what just happened.
    await runRangeSummary(rangeOpts({ openIndex: true }));
    expect(openInDefaultApp).toHaveBeenCalledWith(
      expect.stringMatching(/index\.md$/),
    );
  });

  it("does not write a range cache file when there's nothing to combine", async () => {
    await runRangeSummary(rangeOpts());
    const rangeWrites = vi
      .mocked(writeFileSync)
      .mock.calls.filter(([p]) =>
        String(p).match(/range-2026-06-01_2026-06-07\.md$/),
      );
    expect(rangeWrites).toHaveLength(0);
  });
});
