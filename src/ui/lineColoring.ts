export type LineCategory =
  | "diff-add"
  | "diff-remove"
  | "diff-hunk"
  | "diff-meta"
  | "code-fence"
  | "code"
  | "prose";

const DIFF_META_PREFIXES = [
  "diff --git",
  "index ",
  "commit ",
  "Author:",
  "Date:",
  "Merge:",
];

/**
 * Tag each line of a unified-diff–shaped block (e.g. `git show --stat --patch`
 * output) so the renderer can color them: added lines green, removed lines
 * red, hunk headers cyan, structural metadata dimmed, everything else plain.
 *
 * Order matters: `+++ /path` and `--- /path` are file headers and must be
 * recognized before the generic `+`/`-` prefix check.
 */
export function classifyDiffLines(lines: string[]): LineCategory[] {
  return lines.map((line) => {
    if (line.startsWith("+++") || line.startsWith("---")) return "diff-meta";
    if (DIFF_META_PREFIXES.some((p) => line.startsWith(p))) return "diff-meta";
    if (line.startsWith("@@")) return "diff-hunk";
    if (line.startsWith("+")) return "diff-add";
    if (line.startsWith("-")) return "diff-remove";
    return "prose";
  });
}

/**
 * Tag lines of markdown-ish content based on triple-backtick code fences.
 * Fence markers themselves get "code-fence"; lines between an open/close
 * pair get "code"; everything else stays "prose". An unclosed fence is
 * treated as code through end-of-input.
 */
export function classifyCodeFences(lines: string[]): LineCategory[] {
  const out: LineCategory[] = [];
  let inCode = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      out.push("code-fence");
      inCode = !inCode;
    } else {
      out.push(inCode ? "code" : "prose");
    }
  }
  return out;
}

export interface LineStyle {
  color?: string;
  dimColor?: boolean;
}

export function getLineStyle(category: LineCategory): LineStyle {
  switch (category) {
    case "diff-add":
      return { color: "green" };
    case "diff-remove":
      return { color: "red" };
    case "diff-hunk":
      return { color: "cyan" };
    case "diff-meta":
      return { dimColor: true };
    case "code-fence":
      return { color: "cyan", dimColor: true };
    case "code":
      return { color: "cyan" };
    case "prose":
      return {};
  }
}
