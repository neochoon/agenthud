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
  },
});
