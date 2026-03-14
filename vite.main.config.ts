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
        "@elevenlabs/elevenlabs-js",
        "ws",
        "bufferutil",
        "utf-8-validate",
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
