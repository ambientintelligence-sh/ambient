import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  // Runtime dependencies are imported by path at runtime (pi, sandbox-runtime,
  // chrome-devtools-mcp), so production node_modules must ship as real files
  // next to the asar: ESM loading, spawned processes, and native addons cannot
  // run from inside the archive.
  packagerConfig: {
    asar: { unpackDir: 'node_modules' },
    name: 'Ambient',
    ignore: (file) => {
      if (!file) return false;
      if (file.startsWith('/.vite') || file === '/package.json') return false;
      if (file === '/node_modules' || file.startsWith('/node_modules/')) {
        return file.startsWith('/node_modules/.vite') || file.startsWith('/node_modules/.cache');
      }
      return true;
    },
  },
  makers: [new MakerZIP({}, ['darwin'])],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/main.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/main/subagent.ts', config: 'vite.main.config.ts', target: 'main' },
        { entry: 'src/main/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
  ],
};

export default config;
