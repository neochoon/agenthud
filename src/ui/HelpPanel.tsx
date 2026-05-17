import { Box, Text } from "ink";
import type React from "react";
import {
  BOX,
  createBottomLine,
  createTitleLine,
  getDisplayWidth,
  getInnerWidth,
} from "./constants.js";

interface HelpSection {
  title: string;
  rows: [string, string][]; // [key combo, description]
}

const SECTIONS: HelpSection[] = [
  {
    title: "Session tree",
    rows: [
      ["↑ ↓ / k j", "Move selection"],
      ["PgUp / Ctrl+B", "Page up"],
      ["PgDn / Ctrl+F", "Page down"],
      ["↵", "Expand/collapse project, session, or summary"],
      ["h", "Hide selected (project/session/sub-agent)"],
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
      ["g", "Jump to live (newest)"],
      ["G", "Jump to oldest"],
      ["↵", "Open detail view for selected activity"],
      ["f", "Cycle filter preset (set in config.yaml)"],
      ["s", "Save activity log to ~/.agenthud/logs/"],
      ["Tab", "Switch focus to session tree"],
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
      ["~/.agenthud/summary-prompt.md", "LLM prompt template"],
      ["~/.agenthud/summaries/", "Cached daily summaries"],
    ],
  },
];

export interface HelpPanelProps {
  width: number;
  visibleRows: number;
}

export function HelpPanel({
  width,
  visibleRows,
}: HelpPanelProps): React.ReactElement {
  const innerWidth = getInnerWidth(width);
  const contentWidth = innerWidth - 1;

  // Build flat lines list
  const lines: { key: string; desc: string; isTitle: boolean }[] = [];
  for (let s = 0; s < SECTIONS.length; s++) {
    if (s > 0) lines.push({ key: "", desc: "", isTitle: false }); // blank between sections
    lines.push({ key: SECTIONS[s].title, desc: "", isTitle: true });
    for (const [key, desc] of SECTIONS[s].rows) {
      lines.push({ key: `  ${key}`, desc, isTitle: false });
    }
  }
  // Footer
  lines.push({ key: "", desc: "", isTitle: false });
  lines.push({
    key: "  ↵ / Esc / q / ? to close",
    desc: "",
    isTitle: false,
  });

  // Align: pick the widest key column (cap at 30 chars)
  const keyColumn = Math.min(
    30,
    Math.max(...lines.map((l) => getDisplayWidth(l.key))),
  );

  const contentRows: React.ReactElement[] = [];
  const padTo = (s: string, w: number) => {
    const pad = Math.max(0, w - getDisplayWidth(s));
    return s + " ".repeat(pad);
  };

  for (let i = 0; i < Math.min(lines.length, visibleRows); i++) {
    const { key, desc, isTitle } = lines[i];
    const text = desc ? `${padTo(key, keyColumn)}  ${desc}` : key;
    const padding = Math.max(0, contentWidth - getDisplayWidth(text));
    if (isTitle) {
      contentRows.push(
        <Text key={i}>
          {BOX.v} <Text bold>{text}</Text>
          {" ".repeat(padding)}
          {BOX.v}
        </Text>,
      );
    } else if (key && key.trim().startsWith("agenthud")) {
      contentRows.push(
        <Text key={i}>
          {BOX.v} <Text color="cyan">{text}</Text>
          {" ".repeat(padding)}
          {BOX.v}
        </Text>,
      );
    } else {
      contentRows.push(
        <Text key={i}>
          {BOX.v} {text}
          {" ".repeat(padding)}
          {BOX.v}
        </Text>,
      );
    }
  }

  // Pad with empty rows to fill visibleRows so layout is stable
  const emptyRow = `${BOX.v}${" ".repeat(contentWidth + 1)}${BOX.v}`;
  while (contentRows.length < visibleRows) {
    contentRows.push(<Text key={`pad-${contentRows.length}`}>{emptyRow}</Text>);
  }

  return (
    <Box flexDirection="column" width={width}>
      <Text>{createTitleLine("Help", "", width)}</Text>
      {contentRows}
      <Text>{createBottomLine(width)}</Text>
    </Box>
  );
}
