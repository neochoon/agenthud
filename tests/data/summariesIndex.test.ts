import { describe, expect, it } from "vitest";
import {
  buildBacklinkFooter,
  buildIndexMarkdown,
  extractContextSnippet,
  parseSummaryFilename,
  prependBacklinkFooter,
  stripExistingBacklinkFooter,
  type SummaryEntry,
} from "../../src/data/summariesIndex.js";

describe("parseSummaryFilename", () => {
  it("recognizes a daily summary filename and parses the date as local midnight", () => {
    const entry = parseSummaryFilename("2026-06-07.md");
    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe("daily");
    if (entry?.kind === "daily") {
      expect(entry.filename).toBe("2026-06-07.md");
      expect(entry.date.getFullYear()).toBe(2026);
      expect(entry.date.getMonth()).toBe(5); // June (0-indexed)
      expect(entry.date.getDate()).toBe(7);
      expect(entry.date.getHours()).toBe(0);
    }
  });

  it("recognizes a range summary filename and parses both bounds", () => {
    const entry = parseSummaryFilename(
      "range-2026-06-01_2026-06-07.md",
    );
    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe("range");
    if (entry?.kind === "range") {
      expect(entry.filename).toBe("range-2026-06-01_2026-06-07.md");
      expect(entry.from.getFullYear()).toBe(2026);
      expect(entry.from.getDate()).toBe(1);
      expect(entry.to.getDate()).toBe(7);
    }
  });

  it("returns null for a malformed daily (impossible date)", () => {
    expect(parseSummaryFilename("2026-13-99.md")).toBeNull();
  });

  it("returns null for the index file itself", () => {
    expect(parseSummaryFilename("index.md")).toBeNull();
  });

  it("returns null for a non-markdown file", () => {
    expect(parseSummaryFilename("notes.txt")).toBeNull();
  });

  it("returns null for hidden files like .DS_Store", () => {
    expect(parseSummaryFilename(".DS_Store")).toBeNull();
  });

  it("returns null for completely arbitrary names", () => {
    expect(parseSummaryFilename("hello-world.md")).toBeNull();
  });
});

describe("buildIndexMarkdown", () => {
  const mkDaily = (iso: string): SummaryEntry => {
    const [y, m, d] = iso.split("-").map(Number);
    return {
      kind: "daily",
      date: new Date(y, m - 1, d),
      filename: `${iso}.md`,
    };
  };
  const mkRange = (fromIso: string, toIso: string): SummaryEntry => {
    const [fy, fm, fd] = fromIso.split("-").map(Number);
    const [ty, tm, td] = toIso.split("-").map(Number);
    return {
      kind: "range",
      from: new Date(fy, fm - 1, fd),
      to: new Date(ty, tm - 1, td),
      filename: `range-${fromIso}_${toIso}.md`,
    };
  };

  it("returns just a header when there are no entries", () => {
    const md = buildIndexMarkdown([]);
    expect(md).toContain("# AgentHUD summaries");
    expect(md).toContain("<!-- agenthud-summaries-index -->");
  });

  it("renders a daily-only single-month list with weekday tags", () => {
    const md = buildIndexMarkdown([
      mkDaily("2026-06-07"),
      mkDaily("2026-06-06"),
    ]);
    expect(md).toContain("## 2026");
    expect(md).toContain("### June");
    // 2026-06-07 is a Sunday, 2026-06-06 is a Saturday.
    expect(md).toContain("- [2026-06-07 (Sun)](./2026-06-07.md)");
    expect(md).toContain("- [2026-06-06 (Sat)](./2026-06-06.md)");
    // newest first
    expect(md.indexOf("2026-06-07.md")).toBeLessThan(
      md.indexOf("2026-06-06.md"),
    );
  });

  it("appends snippets when provided via the snippets map", () => {
    const md = buildIndexMarkdown(
      [mkDaily("2026-06-07")],
      new Map([
        ["2026-06-07.md", "Shipped --open / -o for summary."],
      ]),
    );
    expect(md).toContain(
      "- [2026-06-07 (Sun)](./2026-06-07.md) — Shipped --open / -o for summary.",
    );
  });

  it("omits the em-dash when no snippet is available for that file", () => {
    const md = buildIndexMarkdown([mkDaily("2026-06-07")]);
    expect(md).toContain("- [2026-06-07 (Sun)](./2026-06-07.md)\n");
    expect(md).not.toContain("- [2026-06-07 (Sun)](./2026-06-07.md) —");
  });

  it("renders a range entry with the range label and links to its file", () => {
    const md = buildIndexMarkdown([mkRange("2026-06-01", "2026-06-07")]);
    expect(md).toContain(
      "- [Range: 2026-06-01 → 2026-06-07](./range-2026-06-01_2026-06-07.md) · weekly",
    );
  });

  it("groups across years and months newest-first", () => {
    const md = buildIndexMarkdown([
      mkDaily("2026-06-07"),
      mkDaily("2026-05-31"),
      mkDaily("2025-12-25"),
    ]);
    // year order
    expect(md.indexOf("## 2026")).toBeLessThan(md.indexOf("## 2025"));
    // month order within 2026 (June before May)
    expect(md.indexOf("### June")).toBeLessThan(md.indexOf("### May"));
  });
});

