/**
 * Pluggable summary engines. `agenthud summary` builds an activity
 * report and hands it to ONE agent CLI for synthesis. Historically
 * that was hardcoded to `claude -p`; this module lets Codex CLI and
 * Kiro CLI users (and multi-agent users with a preference) pick the
 * engine instead.
 *
 * Selection (resolveSummaryEngine): an explicit `--engine` flag wins,
 * then the `summary.engine` config value; `auto` resolves to the
 * first CLI on PATH in claude → codex → kiro order — so existing
 * Claude users and single-agent users need no config.
 *
 * Each engine knows its CLI binary, how to build args, and how to
 * turn the process's stdout into summary text + (when available)
 * token usage. The actual spawning + cache/stream plumbing lives in
 * summaryRunner; engines stay free of I/O policy so their arg
 * building and output parsing are unit-testable in isolation.
 *
 * Engine specifics:
 * - claude: `claude -p --output-format stream-json` → parse JSONL
 *   events (assistant text + a `result` event carrying usage).
 * - codex:  `codex exec -o <file>` → the final message is written to
 *   `<file>`; stdout carries only progress, so the parser is a
 *   no-op and summaryRunner reads the file at close (outputMode
 *   "file").
 * - kiro:   `kiro-cli chat --no-interactive --trust-tools=` → plain
 *   text on stdout; the parser passes it through, stripping ANSI.
 */

import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { UsageSummary } from "../types/index.js";

export type EngineName = "claude" | "codex" | "kiro";

export interface BuildArgsCtx {
  prompt: string;
  model?: string;
  /** Only meaningful for engines whose `outputMode` is "file". */
  outFile?: string;
}

/** Incrementally consumes a process's stdout, emitting display text
 * via `onText` and accumulating usage. One instance per run. */
export interface EngineParser {
  feed(chunk: string, onText: (text: string) => void): void;
  /** Call after the process closes (flush any buffered line). */
  flush?(onText: (text: string) => void): void;
  usage(): UsageSummary | null;
}

export interface SummaryEngine {
  readonly name: EngineName;
  /** CLI binary to spawn. */
  readonly command: string;
  /** "stream": summary text comes from stdout via the parser.
   *  "file": stdout is progress noise; the text is read from the
   *  `outFile` the caller passed in buildArgs. */
  readonly outputMode: "stream" | "file";
  /** Human label for the "CLI not found" hint. */
  readonly installHint: string;
  buildArgs(ctx: BuildArgsCtx): string[];
  makeParser(): EngineParser;
  isAvailable(): boolean;
}

// Cross-platform PATH lookup without spawning the binary. Checks each
// PATH entry for `<command>` (and `.exe`/`.cmd`/`.bat` on Windows).
function commandExists(command: string): boolean {
  const pathVar = process.env.PATH ?? "";
  const exts =
    process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      if (existsSync(join(dir, command + ext))) return true;
    }
  }
  return false;
}

const ANSI_RE = /\[[0-9;?]*[A-Za-z]/g;

function toUsage(u: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}): UsageSummary {
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    costUsd: null,
  };
}

// ── Claude ────────────────────────────────────────────────────────

function makeJsonlParser(
  onAssistantText: (
    event: Record<string, unknown>,
    emit: (t: string) => void,
  ) => void,
  onResult: (event: Record<string, unknown>) => UsageSummary | null,
): EngineParser {
  let lineBuf = "";
  let usage: UsageSummary | null = null;
  const handle = (line: string, onText: (t: string) => void) => {
    if (!line.trim()) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    onAssistantText(event, onText);
    const u = onResult(event);
    if (u) usage = u;
  };
  return {
    feed(chunk, onText) {
      lineBuf += chunk;
      let nl = lineBuf.indexOf("\n");
      while (nl >= 0) {
        handle(lineBuf.slice(0, nl), onText);
        lineBuf = lineBuf.slice(nl + 1);
        nl = lineBuf.indexOf("\n");
      }
    },
    flush(onText) {
      if (lineBuf.trim()) handle(lineBuf, onText);
      lineBuf = "";
    },
    usage: () => usage,
  };
}

export const claudeEngine: SummaryEngine = {
  name: "claude",
  command: "claude",
  outputMode: "stream",
  installHint: "npm i -g @anthropic-ai/claude-code",
  buildArgs: ({ prompt, model }) => {
    const args = [
      "-p",
      "--no-session-persistence",
      "--output-format",
      "stream-json",
      "--verbose",
    ];
    if (model) args.push("--model", model);
    args.push(prompt);
    return args;
  },
  makeParser: () =>
    makeJsonlParser(
      (event, emit) => {
        if (event.type !== "assistant") return;
        const msg = event.message as
          | { content?: Array<{ type?: string; text?: string }> }
          | undefined;
        for (const block of msg?.content ?? []) {
          if (block.type === "text" && typeof block.text === "string") {
            emit(block.text);
          }
        }
      },
      (event) => {
        if (event.type !== "result") return null;
        const u = event.usage as Parameters<typeof toUsage>[0] | undefined;
        if (!u) return null;
        const usage = toUsage(u);
        const cost = event.total_cost_usd;
        usage.costUsd = typeof cost === "number" ? cost : null;
        return usage;
      },
    ),
  isAvailable: () => commandExists("claude"),
};

