import { defineConfig } from "tsup";
import { cpSync } from "fs";

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
