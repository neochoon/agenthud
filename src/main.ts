import { existsSync } from "node:fs";
import { render } from "ink";
import React from "react";
import { clearScreen, getHelp, getVersion, parseArgs } from "./cli.js";
import { runInit } from "./commands/init.js";
import {
  checkSessionAvailability,
  shortenPath,
} from "./data/sessionAvailability.js";
import { App } from "./ui/App.js";
import {
  startPerformanceCleanup,
  stopPerformanceCleanup,
} from "./utils/performance.js";

export function main(): void {
  const options = parseArgs(process.argv.slice(2));

  // Handle help command
  if (options.command === "help") {
    console.log(getHelp());
    process.exit(0);
  }

  // Handle version command
  if (options.command === "version") {
    console.log(getVersion());
    process.exit(0);
  }

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

    if (result.warnings.length > 0) {
      console.log("\nWarnings:");
      result.warnings.forEach((warning) => console.log(`  ⚠ ${warning}`));
    }

    console.log("\nNext steps:");
    console.log("  Run: npx agenthud\n");

    process.exit(0);
  }

  // Check session availability
  const cwd = process.cwd();
  const sessionAvailability = checkSessionAvailability(cwd);

  // If no Claude session in current directory
  if (!sessionAvailability.hasCurrentSession) {
    if (sessionAvailability.otherProjects.length > 0) {
      // Show other projects with sessions
      console.log("\nProjects with Claude Code sessions:");
      sessionAvailability.otherProjects.forEach((project, index) => {
        const shortPath = shortenPath(project.path);
        console.log(`  ${index + 1}. ${project.name} (${shortPath})`);
      });
      const firstProject = sessionAvailability.otherProjects[0];
      const firstShortPath = shortenPath(firstProject.path);
      console.log(`\nRun: cd ${firstShortPath} && agenthud\n`);
    } else {
      // No sessions anywhere
      console.log("\nCould not find any projects with Claude Code sessions.\n");
      console.log("Start a Claude Code session in a project directory first:");
      console.log("  $ claude\n");
    }
    process.exit(0);
  }

  // Check if .agenthud/ directory exists
  const agentDirExists = existsSync(".agenthud");

  // Clear screen in watch mode for clean display
  if (options.mode === "watch") {
    clearScreen();
  }

  const { waitUntilExit } = render(
    React.createElement(App, { mode: options.mode, agentDirExists }),
  );

  if (options.mode === "once") {
    // In once mode, exit after first render
    setTimeout(() => process.exit(0), 100);
  } else {
    // In watch mode, start performance cleanup to prevent memory leak warnings
    startPerformanceCleanup();

    // Wait until user quits, then cleanup
    waitUntilExit().then(() => {
      stopPerformanceCleanup();
      process.exit(0);
    });
  }
}
