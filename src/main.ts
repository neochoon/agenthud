import { existsSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { render } from "ink";
import React from "react";
import { clearScreen, getHelp, getVersion, parseArgs } from "./cli.js";
import { loadGlobalConfig } from "./config/globalConfig.js";
import { generateReport } from "./data/reportGenerator.js";
import {
  decodeProjectPath,
  discoverSessions,
  findContainingProject,
  getProjectsDir,
} from "./data/sessions.js";
import { runRangeSummary, runSummary } from "./data/summaryRunner.js";
import { App } from "./ui/App.js";
import { enterAltScreen, installAltScreenCleanup } from "./utils/altScreen.js";
import { isLegacyProjectConfig } from "./utils/legacyConfig.js";

const options = parseArgs(process.argv.slice(2));

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
  const config = loadGlobalConfig();
  const tree = discoverSessions(config);
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
  process.exit(0);
}

if (options.mode === "summary") {
  if (options.summaryError) {
    process.stderr.write(`agenthud: ${options.summaryError}\n`);
    process.exit(1);
  }
  const today = new Date();
  if (options.summaryFrom && options.summaryTo) {
    const exitCode = await runRangeSummary({
      from: options.summaryFrom,
      to: options.summaryTo,
      today,
      force: options.summaryForce ?? false,
      assumeYes: options.summaryAssumeYes ?? false,
      model: options.summaryModel,
    });
    process.exit(exitCode);
  }
  const exitCode = await runSummary({
    date: options.summaryDate!,
    prompt: options.summaryPrompt,
    force: options.summaryForce ?? false,
    today,
    model: options.summaryModel,
  });
  process.exit(exitCode);
}

let scopeToProject: string | undefined;
if (options.scopeToCwd) {
  const projectsDir = getProjectsDir();
  let registered: string[] = [];
  try {
    registered = (readdirSync(projectsDir) as string[]).map(decodeProjectPath);
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
  process.stderr.write(`agenthud: scope = ${match}\n`);
}

if (options.mode === "watch") {
  // Switch to the alternate screen buffer so quitting restores the user's
  // pre-launch shell instead of leaving the rendered tree behind. The
  // cleanup hooks ensure we exit alt-screen on q, Ctrl+C, SIGTERM, and
  // uncaught errors.
  installAltScreenCleanup();
  enterAltScreen();
} else {
  // Non-watch modes (--once, report, summary) keep their output on the
  // user's normal terminal, just like any CLI utility.
  if (options.mode === "once") clearScreen();
}

render(React.createElement(App, { mode: options.mode, scopeToProject }));
