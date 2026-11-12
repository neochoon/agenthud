/**
 * Global test setup: point the app's data directory at a throwaway
 * temp dir so no test — mocked or not — can read or write the
 * developer's real ~/.agenthud. (A real leak happened: summary
 * index files in the maintainer's home carried mtimes matching
 * test runs.) Loaded via vitest `setupFiles`, which runs before
 * each test file's imports, so even module-level path constants
 * pick the override up.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.AGENTHUD_HOME = mkdtempSync(join(tmpdir(), "agenthud-test-"));
// Same isolation for the DSH provider: its sessions root lives under
// DSH_HOME, so pointing it at a non-existent temp dir keeps a test run
// from reading (and asserting on) the developer's real ~/.dsh corpus.
// The parent exists, the home itself does not — `isAvailable()` then
// reports false until a test opts in with its own DSH_HOME.
process.env.DSH_HOME = join(
  mkdtempSync(join(tmpdir(), "agenthud-dsh-test-")),
  "no-dsh-home",
);
