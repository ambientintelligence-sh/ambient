import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  build: {
    lib: {
      entry: {
        main: "src/electron/main.ts",
      },
      formats: ["cjs"],
      fileName: () => "[name].js",
    },
    rollupOptions: {
      external: [
        "audiotee",
        "macos-audio-devices",
        "electron",
        "electron/renderer",
        "better-sqlite3",
        "drizzle-orm",
        "exa-js",
        // secure-exec + its @secure-exec/* workspace packages bundle native
        // bindings (Rust V8 subprocess) and transitively pull in
        // node-stdlib-browser, which assumes a browser-shim build target. Let
        // Node resolve them from node_modules at runtime instead. ESM-only —
        // loaded via dynamic `import()` in src/core/agents/run-js-tool.ts.
        "secure-exec",
        /^@secure-exec\//,
        // pi-coding-agent pulls in pi-tui, @silvia-odwyer/photon-node (WASM),
        // jiti runtime, etc. Bundling it inflates main.js and breaks WASM
        // loading. ESM-only — loaded via dynamic `import()` in tools.ts.
        // NOTE: pi-agent-core + pi-ai are NOT externalized — Vite bundles
        // them successfully and they're used throughout as static imports.
        "@mariozechner/pi-coding-agent",
      ],
    },
  },
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "./src/core"),
    },
    conditions: ["node"],
    mainFields: ["module", "jsnext:main", "jsnext"],
  },
});
