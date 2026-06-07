/**
 * Maintenance for ~/.agenthud/summaries/ as a navigable knowledge base:
 *
 * - `index.md` is an auto-regenerated hub listing every daily and range
 *   summary, grouped year → month → entry (newest first).
 * - Each summary file gets a one-line backlink footer prepended at the
 *   top so a reader can hop back to the index or to neighboring dates
 *   without leaving their markdown viewer.
 *
 * Markdown only — VS Code preview and browser markdown extensions
 * render relative links inline, so we never need to ship HTML.
 *
 * The pure helpers in this module are exported individually so each
 * one is unit-testable; the side-effect orchestrator `regenerateIndex`
 * sits at the bottom and is exercised end-to-end via manual smoke.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DailyEntry {
  kind: "daily";
  date: Date; // local midnight of the summary day
  filename: string; // e.g. "2026-06-07.md"
}

export interface RangeEntry {
  kind: "range";
  from: Date;
  to: Date;
  filename: string; // e.g. "range-2026-06-01_2026-06-07.md"
}

export type SummaryEntry = DailyEntry | RangeEntry;

// ─── Markers ─────────────────────────────────────────────────────────────────

const INDEX_HEADER_MARKER = "<!-- agenthud-summaries-index -->";
const BACKLINK_START_MARKER = "<!-- agenthud-backlinks-start -->";
const BACKLINK_END_MARKER = "<!-- agenthud-backlinks-end -->";

// ─── Date helpers ────────────────────────────────────────────────────────────

const DAILY_RE = /^(\d{4})-(\d{2})-(\d{2})\.md$/;
const RANGE_RE = /^range-(\d{4})-(\d{2})-(\d{2})_(\d{4})-(\d{2})-(\d{2})\.md$/;

function makeLocalDate(y: number, m: number, d: number): Date | null {
  // Validate by round-tripping through the Date constructor — out-of-range
  // values (e.g. month=13, day=99) get normalised, so we detect them by
  // re-reading the components.
  const date = new Date(y, m - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }
  return date;
}

// ─── parseSummaryFilename ────────────────────────────────────────────────────

export function parseSummaryFilename(name: string): SummaryEntry | null {
  const range = RANGE_RE.exec(name);
  if (range) {
    const from = makeLocalDate(
      Number(range[1]),
      Number(range[2]),
      Number(range[3]),
    );
    const to = makeLocalDate(
      Number(range[4]),
      Number(range[5]),
      Number(range[6]),
    );
    if (!from || !to) return null;
    return { kind: "range", from, to, filename: name };
  }
  const daily = DAILY_RE.exec(name);
  if (daily) {
    const date = makeLocalDate(
      Number(daily[1]),
      Number(daily[2]),
      Number(daily[3]),
    );
    if (!date) return null;
    return { kind: "daily", date, filename: name };
  }
  return null;
}

// ─── listSummaries ───────────────────────────────────────────────────────────

/**
 * Scan the summaries directory and return every recognized entry.
 *
 * Sort order — newest first throughout:
 *   - by year (desc)
 *   - within a year by month (desc)
 *   - within a month, range entries before dailies; dailies by day (desc).
 */
export function listSummaries(dir: string): SummaryEntry[] {
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir) as string[];
  } catch {
    return [];
  }
  const entries = names
    .map((n) => parseSummaryFilename(n))
    .filter((e): e is SummaryEntry => e !== null);

  // For the chronological anchor of each entry, ranges sort by their
  // `from` date — that's what places them at the head of their month.
  const anchor = (e: SummaryEntry): Date =>
    e.kind === "range" ? e.from : e.date;

  entries.sort((a, b) => {
    const da = anchor(a);
    const db = anchor(b);
    if (da.getFullYear() !== db.getFullYear()) {
      return db.getFullYear() - da.getFullYear();
    }
    if (da.getMonth() !== db.getMonth()) {
      return db.getMonth() - da.getMonth();
    }
    // Same month: ranges win.
    if (a.kind !== b.kind) return a.kind === "range" ? -1 : 1;
    return db.getTime() - da.getTime();
  });
  return entries;
}

// ─── buildIndexMarkdown ──────────────────────────────────────────────────────

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** `YYYY-MM-DD (Sun)` — what the index and backlink labels render. */
function formatDateLabel(d: Date): string {
  return `${formatDateKey(d)} (${WEEKDAYS_SHORT[d.getDay()]})`;
}

function entryAnchor(e: SummaryEntry): Date {
  return e.kind === "range" ? e.from : e.date;
}

/**
 * `snippets` (optional) maps filename → one-line preview. When a
 * matching entry exists it's rendered as `— preview` after the date
 * label. Files without a snippet just get the link, no separator.
 */
