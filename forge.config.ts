import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import * as path from "path";
import * as fs from "fs";

const config: ForgeConfig = {
  packagerConfig: {
    // Modules with native binaries must be outside the asar so they can execute.
    asar: {
      unpackDir:
        "node_modules/{audiotee,macos-audio-devices,better-sqlite3,bufferutil,utf-8-validate}",
    },
    icon: "./assets/icon",
    appBundleId: "com.ambient.app",
    // Vite bundles most deps but modules in rollupOptions.external are required
    // at runtime. Copy them and their full transitive dep tree into node_modules
    // before the asar is created.
    afterCopy: [
      (buildPath, _electronVersion, _platform, _arch, callback) => {
        const rootModules = path.resolve(__dirname, "node_modules");
        const dstModules = path.resolve(buildPath, "node_modules");
        const visited = new Set<string>();

        function copyWithDeps(name: string) {
          if (visited.has(name)) return;
          visited.add(name);
          const src = path.resolve(rootModules, name);
          if (!fs.existsSync(src)) return;
          const dst = path.resolve(dstModules, name);
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          if (!fs.existsSync(dst)) {
            fs.cpSync(src, dst, { recursive: true });
          }
          try {
            const pkg = JSON.parse(
              fs.readFileSync(path.join(src, "package.json"), "utf8"),
            );
            for (const dep of Object.keys(pkg.dependencies ?? {})) {
              copyWithDeps(dep);
            }
          } catch {}
        }

        const externalModules = [
          "audiotee",
          "macos-audio-devices",
          "better-sqlite3",
          "drizzle-orm",
          "exa-js",
          "@elevenlabs/elevenlabs-js",
          "ws",
          "bufferutil",
          "utf-8-validate",
        ];

        for (const mod of externalModules) {
          copyWithDeps(mod);
        }

        callback();
      },
    ],
    osxSign: {
      optionsForFile: () => ({
        entitlements: "./assets/entitlements.plist",
      }),
    },
    darwinDarkModeSupport: true,
    extendInfo: {
      NSScreenCaptureUsageDescription:
        "Ambient needs screen capture access to record system audio.",
      NSMicrophoneUsageDescription:
        "Ambient needs microphone access to capture your voice.",
    },
  },
  makers: [
    new MakerDMG({
      format: "ULFO",
    }),
    new MakerZIP({}, ["darwin"]),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: "src/electron/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/electron/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
