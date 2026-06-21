/**
 * Per-tool summarizers for activity rows: `summarizeToolDetail`
 * returns the one-line detail string (the part after the colon in
 * `[HH:MM] ⚙ Edit: foo.ts L10-12 +3 -1`), and `buildToolDetailBody`
 * returns the optional multi-line body shown in the TUI detail view
 * (and, for Task only, included in the markdown report).
 *
 * Design decisions:
 * - All tool kinds live in this one file as switch-style branches.
 *   Splitting per-tool would over-fragment for ~10 tools; the
 *   centralized switch doubles as a checklist of "what tools do
 *   we render specially?"
 * - `detailBody` is opt-in per tool: Edit gives a unified diff,
 *   Write gives the written content, Read gives line-numbered
 *   content, Task gives the subagent's returned text, Bash gives
 *   stdout / stderr / `[interrupted]` marker. Everything else
 *   returns null so the TUI just shows the one-liner.
 * - Task's body is intentionally exposed to the markdown report
 *   (see `reportGenerator.ts:formatTaskBody`). Other tools'
 *   bodies stay TUI-only to keep LLM payload size bounded.
 * - Tool shapes can drift across provider versions. When a row goes
 *   blank/wrong after a CLI upgrade, follow the version-gated-branch
 *   convention in
 *   docs/superpowers/specs/2026-06-19-parser-version-drift-design.md:
 *   add a synthetic fixture for the new shape, then branch on the
 *   session's `version` (thread the param here at that point). Keep the
 *   old fixture — old logs must still parse.
 *
 * Gotchas:
 * - Claude Code's JSONL stores tool results in a `toolUseResult`
 *   field with shape-per-tool. `Write` puts content on
 *   `result.content`, `Read` on `result.file.content`, `Task`
 *   also on `result.content`, `Edit` puts a structured patch on
 *   `result.structuredPatch`, `Bash` uses `result.stdout` /
 *   `result.stderr` / `result.interrupted`. Defensive null checks
 *   throughout because Claude Code's schema isn't versioned and
 *   this code runs against logs going back months.
 * - Bash result has no `exitCode` field — verified by grepping
 *   the user's actual session JSONL files. `interrupted` and
 *   stderr presence are the only success/failure-ish signals.
 */

import { basename } from "node:path";

export interface AskQuestion {
  question?: string;
  header?: string;
  multiSelect?: boolean;
  options?: { label?: string; description?: string }[];
}

export interface ToolInput {
  command?: string;
  file_path?: string;
  pattern?: string;
  query?: string;
  description?: string;
  offset?: number;
  limit?: number;
  content?: string;
  subject?: string;
  taskId?: string;
  status?: string;
  // AskUserQuestion: one or more questions, each with selectable options.
  questions?: AskQuestion[];
  // Skill: the invoked skill name (may be `plugin:skill`) + optional args.
  skill?: string;
  args?: string;
}

interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface ToolUseResult {
  structuredPatch?: PatchHunk[];
  content?: string;
  file?: { startLine?: number; numLines?: number; content?: string };
  statusChange?: { from?: string; to?: string };
  updatedFields?: string[];
  taskId?: string;
  // Bash result shape (verified from real session JSONL): stdout +
  // stderr strings, `interrupted` flag for user-cancelled commands.
  // No exitCode field is emitted by Claude Code for Bash — `interrupted`
  // and stderr presence are the only success/failure-ish signals.
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function getToolDetail(_toolName: string, input?: ToolInput): string {
  if (!input) return "";
  if (input.command) return stripAnsi(input.command);
  if (input.file_path) return basename(input.file_path);
  if (input.pattern) return stripAnsi(input.pattern);
  if (input.query) return stripAnsi(input.query);
  if (input.description) return stripAnsi(input.description);
  return "";
}

function rangeStr(start: number, lines: number): string {
  return `L${start}-${start + Math.max(lines, 1) - 1}`;
}

function patchSpan(hunks: PatchHunk[]): string | null {
  if (hunks.length === 0) return null;
  const start = Math.min(...hunks.map((h) => h.newStart));
  const end = Math.max(
    ...hunks.map((h) => h.newStart + Math.max(h.newLines, 1) - 1),
  );
  return `L${start}-${end}`;
}

function countChanges(hunks: PatchHunk[]): string {
  let add = 0;
  let del = 0;
  for (const h of hunks) {
    for (const line of h.lines ?? []) {
      if (line.startsWith("+")) add++;
      else if (line.startsWith("-")) del++;
    }
  }
  const parts: string[] = [];
  if (add > 0) parts.push(`+${add}`);
  if (del > 0) parts.push(`-${del}`);
  return parts.join(" ");
}

function joinParts(...parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p).join(" ");
}