export function buildIndexMarkdown(
  entries: SummaryEntry[],
  snippets?: Map<string, string>,
): string {
  const lines: string[] = [INDEX_HEADER_MARKER, "", "# AgentHUD summaries", ""];
  if (entries.length === 0) {
    lines.push("_No summaries yet. Run `agenthud summary` to create one._");
    return `${lines.join("\n")}\n`;
  }

  // Group by year, then by month, preserving the input sort order.
  const byYear = new Map<number, Map<number, SummaryEntry[]>>();
  for (const entry of entries) {
    const a = entryAnchor(entry);
    const y = a.getFullYear();
    const m = a.getMonth();
    const months = byYear.get(y) ?? new Map<number, SummaryEntry[]>();
    const bucket = months.get(m) ?? [];
    bucket.push(entry);
    months.set(m, bucket);
    byYear.set(y, months);
  }

  for (const [year, months] of byYear) {
    lines.push(`## ${year}`, "");
    for (const [month, bucket] of months) {
      lines.push(`### ${MONTHS[month]}`);
      for (const entry of bucket) {
        const snippet = snippets?.get(entry.filename);
        const trail = snippet ? ` — ${snippet}` : "";
        if (entry.kind === "range") {
          const fromIso = formatDateKey(entry.from);
          const toIso = formatDateKey(entry.to);
          lines.push(
            `- [Range: ${fromIso} → ${toIso}](./${entry.filename}) · weekly${trail}`,
          );
        } else {
          lines.push(
            `- [${formatDateLabel(entry.date)}](./${entry.filename})${trail}`,
          );
        }
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

// ─── buildBacklinkFooter ─────────────────────────────────────────────────────

export function buildBacklinkFooter(
  currentFilename: string,
  entries: SummaryEntry[],
): string {
  const parts = ["[← all summaries](./index.md)"];
  const me = entries.find((e) => e.filename === currentFilename);

  if (me && me.kind === "daily") {
    // Walk only the dailies — range entries skipped so the chain reads
    // as a day-by-day sequence.
    const dailies = entries
      .filter((e): e is DailyEntry => e.kind === "daily")
      .sort((a, b) => a.date.getTime() - b.date.getTime()); // oldest → newest

    const idx = dailies.findIndex((e) => e.filename === currentFilename);
    if (idx > 0) {
      const prev = dailies[idx - 1];
      parts.push(
        `[← ${formatDateLabel(prev.date)}](./${prev.filename})`,
      );
    }
    if (idx >= 0 && idx < dailies.length - 1) {
      const next = dailies[idx + 1];
      parts.push(
        `[${formatDateLabel(next.date)} →](./${next.filename})`,
      );
    }
  }

  const line = parts.join(" · ");
  return `${BACKLINK_START_MARKER}\n${line}\n${BACKLINK_END_MARKER}\n\n`;
}

// ─── strip / prepend backlink footer ─────────────────────────────────────────

export function stripExistingBacklinkFooter(content: string): string {
  if (!content.startsWith(BACKLINK_START_MARKER)) return content;
  const endIdx = content.indexOf(BACKLINK_END_MARKER);
  if (endIdx === -1) return content; // defensive: orphan start marker, leave alone
  // Cut from start through end marker, then chew one trailing newline-pair
  // we inserted ourselves.
  let cut = endIdx + BACKLINK_END_MARKER.length;
  while (cut < content.length && (content[cut] === "\n" || content[cut] === "\r")) {
    cut++;
  }
  return content.slice(cut);
}

export function prependBacklinkFooter(content: string, footer: string): string {
  return footer + stripExistingBacklinkFooter(content);
}

// ─── extractContextSnippet ───────────────────────────────────────────────────

/**
 * One-line preview pulled from a summary file: the first non-empty,
 * non-heading, non-comment line in the body (after stripping any
 * leading backlink footer). Truncates to `maxChars` with an ellipsis.
 * Returns `null` for empty files or files with no prose.
 */
export function extractContextSnippet(
  content: string,
  maxChars = 200,
): string | null {
  const body = stripExistingBacklinkFooter(content);
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith("<!--")) continue;
    if (line.length <= maxChars) return line;
    return `${line.slice(0, maxChars - 1).trimEnd()}…`;
  }
  return null;
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Best-effort: rewrite index.md and refresh every summary's backlink
 * footer. Failures on individual files are swallowed so a stale or
 * permission-denied summary never blocks the post-LLM path.
 */
export function regenerateIndex(summariesDir: string): void {
  const entries = listSummaries(summariesDir);

  // Single pass over the files: for each one, extract the snippet for
  // the index, refresh the backlink footer, and (only if changed) write
  // the file back. The snippet extraction operates on the
  // backlink-stripped body so the preview is the real first prose line,
  // not the navigation row.
  const snippets = new Map<string, string>();
  for (const entry of entries) {
    const path = join(summariesDir, entry.filename);
    try {
      const content = readFileSync(path, "utf-8");
      const snippet = extractContextSnippet(content);
      if (snippet) snippets.set(entry.filename, snippet);
      const footer = buildBacklinkFooter(entry.filename, entries);
      const updated = prependBacklinkFooter(content, footer);
      if (updated !== content) {
        writeFileSync(path, updated, "utf-8");
      }
    } catch {
      // Best-effort: skip files we can't read/write. The LLM call's
      // success is what matters; the index/backlink layer is decorative.
    }
  }

  // Write the hub last so its snippets reflect the final on-disk state.
  const indexPath = join(summariesDir, "index.md");
  try {
    writeFileSync(
      indexPath,
      buildIndexMarkdown(entries, snippets),
      "utf-8",
    );
  } catch (err) {
    process.stderr.write(
      `warning: cannot write summaries index (${(err as Error).message})\n`,
    );
  }
}
