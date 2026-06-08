import { describe, expect, it } from "vitest";
import { buildRangeMetaInput } from "../../src/data/summaryRunner.js";

describe("buildRangeMetaInput", () => {
  it("wraps each daily summary in a <day date=YYYY-MM-DD> tag", () => {
    const out = buildRangeMetaInput([
      { date: new Date(2026, 5, 1), markdown: "## Context\n\nDay 1.\n" },
      { date: new Date(2026, 5, 2), markdown: "## Context\n\nDay 2.\n" },
    ]);
    expect(out).toContain('<day date="2026-06-01">');
    expect(out).toContain('<day date="2026-06-02">');
    expect(out).toContain("</day>");
  });

  it("places the daily markdown body inside the tag", () => {
    const out = buildRangeMetaInput([
      { date: new Date(2026, 5, 1), markdown: "## Context\n\nFirst day.\n" },
    ]);
    expect(out).toMatch(
      /<day date="2026-06-01">\s*## Context\s*First day\.\s*<\/day>/,
    );
  });

  it("separates entries with blank lines (not the markdown horizontal rule `---`)", () => {
    // The old format used `---` as the separator, which collided
    // with horizontal rules and yaml frontmatter inside summaries.
    // The new format relies on the tag boundaries, no `---` needed.
    const out = buildRangeMetaInput([
      { date: new Date(2026, 5, 1), markdown: "Day 1.\n" },
      { date: new Date(2026, 5, 2), markdown: "Day 2.\n" },
    ]);
    expect(out).not.toContain("\n---\n");
  });

  it("does not break when a daily summary itself contains `---` or `# YYYY-MM-DD`", () => {
    // A daily summary might quote `---` (horizontal rule) or a date
    // heading from its source content; the tag-based format must not
    // confuse those with section boundaries.
    const out = buildRangeMetaInput([
      {
        date: new Date(2026, 5, 1),
        markdown:
          "Some text\n\n---\n\n# 2026-05-15\n\nQuoted older date heading.\n",
      },
      { date: new Date(2026, 5, 2), markdown: "Day 2.\n" },
    ]);
    // Two opening tags, two closing tags — neither the embedded `---`
    // nor the embedded `# 2026-05-15` should produce an extra day.
    const openTags = out.match(/<day date="\d{4}-\d{2}-\d{2}">/g) ?? [];
    const closeTags = out.match(/<\/day>/g) ?? [];
    expect(openTags).toHaveLength(2);
    expect(closeTags).toHaveLength(2);
  });

  it("returns an empty string when no dailies are supplied", () => {
    expect(buildRangeMetaInput([])).toBe("");
  });

  it("preserves order — newest input is the last <day> block", () => {
    const out = buildRangeMetaInput([
      { date: new Date(2026, 5, 1), markdown: "first" },
      { date: new Date(2026, 5, 2), markdown: "second" },
    ]);
    const firstIdx = out.indexOf('date="2026-06-01"');
    const secondIdx = out.indexOf('date="2026-06-02"');
    expect(firstIdx).toBeLessThan(secondIdx);
  });
});
