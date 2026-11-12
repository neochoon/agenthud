import { cpSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  shims: true,
  onSuccess: async () => {
    cpSync("src/templates", "dist/templates", { recursive: true });
    // The web UI is one self-contained HTML file, served verbatim by
    // `agenthud web`. It sits next to the bundled entry so
    // `dirname(import.meta.url)` finds it in dist and in src alike.
    cpSync("src/server/web-ui.html", "dist/web-ui.html");
  },
});
