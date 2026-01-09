#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./ui/App.js";
import { parseArgs } from "./cli.js";

const options = parseArgs(process.argv.slice(2));

const { waitUntilExit } = render(React.createElement(App, { mode: options.mode }));

if (options.mode === "once") {
  // In once mode, exit after first render
  setTimeout(() => process.exit(0), 100);
} else {
  // In watch mode, wait until user quits
  waitUntilExit().then(() => process.exit(0));
}
