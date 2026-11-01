import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  sourcemap: true,
  // Bundle the SDK so `npx markproof-mcp` works without a separate install step.
  noExternal: ["markproof"],
});
