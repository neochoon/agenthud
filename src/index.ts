#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { existsSync } from "fs";
import { App } from "./ui/App.js";
import { parseArgs, clearScreen } from "./cli.js";
import { runInit } from "./commands/init.js";

const options = parseArgs(process.argv.slice(2));

// Handle init command
if (options.command === "init") {
  const result = runInit();

  console.log("\n✓ agenthud initialized\n");

  if (result.created.length > 0) {
    console.log("Created:");
    result.created.forEach((file) => console.log(`  ${file}`));
  }

  if (result.skipped.length > 0) {
    console.log("\nSkipped (already exists):");
    result.skipped.forEach((file) => console.log(`  ${file}`));
  }

  console.log("\nNext steps:");
  console.log("  1. Edit .agent/plan.json to add your project plan");
  console.log("  2. Run: npx agenthud\n");

  process.exit(0);
}

// Check if .agent/ directory exists
const agentDirExists = existsSync(".agent");

// Clear screen in watch mode for clean display
if (options.mode === "watch") {
  clearScreen();
}

const { waitUntilExit } = render(
  React.createElement(App, { mode: options.mode, agentDirExists })
);

if (options.mode === "once") {
  // In once mode, exit after first render
  setTimeout(() => process.exit(0), 100);
} else {
  // In watch mode, wait until user quits
  waitUntilExit().then(() => process.exit(0));
}
