import { defineConfig } from "tsup";

// The MCPB bundle (Claude Desktop, Smithery) ships without node_modules,
// so everything goes into one file.
export default defineConfig({
  entry: { index: "src/index.ts" },
  outDir: "mcpb/server",
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  noExternal: [/.*/],
  // Some bundled CommonJS dependencies call require(); give the ESM bundle one.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
