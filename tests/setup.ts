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
