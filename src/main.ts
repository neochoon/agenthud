import { createInterface } from "node:readline";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { render } from "ink";
import React from "react";
import { clearScreen, getHelp, getVersion, parseArgs } from "./cli.js";
import { App } from "./ui/App.js";

const options = parseArgs(process.argv.slice(2));

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
    rl.question(
      "Delete the old config file and continue? [y/N] ",
      (answer) => {
        rl.close();
        if (answer.trim().toLowerCase() === "y") {
          rmSync(legacyConfig);
          console.log("Deleted .agenthud/config.yaml.");
        } else {
          console.log("Aborted.");
          process.exit(0);
        }
        resolve();
      },
    );
  });
}

if (options.mode === "watch") {
  clearScreen();
}

render(React.createElement(App, { mode: options.mode }));
