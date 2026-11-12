/**
 * Scoped-summary plumbing: cache filenames, index parsing and the
 * titles/labels the index renders. The important invariant here is that
 * a scoped digest and the whole-day digest for the SAME date are
 * different files — otherwise summarising one project silently destroys
 * the day's full digest.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scopeSlugFor } from "../../src/data/scope.js";
import {
  buildIndexMarkdown,
  buildTitleLine,
  parseSummaryFilename,
  scopeLabelFromSlug,
} from "../../src/data/summariesIndex.js";
import {
  dailySummaryPath,
  rangeSummaryPath,
} from "../../src/data/summaryRunner.js";

const DAY = new Date(2026, 10, 12);
const PROJECT = join("C:", "file", "sometime", "agenthud");

describe("scoped cache filenames", () => {
  it("keeps the whole-day digest name unchanged", () => {
    expect(dailySummaryPath(DAY).endsWith(`${join("", "2026-11-12.md")}`)).toBe(
      true,
    );
  });

  it("adds the scope slug for a scoped digest", () => {
    const scoped = dailySummaryPath(DAY, [PROJECT]);
    expect(scoped).toContain(`2026-11-12--${scopeSlugFor(PROJECT)}.md`);
    expect(scoped).not.toBe(dailySummaryPath(DAY));
  });

  it("scopes range digests the same way", () => {
    const scoped = rangeSummaryPath(DAY, DAY, [PROJECT]);
    expect(scoped).toContain(
      `range-2026-11-12_2026-11-12--${scopeSlugFor(PROJECT)}.md`,
    );
  });

  it("gives two same-named projects different files", () => {
    const a = dailySummaryPath(DAY, [join("C:", "one", "web")]);
    const b = dailySummaryPath(DAY, [join("C:", "two", "web")]);
    expect(a).not.toBe(b);
  });
});

describe("index parsing of scoped files", () => {
  it("parses an unscoped daily as before", () => {
    expect(parseSummaryFilename("2026-11-12.md")).toEqual({
      kind: "daily",
      date: DAY,
      filename: "2026-11-12.md",
    });
  });

  it("attaches the scope of a scoped daily", () => {
    const entry = parseSummaryFilename("2026-11-12--agenthud-3f2a1b.md");
    expect(entry?.kind).toBe("daily");
    expect(entry?.scope).toBe("agenthud-3f2a1b");
  });

  it("attaches the scope of a scoped range", () => {
    const entry = parseSummaryFilename(
      "range-2026-11-01_2026-11-07--web-ab12cd.md",
    );
    expect(entry?.kind).toBe("range");
    if (entry?.kind !== "range") return;
    expect(entry.scope).toBe("web-ab12cd");
    expect(entry.from.getDate()).toBe(1);
    expect(entry.to.getDate()).toBe(7);
  });

  it("rejects a malformed scope suffix", () => {
    expect(parseSummaryFilename("2026-11-12--Bad Scope.md")).toBeNull();
    expect(parseSummaryFilename("2026-11-12--.md")).toBeNull();
  });
});

describe("scoped titles and index rows", () => {
  const daily = parseSummaryFilename("2026-11-12--agenthud-3f2a1b.md");
  const plain = parseSummaryFilename("2026-11-12.md");
  const ranged = parseSummaryFilename(
    "range-2026-11-10_2026-11-12--agenthud-3f2a1b.md",
  );

  it("labels a slug without its hash", () => {
    expect(scopeLabelFromSlug("agenthud-3f2a1b")).toBe("agenthud");
    expect(scopeLabelFromSlug("my-app-abc123")).toBe("my-app");
    // A slug-shaped string with no hash is returned as-is.
    expect(scopeLabelFromSlug("plain")).toBe("plain");
  });

  it("appends the project to the file title", () => {
    if (!daily) throw new Error("fixture");
    expect(buildTitleLine(daily)).toBe("# 2026-11-12 (Thursday) · agenthud");
    if (!plain) throw new Error("fixture");
    expect(buildTitleLine(plain)).toBe("# 2026-11-12 (Thursday)");
    if (!ranged) throw new Error("fixture");
    expect(buildTitleLine(ranged)).toBe(
      "# Range: 2026-11-10 → 2026-11-12 · agenthud",
    );
  });

  it("keeps the day row and its scoped rows apart in the index", () => {
    const entries = [plain, daily].filter((e) => e !== null);
    const md = buildIndexMarkdown(entries);
    expect(md).toContain("(./2026-11-12.md)");
    expect(md).toContain("(./2026-11-12--agenthud-3f2a1b.md) · agenthud");
    // The whole-day digest sorts before the scoped one.
    expect(md.indexOf("2026-11-12.md")).toBeLessThan(
      md.indexOf("2026-11-12--agenthud-3f2a1b.md"),
    );
  });
});

describe("multi-workspace scope sets", () => {
  const OTHER = join("C:", "file", "desktop_pet");

  it("joins slugs with + and is order-independent", () => {
    const a = dailySummaryPath(DAY, [PROJECT, OTHER]);
    const b = dailySummaryPath(DAY, [OTHER, PROJECT]);
    expect(a).toBe(b);
    expect(a).toContain(`--${scopeSlugFor(PROJECT)}+${scopeSlugFor(OTHER)}.md`);
  });

  it("dedupes repeated paths", () => {
    expect(dailySummaryPath(DAY, [PROJECT, PROJECT])).toBe(
      dailySummaryPath(DAY, [PROJECT]),
    );
  });

  it("parses a joined scope and labels it", () => {
    const entry = parseSummaryFilename(
      `2026-11-12--${scopeSlugFor(PROJECT)}+${scopeSlugFor(OTHER)}.md`,
    );
    expect(entry?.scope).toContain("+");
    if (!entry) throw new Error("fixture");
    expect(scopeLabelFromSlug(entry.scope as string)).toBe(
      "agenthud + desktop-pet",
    );
  });

  it("puts the label in the title and index row", () => {
    const entry = parseSummaryFilename(
      `2026-11-12--${scopeSlugFor(PROJECT)}+${scopeSlugFor(OTHER)}.md`,
    );
    if (!entry) throw new Error("fixture");
    expect(buildTitleLine(entry)).toContain("· agenthud + desktop-pet");
    const md = buildIndexMarkdown([entry]);
    expect(md).toContain("· agenthud + desktop-pet");
  });
});
