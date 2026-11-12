/**
 * Style reference: a sample of the author's OWN writing, injected into
 * the summary prompt so the engine imitates their register instead of
 * emitting a generic engineering report.
 *
 * Why a separate file rather than "just edit summary-prompt.md":
 * - The style block is shared by the daily and the range prompt, which
 *   otherwise differ. Copying a kilobyte of style prose into both
 *   invites drift the moment one of them is edited.
 * - It needs its own on/off switch (`--no-style`) and its own source
 *   (`--style`, `summary.style`) without forking the prompt.
 * - Cache invalidation falls out for free: the COMPOSED prompt is what
 *   gets fingerprinted, so editing only the style file still invalidates
 *   the cache and regenerates.
 *
 * Why a distilled profile and not the raw corpus: a real archive of
 * weekly reports is tens of kilobytes of project content. Feeding it
 * verbatim costs ~10K input tokens per run and teaches the wrong thing —
 * the model starts pulling project names and technical conclusions out
 * of the samples into unrelated summaries. What we want to transfer is
 * register (dropped subject, 了-suffixed verbs, semicolon-chained
 * actions, problems stated plainly), not substance.
 *
 * Placement: the block goes at the TOP of the composed prompt. The
 * bundled templates end with `Activity log:` as their last line, so
 * appending would land the style text after the payload marker and
 * detach it from the instructions it is meant to modify.
 *
 * Absence is not an error: with no `~/.agenthud/summary-style.md` the
 * feature is simply off, and the prompt is used as-is. Only an EXPLICIT
 * `--style` path that cannot be read surfaces an error, because the user
 * clearly meant to attach something.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { agenthudHome } from "../utils/agenthudHome.js";

/** Default filename inside the agenthud home directory. */
export const STYLE_FILENAME = "summary-style.md";

/**
 * Hard cap on the style block, in characters. A profile that needs more
 * than this is a corpus, not a profile — and a runaway file must never
 * quietly eat the context window (or the user's money).
 */
export const MAX_STYLE_CHARS = 8000;

export interface StyleReference {
  /** Text to inject, or null when no style reference applies. */
  text: string | null;
  /** Absolute path it came from ("" when none was used). */
  path: string;
  /** The file exceeded MAX_STYLE_CHARS and was cut at a paragraph break. */
  truncated: boolean;
  /** Set only for an EXPLICIT path that could not be read. */
  error?: string;
}

/** Default style file: `~/.agenthud/summary-style.md`. */
export function styleFilePath(): string {
  return join(agenthudHome(), STYLE_FILENAME);
}

/** `~`-expand, then resolve against cwd when still relative. */
function expandPath(p: string): string {
  const s = p.trim();
  let out = s;
  if (s === "~") out = homedir();
  else if (s.startsWith("~/") || s.startsWith("~\\")) {
    out = join(homedir(), s.slice(2));
  }
  return isAbsolute(out) ? out : resolve(process.cwd(), out);
}

/**
 * Cut at the last paragraph break before the cap so a truncated profile
 * ends on a whole thought instead of mid-sentence. The `cap / 2` guard
 * keeps a file with no paragraph breaks near the end from collapsing to
 * almost nothing.
 */
function truncateAtParagraph(text: string, cap: number): string {
  const cut = text.slice(0, cap);
  const brk = cut.lastIndexOf("\n\n");
  return brk > cap / 2 ? cut.slice(0, brk) : cut;
}

/**
 * Resolve the style reference for one summary run.
 *
 * Precedence is decided by the caller (CLI flag > config > default file);
 * this function only applies the outcome. `disabled` wins over `path` so
 * `--no-style` can override a configured path.
 */
export function resolveStyleReference(opts: {
  /** Explicit file (`--style`, `summary.style`). Must exist. */
  path?: string;
  /** `--no-style`, or `summary.style: false`. */
  disabled?: boolean;
}): StyleReference {
  if (opts.disabled) return { text: null, path: "", truncated: false };

  const explicit = opts.path?.trim();
  const target = explicit ? expandPath(explicit) : styleFilePath();

  if (!existsSync(target)) {
    if (explicit) {
      return {
        text: null,
        path: target,
        truncated: false,
        error: `style reference not found: ${target}`,
      };
    }
    return { text: null, path: "", truncated: false };
  }

  let raw: string;
  try {
    raw = readFileSync(target, "utf-8");
  } catch (err) {
    return {
      text: null,
      path: target,
      truncated: false,
      error: `cannot read style reference ${target}: ${(err as Error).message}`,
    };
  }

  // An empty (or whitespace-only) file is the documented way to say
  // "off" without deleting it — don't inject a hollow style block.
  if (raw.trim().length === 0) {
    return { text: null, path: "", truncated: false };
  }

  const truncated = raw.length > MAX_STYLE_CHARS;
  const text = truncated ? truncateAtParagraph(raw, MAX_STYLE_CHARS) : raw;
  return { text: text.trim(), path: target, truncated };
}

/**
 * Prepend the style reference to a summary prompt. Returns `prompt`
 * untouched when there is no style, so a run without one produces a
 * byte-identical prompt (and therefore the same cache fingerprint) as
 * before the feature existed.
 */
export function composePromptWithStyle(
  prompt: string,
  style: string | null,
): string {
  const block = style?.trim();
  if (!block) return prompt;
  return [
    "# Style reference",
    "",
    "Below is a sample of the author's own engineering weekly reports.",
    "Imitate its register, sentence shape and word choice. Copy the",
    "WRITING ONLY — do not lift project names, technical details or",
    "conclusions out of it into the summary you are about to write.",
    "",
    "<sample>",
    block,
    "</sample>",
    "",
    "---",
    "",
    prompt,
  ].join("\n");
}
