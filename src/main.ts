/**
 * Application bootstrap. Loads `~/.agenthud/config.yaml`, parses
 * argv, runs the legacy-config migration check, and dispatches
 * to one of: watch (interactive TUI), once (snapshot), report,
 * summary, or follow (headless event stream).
 *
 * Design decisions:
 * - Global config is loaded *before* `parseArgs` so the CLI parser
 *   can layer flags over `report.*` / `summary.*` user defaults
 *   (resolution order: CLI flag → summary key → report key →
 *   built-in default). Done eagerly here, not lazily downstream,
 *   so the effective-options stderr line at run start reflects the
 *   real values before any work begins.
 * - The legacy-config migration prompt fires from this entry
 *   point, not from inside the App component, so non-interactive
 *   modes (`--once`, `report`, `summary`) get the same prompt.
 *
 * Gotcha:
 * - The "is this a project-level config?" check honors WSL: from
 *   inside WSL, `homedir()` returns the Linux home but cwd often
 *   sits under `/mnt/c/Users/<X>` — the Windows-side home. Without
 *   the WSL guard, we'd offer to delete the Windows-native
 *   `.agenthud/config.yaml`. See `isLegacyProjectConfig()` for the
 *   actual detection.
 */

import { existsSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { render } from "ink";
import React from "react";
import {
  formatEffectiveOptionsLine,
  getHelp,
  getVersion,
  parseArgs,
} from "./cli.js";
import { loadGlobalConfig } from "./config/globalConfig.js";
import { generateReport } from "./data/reportGenerator.js";
import {
  decodeProjectPath,
  discoverSessions,
  findContainingProject,
  getProjectsDir,
} from "./data/sessions.js";
import {
  formatPromptSource,
  runRangeSummary,
  runSummary,
} from "./data/summaryRunner.js";
import { App } from "./ui/App.js";
import { enterAltScreen, installAltScreenCleanup } from "./utils/altScreen.js";
import { isLegacyProjectConfig } from "./utils/legacyConfig.js";

// Short-circuit help/version BEFORE touching the config: these are
// read-only queries and shouldn't create ~/.agenthud/config.yaml as
// a side effect (loadGlobalConfig materializes the default file).
const rawArgs = process.argv.slice(2);
if (
  rawArgs.includes("--help") ||
  rawArgs.includes("-h") ||
  rawArgs[0] === "help"
) {
  console.log(getHelp());
  process.exit(0);
}
if (
  rawArgs.includes("--version") ||
  rawArgs.includes("-V") ||
  rawArgs[0] === "version"
) {
  console.log(getVersion());
  process.exit(0);
}

// Load config up front so parseArgs can layer flags over user defaults
// (report.* / summary.* keys in ~/.agenthud/config.yaml).
const globalConfig = loadGlobalConfig();
const options = parseArgs(rawArgs, globalConfig);

// exit(0) immediately after a large stdout write TRUNCATES piped
// output — pipe writes are async and the unflushed remainder is
// discarded on exit. Reproduced live: `agenthud report | grep` got
// 574 of 966 lines and silently lost the trailing session blocks
// (a file redirect got all 966 — file fds flush synchronously).
// Await this before any exit that follows stdout output.
function flushStdout(): Promise<void> {
  return new Promise((resolve) => {
    process.stdout.write("", () => resolve());
  });
}

if (options.error) {
  process.stderr.write(`agenthud: ${options.error}\n`);
  process.exit(1);
}

if (options.command === "help") {
  console.log(getHelp());
  process.exit(0);
}

if (options.command === "version") {
  console.log(getVersion());
  process.exit(0);
}

const legacyConfig = join(process.cwd(), ".agenthud", "config.yaml");
if (
  isLegacyProjectConfig(process.cwd(), homedir()) &&
  existsSync(legacyConfig)
) {
  console.log(
    "The project-level config file (.agenthud/config.yaml) is no longer supported.",
  );
  console.log("Settings have moved to ~/.agenthud/config.yaml.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.question("Delete the old config file and continue? [y/N] ", (answer) => {
      rl.close();
      if (answer.trim().toLowerCase() === "y") {
        rmSync(legacyConfig);
        console.log("Deleted .agenthud/config.yaml.");
      } else {
        console.log("Aborted.");
        process.exit(0);
      }
      resolve();
    });
  });
}