// ── Codex ─────────────────────────────────────────────────────────

export const codexEngine: SummaryEngine = {
  name: "codex",
  command: "codex",
  outputMode: "file",
  installHint: "npm i -g @openai/codex",
  buildArgs: ({ prompt, model, outFile }) => {
    const args = ["exec", "--skip-git-repo-check"];
    if (outFile) args.push("-o", outFile);
    if (model) args.push("-m", model);
    args.push(prompt);
    return args;
  },
  // stdout is progress noise; the final answer is read from outFile.
  makeParser: () => ({
    feed: () => {},
    usage: () => null,
  }),
  isAvailable: () => commandExists("codex"),
};

// ── Kiro CLI ──────────────────────────────────────────────────────

export const kiroEngine: SummaryEngine = {
  name: "kiro",
  command: "kiro-cli",
  outputMode: "stream",
  installHint: "see https://kiro.dev for the Kiro CLI",
  buildArgs: ({ prompt, model }) => {
    const args = ["chat", "--no-interactive", "--trust-tools="];
    if (model) args.push("--model", model);
    args.push(prompt);
    return args;
  },
  // Plain text on stdout; strip ANSI so the cached summary is clean.
  makeParser: () => ({
    feed(chunk, onText) {
      const clean = chunk.replace(ANSI_RE, "");
      if (clean) onText(clean);
    },
    usage: () => null,
  }),
  isAvailable: () => commandExists("kiro-cli"),
};

/** All engines in auto-detect preference order. */
export const ENGINES: SummaryEngine[] = [claudeEngine, codexEngine, kiroEngine];

function engineByName(name: string): SummaryEngine | undefined {
  return ENGINES.find((e) => e.name === name);
}

// ── Cache provenance ──────────────────────────────────────────────
//
// A cached summary is the output of ONE (engine, model). Switching
// either must regenerate, not silently serve the old engine's text.
// We stamp a provenance marker into the summary body (separate from
// the index's backlink block, so regenerateIndex leaves it alone)
// and compare it on a cache hit.

const ENGINE_MARKER_RE =
  /<!--\s*agenthud-engine:\s*([a-z-]+)\s+model:\s*(.+?)\s*-->/i;

/** Build the provenance marker prepended to a freshly generated
 * summary. `model` defaults to the literal "default" when unset. */
export function engineMarker(engine: string, model?: string): string {
  return `<!-- agenthud-engine: ${engine} model: ${model ?? "default"} -->`;
}

/** Read the provenance marker back out of a cached summary, or null
 * when the file predates markers. */
export function parseEngineMarker(
  content: string,
): { engine: string; model: string } | null {
  const m = content.match(ENGINE_MARKER_RE);
  if (!m) return null;
  return { engine: m[1].toLowerCase(), model: m[2] };
}

/**
 * True when a cached summary may be reused for a request of
 * (engine, model). A present marker must match both. A LEGACY cache
 * (no marker — written before this feature) is treated as a claude
 * summary, model-agnostic: reusable for claude requests, regenerated
 * for codex/kiro. This avoids needlessly regenerating everyone's
 * existing Claude summaries on upgrade while still honoring switches.
 */
export function cacheMatchesEngine(
  content: string,
  engine: string,
  model?: string,
): boolean {
  const prov = parseEngineMarker(content);
  if (!prov) return engine === "claude";
  return prov.engine === engine && prov.model === (model ?? "default");
}

/**
 * Resolve which engine to run. `flag` (from `--engine`) wins, then
 * `engine` (from `summary.engine` config). `auto` (or unset) picks
 * the first available engine in ENGINES order. Throws a helpful
 * error when an explicitly-named engine's CLI is missing, or when
 * `auto` finds none installed.
 */
export function resolveSummaryEngine(opts: {
  engine?: string;
  flag?: string;
}): SummaryEngine {
  const requested = (opts.flag ?? opts.engine ?? "auto").toLowerCase();

  if (requested !== "auto") {
    const engine = engineByName(requested);
    if (!engine) {
      throw new Error(
        `Unknown summary engine "${requested}". Valid: claude, codex, kiro, auto.`,
      );
    }
    if (!engine.isAvailable()) {
      throw new Error(
        `summary engine "${engine.name}" selected but its CLI (${engine.command}) was not found on PATH. Install it (${engine.installHint}) or pick another with --engine / summary.engine.`,
      );
    }
    return engine;
  }

  for (const engine of ENGINES) {
    if (engine.isAvailable()) return engine;
  }
  throw new Error(
    "summary: no supported agent CLI found on PATH (looked for claude, codex, kiro-cli). Install one, or set summary.engine.",
  );
}
