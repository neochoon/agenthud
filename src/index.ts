#!/usr/bin/env node

// Check Node.js version before importing any dependencies
// This prevents ugly crashes from libraries that require Node 20+
const MIN_NODE_VERSION = 20;
const match = process.version.match(/^v?(\d+)/);
const majorVersion = match ? Number.parseInt(match[1], 10) : 0;

if (majorVersion < MIN_NODE_VERSION) {
  console.error(
    `\nError: Node.js ${MIN_NODE_VERSION}+ is required (current: ${process.version})\n`,
  );
  console.error("Please upgrade Node.js:");
  console.error("  https://nodejs.org/\n");
  process.exit(1);
}

// Version is OK, dynamically import the main application
import("./main.js").then(({ main }) => main());
