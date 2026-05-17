import { Box, Text } from "ink";
import type React from "react";
import { getDisplayWidth } from "./constants.js";

interface HelpSection {
  title: string;
  rows: [string, string][];
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
  height: number; // total available height
}

export function HelpPanel({
  width,
  height,
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
      const [key, desc] = SECTIONS[s].rows[r];
      const isCli = key.trim().startsWith("agenthud");
      const isFile = key.includes("~/.agenthud");
      lines.push(
        <Text key={`row-${s}-${r}`}>
          <Text dimColor> </Text>
          <Text color={isCli ? "cyan" : isFile ? "green" : undefined}>
            {padTo(key, keyColumn)}
          </Text>
          <Text> </Text>
          <Text dimColor>{desc}</Text>
        </Text>,
      );
    }
  }

  // Truncate if too tall
  const visible = lines.slice(0, height);

  return (
    <Box flexDirection="column" width={width}>
      {visible}
    </Box>
  );
}
