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

if (options.mode !== "watch") {
  clearScreen();
}

render(React.createElement(App, { mode: options.mode }));
