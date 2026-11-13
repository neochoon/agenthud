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
 *
 * Gotcha — every engine takes its prompt on STDIN (`inputMode:
 * "stdin"`), never as a positional. Two reasons, one of them Windows:
 * 1. Kiro ignores stdin once a positional question is present, so the
 *    prompt has to ride along with the piped report anyway.
 * 2. On Windows the CLIs are `.cmd` shims, which cannot be spawned
 *    directly (Node throws EINVAL) — they must go through `cmd.exe`,
 *    and cmd.exe cannot pass a multi-line argument (it truncates at
 *    the newline). The prompt is 50+ lines of markdown, so keeping it
 *    off argv is the only thing that makes the Windows launch work.
 *    See `launchSpec`/`escapeWindowsArg` below.
 */

import { createHash } from "node:crypto";
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
  /** How the engine receives the prompt.
   *  "stdin": the prompt is prepended to the piped report and kept out
   *  of argv. Every engine ships this way — argv stays short and
   *  single-line, which is what makes a Windows `.cmd` shim launchable
   *  at all (see `launchSpec`).
   *  "arg" (legacy default): prompt as a positional in buildArgs and
   *  the report on stdin. Kept for out-of-tree engines; unusable on
   *  Windows with a shim, since a multi-line argv cannot pass through
   *  `cmd.exe`. */
  readonly inputMode?: "arg" | "stdin";
  /** Human label for the "CLI not found" hint. */
  readonly installHint: string;
  /** Optional: a benign, known stderr line this engine always prints
   *  that should be stripped from the passed-through diagnostics. Real
   *  errors (auth, crashes) are NOT matched and still surface. */
  readonly stderrFilter?: RegExp;
  buildArgs(ctx: BuildArgsCtx): string[];
  makeParser(): EngineParser;
  isAvailable(): boolean;
}

// Cross-platform PATH lookup without spawning the binary.
//
// On Windows the npm-installed CLIs are `.cmd` shims next to an
// extensionless bash shim and a `.ps1`; only the PATHEXT forms are
// executable via `cmd.exe`, and NOTHING is directly spawnable (Node
// throws EINVAL for a `.cmd` path, ENOENT for the bare name). So the
// resolver returns the shim's real path and `launchSpec` routes it
// through `cmd.exe`.
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

function executableExtensions(): string[] {
  if (process.platform !== "win32") return [""];
  const raw = process.env.PATHEXT || DEFAULT_PATHEXT;
  const exts: string[] = [];
  for (const ext of raw.split(";")) {
    const trimmed = ext.trim();
    if (!trimmed) continue;
    // Lower-case first: npm's shims are `codex.cmd`, so the resolved
    // path then matches the name on disk (spawning is case-insensitive,
    // but a path we log or compare should read the way the file does).
    // The PATHEXT-cased form stays as the fallback for a genuinely
    // upper-case `.EXE` on a case-sensitive directory.
    const lowered = trimmed.toLowerCase();
    if (!exts.includes(lowered)) exts.push(lowered);
    if (!exts.includes(trimmed)) exts.push(trimmed);
  }
  return exts;
}

/** Absolute path of `command` on PATH, or null when not found. POSIX
 * matches the bare name; Windows matches each PATHEXT extension (never
 * the extensionless bash shim, which `CreateProcess` can't run). */
