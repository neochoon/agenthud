import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { render } from "ink";
import React from "react";

import { clearScreen, getHelp, getVersion, parseArgs } from "./cli.js";
import { loadGlobalConfig } from "./config/globalConfig.js";
import { generateReport } from "./data/reportGenerator.js";
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

  let gitLog: string | undefined;
  if (options.reportWithGit) {
    try {
      const dateStr = options.reportDate!.toLocaleDateString("en-CA"); // YYYY-MM-DD
      gitLog = execSync(
        `git log --oneline --after="${dateStr} 00:00:00" --before="${dateStr} 23:59:59" 2>/dev/null`,
        { encoding: "utf-8" },
      ).trim();
    } catch {
      // not a git repo or git not available — silently skip
    }
  }

  const markdown = generateReport(tree.sessions, {
    date: options.reportDate!,
    include: options.reportInclude!,
    format: options.reportFormat,
    detailLimit: options.reportDetailLimit,
    gitLog: gitLog || undefined,
  });
  process.stdout.write(`${markdown}\n`);
  process.exit(0);
}

if (options.mode === "watch") {
  clearScreen();
}

render(React.createElement(App, { mode: options.mode }));
