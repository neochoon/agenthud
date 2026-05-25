import { basename } from "node:path";

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
  file?: { startLine?: number; numLines?: number };
  statusChange?: { from?: string; to?: string };
  updatedFields?: string[];
  taskId?: string;
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

  return getToolDetail(name, input);
}

export function buildToolDetailBody(
  name: string,
  input: ToolInput | undefined,
  result: ToolUseResult | undefined,
): { text: string; kind: "diff" | "code" } | null {
  // Write intentionally shows the written file content (more useful to read
  // than an all-additions diff); the row summary still uses patch stats.
  if (name === "Write") {
    const content = result?.content ?? input?.content;
    if (content) return { text: content, kind: "code" };
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