export function resolveCommandPath(command: string): string | null {
  const pathVar = process.env.PATH ?? "";
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    for (const ext of executableExtensions()) {
      const candidate = join(dir, command + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function commandExists(command: string): boolean {
  return resolveCommandPath(command) !== null;
}

// ── Windows shim launching ────────────────────────────────────────
//
// A `.cmd`/`.bat` shim is not an executable image: it has to be handed
// to `cmd.exe`, which re-parses the whole command line. That means
// every argument needs cmd's own quoting/escaping, and it means an
// argument containing a newline is simply impossible (cmd ends the
// command there — measured: only the first line survives). Hence the
// `inputMode: "stdin"` rule at the top of this file.
//
// The escape below was measured against a real `.cmd` shim that
// forwards `%*` to a Node process, which re-expands the line once more
// — that extra pass is why a caret needs TWO levels while every other
// metacharacter needs one. Round-trips spaces, quotes, `%`, `!`, `&`,
// `|`, `<`, `>`, parens, commas, semicolons, backslashes and non-ASCII.
const WIN_ARG_META = /([()[\]%!^"`<>&|;, *?])/g;

/** Quote + escape one argument for a `cmd.exe /d /s /c` command line. */
export function escapeWindowsArg(arg: string): string {
  let s = String(arg);
  // Backslash-aware quote escaping, then double any trailing run so it
  // isn't swallowed by the closing quote.
  s = s.replace(/(\\*)"/g, '$1$1\\"');
  s = s.replace(/(\\*)$/, "$1$1");
  s = `"${s}"`;
  return s.replace(WIN_ARG_META, (m) => (m === "^" ? "^^" : `^${m}`));
}

export interface LaunchSpec {
  command: string;
  args: string[];
  /** Set on the Windows shim path: argv is already escaped, so Node
   * must not touch the command line before `cmd.exe` sees it. */
  windowsVerbatimArguments?: boolean;
}

/**
 * Turn (executable, args) into something `spawn` can actually run.
 *
 * POSIX and real `.exe`s are used as-is. A Windows `.cmd`/`.bat` shim
 * is wrapped in `cmd.exe /d /s /c "<escaped line>"` — the only way Node
 * can execute a batch shim, and the reason long text must stay on
 * stdin.
 */
export function launchSpec(executable: string, args: string[]): LaunchSpec {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(executable)) {
    return { command: executable, args };
  }
  const line = [executable, ...args].map(escapeWindowsArg).join(" ");
  return {
    // ComSpec is the documented way to find cmd.exe; the fallback keeps
    // a stripped environment working.
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", line],
    windowsVerbatimArguments: true,
  };
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
  // `claude -p` with no positional reads the prompt from stdin — same
  // pipe mode the report already uses, and the only form that survives
  // the Windows shim launch (see the header note).
  inputMode: "stdin",
  installHint: "npm i -g @anthropic-ai/claude-code",
  buildArgs: ({ model }) => {
    const args = [
      "-p",
      "--no-session-persistence",
      "--output-format",
      "stream-json",
      "--verbose",
    ];
    if (model) args.push("--model", model);
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
  // `codex exec` reads its instructions from stdin when no positional
  // prompt is given (`codex exec --help`: "If not provided as an
  // argument … instructions are read from stdin").
  inputMode: "stdin",
  installHint: "npm i -g @openai/codex",
  buildArgs: ({ model, outFile }) => {
    const args = [
      "exec",
      // `--ephemeral` = "run without persisting session files to disk".
      // Without it every summary call writes a rollout under
      // `~/.codex/sessions/` whose cwd is agenthud's own home, so the
      // generated sessions show up in agenthud's OWN tree as a
      // `.agenthud` project — the same self-pollution `claude -p
      // --no-session-persistence` prevents (v0.9.3).
      "--ephemeral",
      "--skip-git-repo-check",
    ];
    if (outFile) args.push("-o", outFile);
    if (model) args.push("-m", model);
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
  // Kiro reads stdin only when no positional question is supplied, so
  // the prompt rides on stdin (see buildArgs — it adds no positional).
  inputMode: "stdin",
  installHint: "see https://kiro.dev for the Kiro CLI",
  // Kiro itself documents `--trust-tools=` as "trust no tools", yet
  // still prints a warning that parses the empty value as a custom MCP
  // tool name. It's harmless noise; strip just that line (ANSI and all)
  // so real diagnostics stay visible. Matches the whole line by its
  // stable phrase.
  stderrFilter: /^.*--trust-tools arg for custom tool.*\r?\n?/m,
  buildArgs: ({ model }) => {
    const args = ["chat", "--no-interactive", "--trust-tools="];
    if (model) args.push("--model", model);
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
// A cached summary is the output of ONE (engine, model, prompt).
// Switching any of them must regenerate, not silently serve text
// produced under a different configuration — the prompt matters most
// visibly (its language decides the output language). We stamp a
// provenance marker into the summary body (separate from the index's
// backlink block, so regenerateIndex leaves it alone) and compare it on
// a cache hit.

const ENGINE_MARKER_RE =
  /<!--\s*agenthud-engine:\s*([a-z-]+)\s+model:\s*(.+?)(?:\s+prompt:\s*([0-9a-f]+))?\s*-->/i;

/** Short, stable fingerprint of a prompt template. Only used to detect
 * "the prompt changed", so a hash prefix is plenty. */
export function promptFingerprint(prompt: string): string {
  return createHash("sha1").update(prompt).digest("hex").slice(0, 8);
}

/** Build the provenance marker prepended to a freshly generated
 * summary. `model` defaults to the literal "default" when unset;
 * `prompt` (a fingerprint) is omitted when the caller has no prompt. */
export function engineMarker(
  engine: string,
  model?: string,
  prompt?: string,
): string {
  const base = `<!-- agenthud-engine: ${engine} model: ${model ?? "default"}`;
  return prompt ? `${base} prompt: ${prompt} -->` : `${base} -->`;
}

/** Read the provenance marker back out of a cached summary, or null
 * when the file predates markers. `prompt` is absent on files written
 * before the prompt fingerprint existed. */
export function parseEngineMarker(
  content: string,
): { engine: string; model: string; prompt?: string } | null {
  const m = content.match(ENGINE_MARKER_RE);
  if (!m) return null;
  const out: { engine: string; model: string; prompt?: string } = {
    engine: m[1].toLowerCase(),
    model: m[2],
  };
  if (m[3]) out.prompt = m[3];
  return out;
}

/**
 * True when a cached summary may be reused for a request of
 * (engine, model, prompt).
 *
 * - A marker carrying a prompt fingerprint must match all three, so
 *   editing the prompt (e.g. switching the output language) regenerates
 *   instead of serving text written under the old instructions.
 * - A marker WITHOUT a prompt fingerprint predates that field. It is
 *   matched on engine + model only, deliberately: upgrading agenthud
 *   should not silently re-bill every existing summary. Pass `--force`
 *   once to pick up a prompt change on those files.
 * - A LEGACY cache (no marker at all) is treated as a claude summary,
 *   model-agnostic: reusable for claude requests, regenerated for
 *   codex/kiro.
 */
export function cacheMatchesEngine(
  content: string,
  engine: string,
  model?: string,
  prompt?: string,
): boolean {
  const prov = parseEngineMarker(content);
  if (!prov) return engine === "claude";
  if (prov.engine !== engine || prov.model !== (model ?? "default")) {
    return false;
  }
  if (prov.prompt && prompt) return prov.prompt === prompt;
  return true;
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
