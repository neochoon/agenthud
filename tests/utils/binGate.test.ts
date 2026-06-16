import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Guards the Node-version gate in the built bin (`dist/index.js`).
 *
 * The gate only works if it runs BEFORE any project/dependency code loads —
 * which requires `dist/index.js` to carry NO static imports (those hoist to
 * the top of an ESM module and evaluate first) and to pull the app in via a
 * dynamic `import()` instead. tsup keeps `main` as a deferred chunk today; a
 * future build-config change (e.g. disabling splitting / inlining) would
 * silently hoist deps above the gate and break it on old Node. This test
 * fails loudly if that ever happens.
 */

const distIndex = join(process.cwd(), "dist", "index.js");

describe("bin Node-version gate (built dist/index.js)", () => {
  beforeAll(() => {
    // CI builds before testing; locally, build on demand if dist is absent.
    if (!existsSync(distIndex)) {
      execSync("npm run build", { cwd: process.cwd(), stdio: "ignore" });
    }
  }, 120_000);

  it("the built bin exists", () => {
    expect(existsSync(distIndex)).toBe(true);
  });

  it("has NO static imports — only a dynamic import of the main chunk", () => {
    const src = readFileSync(distIndex, "utf-8");
    // A static import statement starts a line with `import` NOT immediately
    // followed by `(`. The deferred `import("./main-…")` is dynamic and must
    // be the only `import` in the file.
    const staticImport = /^\s*import\b(?!\s*\()/m;
    expect(staticImport.test(src)).toBe(false);
    expect(/import\s*\(/.test(src)).toBe(true);
  });

  it("runs the version gate before importing the main chunk", () => {
    const src = readFileSync(distIndex, "utf-8");
    const exitIdx = src.indexOf("process.exit(1)");
    const dynImportIdx = src.search(/import\s*\(/);
    expect(exitIdx).toBeGreaterThanOrEqual(0); // the gate exits
    expect(dynImportIdx).toBeGreaterThan(exitIdx); // ...before loading main
    expect(src).toContain("process.version");
    expect(src).toMatch(/MIN_NODE_VERSION\s*=\s*20/);
  });
});
