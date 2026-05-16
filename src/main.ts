import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { render } from "ink";
import React from "react";

import { clearScreen, getHelp, getVersion, parseArgs } from "./cli.js";
import { loadGlobalConfig } from "./config/globalConfig.js";
import { generateReport } from "./data/reportGenerator.js";
import { runSummary } from "./data/summaryRunner.js";
import { discoverSessions } from "./data/sessions.js";
import { App } from "./ui/App.js";

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
if (existsSync(legacyConfig)) {
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

  const markdown = generateReport(tree.sessions, {
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
  const exitCode = await runSummary({
    date: options.summaryDate!,
    prompt: options.summaryPrompt,
    force: options.summaryForce ?? false,
    today: new Date(),
  });
  process.exit(exitCode);
}

if (options.mode === "watch") {
  clearScreen();
}

render(React.createElement(App, { mode: options.mode }));
