/**
 * Full-screen `?` help overlay listing every keybinding by panel,
 * session-status badges with their colors, CLI commands, and file
 * paths agenthud reads/writes. The canonical "what does X key do"
 * reference inside the app.
 *
 * Design decisions:
 * - The `SECTIONS` constant is hand-curated, not generated from
 *   `useHotkeys` callbacks. Reason: hotkeys are runtime
 *   dispatchers, the help table is documentation — they want
 *   different groupings ("Project tree", "Activity viewer",
 *   "Always available") that don't map 1:1 to call sites. Drift
 *   is caught in code review; the value of human-readable
 *   section grouping outweighs deduplication.
 * - Scrollable (`j/k`, `↑/↓`, `PgUp/PgDn`, `Ctrl+B/F`, `Space`,
 *   `g/G`) with a bottom indicator (`-- current/total --`) so
 *   users on terminals shorter than the help content know there's
 *   more to scroll to. v0.9.3 added this after the help silently
 *   truncated on smaller windows.
 *
 * Gotcha:
 * - The key-column width is auto-computed but capped at 30 cells.
 *   Without the cap, a single long keybind label
 *   (e.g. `PgUp / PgDn / Ctrl+B / Ctrl+F`) crushes the
 *   description column on narrow terminals.
 */

import { Box, Text } from "ink";
import type React from "react";
import { getDisplayWidth } from "./constants.js";

interface HelpSection {
  title: string;
  rows: HelpRow[];
}

type HelpRow = [string, string] | [string, string, string];

const SECTIONS: HelpSection[] = [
  {
    title: "Project tree",
    rows: [
      ["↑ ↓ / k j", "Move selection"],
      ["← / h", "Jump to parent (sub-agent → session, session → project)"],
      ["PgUp / Ctrl+B", "Page up"],
      ["PgDn / Ctrl+F", "Page down"],
      ["↵", "Expand/collapse project, session, or summary"],
      ["H", "Toggle hide on selected — hides if visible, unhides if hidden (Shift+H)"],
      ["a", "Toggle show hidden items in the tree (dim ⊘ marker)"],
      ["t", "Track: auto-follow the newest live sub-agent (any nav key turns it off)"],
      ["Tab", "Switch focus to activity viewer"],
      ["r", "Refresh now"],
    ],
  },
  {
    title: "Activity viewer",
    rows: [
      ["↑ ↓ / k j", "Scroll one line"],
      ["PgUp/Dn, Ctrl+B/F", "Scroll one page"],
      ["Ctrl+U / Ctrl+D", "Scroll half page"],
      ["g", "Jump to top (oldest)"],
      ["G", "Jump to live (newest, bottom)"],
      ["↵", "Open detail view for selected activity"],
      ["f", "Cycle filter preset (set in config.yaml)"],
      ["Tab", "Switch focus to project tree"],
    ],
  },
  {
    title: "Detail view",
    rows: [
      ["↑ ↓ / k j", "Scroll"],
      ["↵ / Esc / q", "Close"],
    ],
  },
  {
    title: "Session status (by recent activity)",
    rows: [
      ["[hot]", "Updated in the last 30 minutes", "green"],
      ["[warm]", "Updated in the last hour", "yellow"],
      ["[cool]", "Updated earlier today", "cyan"],
      ["[cold]", "Last updated yesterday or earlier (collapsed)", "gray"],
    ],
  },
  {
    title: "Always available",
    rows: [
      ["?", "Toggle this help"],
      ["q", "Quit (or close detail/help)"],
    ],
  },
  {
    title: "CLI commands",
    rows: [
      ["agenthud report", "Print activity for a date as Markdown/JSON"],
      ["agenthud summary", "LLM-summarize a day via claude -p (cached)"],
      ["agenthud --help", "Full CLI usage"],
    ],
  },
  {
    title: "Files",
    rows: [
      ["~/.agenthud/config.yaml", "User settings (edit freely)"],
      ["~/.agenthud/state.yaml", "Hidden items (app-managed)"],
      ["~/.agenthud/summary-prompt.md", "Daily summary prompt template"],
      ["~/.agenthud/summary-range-prompt.md", "Range summary prompt template"],
      ["~/.agenthud/summaries/", "Cached daily and range summaries"],
    ],
  },
];

export interface HelpPanelProps {
  width: number;
  height: number; // total available height
  scrollOffset?: number; // line offset into the rendered help (default 0)
  onTotalLinesChange?: (total: number) => void;
}

export function HelpPanel({
  width,
  height,
  scrollOffset = 0,
  onTotalLinesChange,
}: HelpPanelProps): React.ReactElement {
  // Compute key column width (cap at 30)
  const allKeys = SECTIONS.flatMap((s) => s.rows.map((r) => r[0]));
  const keyColumn = Math.min(
    30,
    Math.max(...allKeys.map((k) => getDisplayWidth(k))),
  );

  const padTo = (s: string, w: number) => {
    const pad = Math.max(0, w - getDisplayWidth(s));
    return s + " ".repeat(pad);
  };

  const lines: React.ReactElement[] = [];

  // Title (single line, bold + bright)
  lines.push(
    <Text key="title" bold>
      AgentHUD Help
    </Text>,
  );
  lines.push(<Text key="title-sp"> </Text>);

  for (let s = 0; s < SECTIONS.length; s++) {
    if (s > 0) lines.push(<Text key={`sp-${s}`}> </Text>);
    lines.push(
      <Text key={`title-${s}`} bold color="cyan">
        {SECTIONS[s].title}
      </Text>,
    );
    for (let r = 0; r < SECTIONS[s].rows.length; r++) {
      const row = SECTIONS[s].rows[r];
      const [key, desc] = row;
      const explicitColor = row.length === 3 ? row[2] : undefined;
      const isCli = key.trim().startsWith("agenthud");
      const isFile = key.includes("~/.agenthud");
      const color =
        explicitColor ?? (isCli ? "cyan" : isFile ? "green" : undefined);
      lines.push(
        <Text key={`row-${s}-${r}`}>
          <Text dimColor> </Text>
          <Text color={color}>{padTo(key, keyColumn)}</Text>
          <Text> </Text>
          <Text dimColor>{desc}</Text>
        </Text>,
      );
    }
  }

  // Reserve one line at the bottom for the scroll indicator when content
  // overflows. Always render the indicator slot (blank if not needed) so
  // layout doesn't shift as the user scrolls.
  const indicatorReserved = lines.length > height ? 1 : 0;
  const viewport = Math.max(1, height - indicatorReserved);

  const maxOffset = Math.max(0, lines.length - viewport);
  const offset = Math.max(0, Math.min(scrollOffset, maxOffset));

  // Surface total line count so the caller can clamp its scroll offset.
  if (onTotalLinesChange) onTotalLinesChange(lines.length);

  const visible = lines.slice(offset, offset + viewport);

  return (
    <Box flexDirection="column" width={width}>
      {visible}
      {indicatorReserved > 0 && (
        <Text dimColor>
          {`-- ${offset + viewport} / ${lines.length} `}
          {offset < maxOffset
            ? "(↓ / j / PgDn / Space for more) --"
            : "(top: g · ↑ / k to scroll back) --"}
        </Text>
      )}
    </Box>
  );
}