if (options.mode === "report") {
  if (options.reportError) {
    process.stderr.write(`agenthud: ${options.reportError}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `${formatEffectiveOptionsLine("report", {
      include: options.reportInclude!,
      detailLimit: options.reportDetailLimit,
      withGit: options.reportWithGit ?? false,
      format: options.reportFormat,
    })}\n`,
  );
  const tree = discoverSessions(globalConfig);
  const flatSessions = [
    ...tree.projects.flatMap((p) => p.sessions),
    ...tree.coldProjects.flatMap((p) => p.sessions),
  ];

  const markdown = generateReport(flatSessions, {
    date: options.reportDate!,
    include: options.reportInclude!,
    format: options.reportFormat,
    detailLimit: options.reportDetailLimit,
    withGit: options.reportWithGit,
  });
  process.stdout.write(`${markdown}\n`);
  await flushStdout();
  process.exit(0);
}

if (options.mode === "summary") {
  if (options.summaryError) {
    process.stderr.write(`agenthud: ${options.summaryError}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `${formatEffectiveOptionsLine("summary", {
      include: options.summaryInclude!,
      detailLimit: options.summaryDetailLimit,
      withGit: options.summaryWithGit ?? false,
      model: options.summaryModel,
    })}\n`,
  );
  const isRangeMode = !!(options.summaryFrom && options.summaryTo);
  process.stderr.write(
    `prompt = ${formatPromptSource(
      isRangeMode ? "range" : "daily",
      options.summaryPrompt,
    )}\n`,
  );
  const today = new Date();
  if (options.summaryFrom && options.summaryTo) {
    const exitCode = await runRangeSummary({
      from: options.summaryFrom,
      to: options.summaryTo,
      today,
      force: options.summaryForce ?? false,
      assumeYes: options.summaryAssumeYes ?? false,
      engine: options.summaryEngine,
      engineFlag: options.summaryEngineFlag,
      model: options.summaryModel,
      include: options.summaryInclude!,
      detailLimit: options.summaryDetailLimit!,
      withGit: options.summaryWithGit!,
      open: options.summaryOpen,
      openIndex: options.summaryOpenIndex,
    });
    await flushStdout();
    process.exit(exitCode);
  }
  const exitCode = await runSummary({
    date: options.summaryDate!,
    prompt: options.summaryPrompt,
    force: options.summaryForce ?? false,
    today,
    engine: options.summaryEngine,
    engineFlag: options.summaryEngineFlag,
    model: options.summaryModel,
    include: options.summaryInclude!,
    detailLimit: options.summaryDetailLimit!,
    withGit: options.summaryWithGit!,
    open: options.summaryOpen,
    openIndex: options.summaryOpenIndex,
  });
  await flushStdout();
  process.exit(exitCode);
}

if (options.mode === "follow") {
  if (options.followError) {
    process.stderr.write(`agenthud: ${options.followError}\n`);
    process.exit(2);
  }
  const { parseSince } = await import("./data/followSince.js");
  const { runFollow } = await import("./data/followRunner.js");
  const since = parseSince(options.followSince, Date.now());
  if ("error" in since) {
    process.stderr.write(`agenthud: ${since.error}\n`);
    process.exit(2);
  }
  const include = options.followInclude?.length
    ? new Set(options.followInclude)
    : null;
  const { stop } = runFollow({
    config: globalConfig,
    sinceMs: since.sinceMs,
    json: !!options.followJson,
    include,
    once: !!options.followOnce,
  });
  process.stdout.on("error", () => process.exit(0)); // EPIPE on `| head`
  // `--once` emitted the backfill synchronously and scheduled no interval, so
  // the event loop drains and the process exits cleanly. Streaming mode keeps
  // the loop alive on the interval and exits on a signal.
  if (!options.followOnce) {
    const shutdown = () => {
      stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
  // Do not fall through to Ink.
} else {
  runWatchOrOnce();
}

function runWatchOrOnce(): void {
  const mode = options.mode === "once" ? "once" : "watch";
  let scopeToProject: string | undefined;
  if (options.scopeToCwd) {
    const projectsDir = getProjectsDir();
    let registered: string[] = [];
    try {
      registered = (readdirSync(projectsDir) as string[]).map(
        decodeProjectPath,
      );
    } catch {
      // projects dir missing or unreadable — treated as "no match"
    }
    const safeReal = (p: string): string => {
      try {
        return realpathSync(p);
      } catch {
        return p;
      }
    };
    const match = findContainingProject(process.cwd(), registered, {
      realpath: safeReal,
    });
    if (!match) {
      process.stderr.write(
        `agenthud: --cwd: no Claude project found at or above ${process.cwd()}\n`,
      );
      process.exit(1);
    }
    scopeToProject = match;
    process.stderr.write(`scope = ${match}\n`);
  }

  if (mode === "watch") {
    // Switch to the alternate screen buffer so quitting restores the user's
    // pre-launch shell instead of leaving the rendered tree behind. The
    // cleanup hooks ensure we exit alt-screen on q, Ctrl+C, SIGTERM, and
    // uncaught errors.
    installAltScreenCleanup();
    enterAltScreen();
  }
  // Non-watch modes (--once, report, summary) render in place at the
  // cursor so the user's existing scrollback is preserved — like any
  // CLI utility.

  render(React.createElement(App, { mode, scopeToProject }));
}