describe("buildBacklinkFooter", () => {
  const mkDaily = (iso: string): SummaryEntry => {
    const [y, m, d] = iso.split("-").map(Number);
    return {
      kind: "daily",
      date: new Date(y, m - 1, d),
      filename: `${iso}.md`,
    };
  };
  const mkRange = (fromIso: string, toIso: string): SummaryEntry => {
    const [fy, fm, fd] = fromIso.split("-").map(Number);
    const [ty, tm, td] = toIso.split("-").map(Number);
    return {
      kind: "range",
      from: new Date(fy, fm - 1, fd),
      to: new Date(ty, tm - 1, td),
      filename: `range-${fromIso}_${toIso}.md`,
    };
  };

  it("wraps the line in HTML-comment markers so we can re-prepend idempotently", () => {
    const entries = [mkDaily("2026-06-07")];
    const footer = buildBacklinkFooter("2026-06-07.md", entries);
    expect(footer).toContain("<!-- agenthud-backlinks-start -->");
    expect(footer).toContain("<!-- agenthud-backlinks-end -->");
  });

  it("always includes a link back to the index", () => {
    const footer = buildBacklinkFooter("2026-06-07.md", [
      mkDaily("2026-06-07"),
    ]);
    expect(footer).toContain("[← all summaries](./index.md)");
  });

  it("daily with both prev and next dailies emits all three links with weekday tags", () => {
    const entries = [
      mkDaily("2026-06-08"), // Mon
      mkDaily("2026-06-07"), // Sun
      mkDaily("2026-06-06"), // Sat
    ];
    const footer = buildBacklinkFooter("2026-06-07.md", entries);
    expect(footer).toContain("[← 2026-06-06 (Sat)](./2026-06-06.md)");
    expect(footer).toContain("[2026-06-08 (Mon) →](./2026-06-08.md)");
  });

  it("daily with only prev does not synthesize a next", () => {
    const entries = [mkDaily("2026-06-07"), mkDaily("2026-06-06")];
    const footer = buildBacklinkFooter("2026-06-07.md", entries);
    expect(footer).toContain("[← 2026-06-06 (Sat)](./2026-06-06.md)");
    expect(footer).not.toContain("→");
  });

  it("range entries get the index link only — no prev/next chain", () => {
    const entries = [
      mkRange("2026-06-01", "2026-06-07"),
      mkDaily("2026-06-07"),
      mkDaily("2026-06-06"),
    ];
    const footer = buildBacklinkFooter(
      "range-2026-06-01_2026-06-07.md",
      entries,
    );
    expect(footer).toContain("[← all summaries](./index.md)");
    expect(footer).not.toContain("→");
    expect(footer).not.toContain("[← 2026");
  });
});

describe("stripExistingBacklinkFooter / prependBacklinkFooter", () => {
  it("prepending onto fresh content yields footer + body", () => {
    const body = "# title\n\nbody\n";
    const footer =
      "<!-- agenthud-backlinks-start -->\n[← all summaries](./index.md)\n<!-- agenthud-backlinks-end -->\n\n";
    const out = prependBacklinkFooter(body, footer);
    expect(out).toBe(`${footer}${body}`);
  });

  it("prepending onto content that already has a footer replaces it cleanly", () => {
    const body = "# title\n\nbody\n";
    const oldFooter =
      "<!-- agenthud-backlinks-start -->\nold\n<!-- agenthud-backlinks-end -->\n\n";
    const withOld = `${oldFooter}${body}`;
    const newFooter =
      "<!-- agenthud-backlinks-start -->\nnew\n<!-- agenthud-backlinks-end -->\n\n";
    const out = prependBacklinkFooter(withOld, newFooter);
    expect(out).toBe(`${newFooter}${body}`);
    expect(out).not.toContain("old");
  });

  it("strip-only on content with no footer is a no-op", () => {
    const body = "# title\n\nbody\n";
    expect(stripExistingBacklinkFooter(body)).toBe(body);
  });

  it("strip-only on content with only the start marker is a no-op (defensive)", () => {
    const body =
      "<!-- agenthud-backlinks-start -->\norphan\n# title\n";
    // No closing marker → leave alone, don't risk eating real content.
    expect(stripExistingBacklinkFooter(body)).toBe(body);
  });
});

describe("extractContextSnippet", () => {
  it("returns the first prose line after the heading", () => {
    const content =
      "## Context\n\nTwo workstreams ran today: built the index feature and reviewed PRs.\n\n## More\n";
    expect(extractContextSnippet(content)).toBe(
      "Two workstreams ran today: built the index feature and reviewed PRs.",
    );
  });

  it("ignores leading backlink footer when extracting", () => {
    const content =
      "<!-- agenthud-backlinks-start -->\n[← all](./index.md)\n<!-- agenthud-backlinks-end -->\n\n## Context\n\nReal content here.\n";
    expect(extractContextSnippet(content)).toBe("Real content here.");
  });

  it("truncates with ellipsis at 200 chars by default", () => {
    const long = "x".repeat(500);
    const content = `${long}\n`;
    const snippet = extractContextSnippet(content);
    expect(snippet).not.toBeNull();
    expect(snippet!.length).toBeLessThanOrEqual(200);
    expect(snippet!.endsWith("…")).toBe(true);
  });

  it("respects a custom max-char cap", () => {
    const content =
      "This is a fairly long sentence that should be cut by the cap.\n";
    expect(extractContextSnippet(content, 20)).toBe("This is a fairly lo…");
  });

  it("returns null for an empty file", () => {
    expect(extractContextSnippet("")).toBeNull();
  });

  it("returns null for a file with only headings and blanks", () => {
    expect(extractContextSnippet("## Context\n\n## More\n")).toBeNull();
  });

  it("returns null for a file with only the backlink footer (no body)", () => {
    const content =
      "<!-- agenthud-backlinks-start -->\n[← all](./index.md)\n<!-- agenthud-backlinks-end -->\n";
    expect(extractContextSnippet(content)).toBeNull();
  });
});