export function summarizeToolDetail(
  name: string,
  input: ToolInput | undefined,
  result: ToolUseResult | undefined,
): string {
  const file = input?.file_path ? basename(input.file_path) : "";

  if (name === "Edit" || name === "Write") {
    const hunks = result?.structuredPatch;
    if (hunks && hunks.length > 0) {
      return joinParts(file, patchSpan(hunks), countChanges(hunks));
    }
    if (name === "Write") {
      const content = result?.content ?? input?.content;
      if (content) {
        const n = content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
        return joinParts(file, rangeStr(1, n), `+${n}`);
      }
    }
    return file;
  }

  if (name === "Read") {
    const f = result?.file;
    if (typeof f?.startLine === "number" && typeof f?.numLines === "number") {
      return joinParts(file, rangeStr(f.startLine, f.numLines));
    }
    if (typeof input?.offset === "number" && typeof input?.limit === "number") {
      return joinParts(file, rangeStr(input.offset, input.limit));
    }
    return file;
  }

  if (name === "TaskUpdate") {
    const id = input?.taskId ?? result?.taskId;
    const idStr = id ? `#${id}` : "";
    const sc = result?.statusChange;
    if (sc?.from && sc?.to) return joinParts(idStr, `${sc.from}→${sc.to}`);
    if (result?.updatedFields?.length) {
      return joinParts(idStr, result.updatedFields.join(", "));
    }
    if (input?.status) return joinParts(idStr, input.status);
    return idStr;
  }

  if (name === "TaskCreate") {
    return input?.subject ?? "";
  }

  if (name === "AskUserQuestion") {
    const qs = input?.questions;
    if (!qs || qs.length === 0) return "";
    if (qs.length === 1) return qs[0].question ?? qs[0].header ?? "";
    // Multiple questions: a count plus each question's compact header
    // (falling back to its full text when no header was provided).
    // Drop blank labels so a malformed question can't leave a dangling
    // " · " separator.
    const labels = qs
      .map((q) => q.header ?? q.question ?? "")
      .filter(Boolean)
      .join(" · ");
    return `${qs.length} questions: ${labels}`;
  }

  if (name === "Skill") {
    const skill = input?.skill;
    if (!skill) return "";
    return input?.args ? `${skill} — ${input.args}` : skill;
  }

  return getToolDetail(name, input);
}

// Prefix each line with its real file line number, right-aligned so the
// colons line up (cat -n style). A single trailing-newline phantom line is
// dropped so the count matches the lines actually read.
function numberLines(content: string, start: number): string {
  const lines = content.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const width = String(start + lines.length - 1).length;
  return lines
    .map((line, i) => `${String(start + i).padStart(width)}: ${line}`)
    .join("\n");
}

/**
 * Compose the Bash detail body from stdout / stderr / interrupted.
 * Returns null when there's nothing to show. Sections are separated
 * by a blank line; the `--- stderr ---` divider sits tight against
 * the stderr block (no blank line between divider and content) and
 * only appears when stdout is non-empty (otherwise stderr stands on
 * its own). `[interrupted]` marker tags user-cancelled commands so
 * they don't look like silent successes.
 */
function formatBashBody(
  stdout: string | undefined,
  stderr: string | undefined,
  interrupted: boolean | undefined,
): string | null {
  const out = stdout?.replace(/\n+$/, "");
  const err = stderr?.replace(/\n+$/, "");
  const sections: string[] = [];
  if (out) sections.push(out);
  if (err) sections.push(out ? `--- stderr ---\n${err}` : err);
  if (interrupted) sections.push("[interrupted]");
  if (sections.length === 0) return null;
  return sections.join("\n\n");
}

/**
 * Render AskUserQuestion's questions + options for the TUI detail view:
 *   Q: <question> (multi-select)
 *     ○ <label> — <description>
 * Questions are separated by a blank line. Returns null when there is
 * nothing to show so the caller falls back to the one-liner only.
 */
function formatAskBody(questions: AskQuestion[] | undefined): string | null {
  if (!questions || questions.length === 0) return null;
  const blocks = questions.map((q) => {
    const head = `Q: ${q.question ?? q.header ?? ""}${q.multiSelect ? " (multi-select)" : ""}`;
    const opts = (q.options ?? []).map(
      (o) =>
        `  ○ ${o.label ?? ""}${o.description ? ` — ${o.description}` : ""}`,
    );
    return [head, ...opts].join("\n");
  });
  return blocks.join("\n\n");
}

export function buildToolDetailBody(
  name: string,
  input: ToolInput | undefined,
  result: ToolUseResult | undefined,
): { text: string; kind: "diff" | "code"; numbered?: boolean } | null {
  if (name === "AskUserQuestion") {
    const text = formatAskBody(input?.questions);
    if (text) return { text, kind: "code" };
    return null;
  }
  // Skill: surface the args (the prompt handed to the skill) in the detail
  // view. No args → null; the one-liner already shows the skill name.
  if (name === "Skill") {
    return input?.args ? { text: input.args, kind: "code" } : null;
  }
  // Write intentionally shows the written file content (more useful to read
  // than an all-additions diff); the row summary still uses patch stats.
  if (name === "Write") {
    const content = result?.content ?? input?.content;
    if (content) return { text: content, kind: "code" };
  }
  // Task surfaces the subagent's returned text — without this, the LLM
  // summary pipeline sees only the task description and is blind to
  // whatever the subagent actually did or concluded.
  if (name === "Task") {
    const content = result?.content;
    if (content) return { text: content, kind: "code" };
  }
  // Bash: stdout + stderr + interrupted marker. TUI-only — the body
  // never flows into the markdown report path (see reportGenerator's
  // formatTaskBody which is the only one that unrolls a body inline).
  // Bash output is high-volume and noisy; the row's one-line command
  // label is enough for the LLM summary, and the full output is one
  // `↵` keystroke away in the TUI for the user.
  if (name === "Bash") {
    const text = formatBashBody(
      result?.stdout,
      result?.stderr,
      result?.interrupted,
    );
    if (text) return { text, kind: "code" };
  }
  if (name === "Read") {
    const content = result?.file?.content;
    if (content) {
      const start = result?.file?.startLine ?? input?.offset ?? 1;
      return {
        text: numberLines(content, start),
        kind: "code",
        numbered: true,
      };
    }
  }
  if (name === "Edit" || name === "Write") {
    const hunks = result?.structuredPatch;
    if (hunks && hunks.length > 0) {
      const text = hunks
        .map(
          (h) =>
            `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${(h.lines ?? []).join("\n")}`,
        )
        .join("\n");
      return { text, kind: "diff" };
    }
  }
  return null;
}
