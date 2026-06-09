#!/usr/bin/env node
/**
 * CLI binary entry. Performs Node-version gate and forces
 * `NODE_ENV=production` *before* dynamically importing the main
 * application bundle.
 *
 * Design decisions:
 * - Pre-import work lives here as plain top-level code (no imports
 *   of project modules) because some transitive deps require Node
 *   20+. If we let those load on Node 18 the error message is an
 *   incomprehensible stack from inside a dep — the guard here
 *   replaces it with a one-line "upgrade Node" message.
 * - The main app is loaded via `await import("./main.js")` so the
 *   bundler keeps it as a deferred chunk and the guard above
 *   actually runs first.
 *
 * Gotcha:
 * - `process.env.NODE_ENV = "production"` MUST happen before
 *   importing anything that pulls in React/Ink, or the dev-mode
 *   profiler accumulates `PerformanceMeasure` objects (~600KB/s)
 *   and watch mode OOMs after ~88 min. Confirmed regression
 *   pattern — do not move this assignment after the import.
 */

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

// Force production mode for React/Ink to disable dev-mode profiling.
// In dev mode React calls performance.measure() per render which accumulates
// PerformanceMeasure objects in a global buffer that never gets cleaned —
// causing the watch-mode TUI to OOM after ~88 minutes (~600KB/s leak).
if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

// Version is OK, dynamically import the main application
import("./main.js");
