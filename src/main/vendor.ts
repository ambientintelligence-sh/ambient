import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Production dependencies ship as real files (asar-unpacked) so Node's ESM
 * loader, spawned MCP servers, and native addons all work from disk paths.
 * In development they resolve from the project root.
 *
 * Utility processes cannot touch `electron.app`, so the main process hands
 * the resolved directory down through AMBIENT_VENDOR_NODE_MODULES.
 */
export function vendorNodeModules(): string {
  const inherited = process.env.AMBIENT_VENDOR_NODE_MODULES;
  if (inherited) return inherited;
  const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');
  if (existsSync(unpacked)) return unpacked;
  // Main process in development: resolve from the project root.
  const { app } = require('electron') as typeof import('electron');
  return path.join(app.getAppPath(), 'node_modules');
}

/** Absolute file URL for a package entry, importable via dynamic import(). */
export function vendorModuleUrl(packageName: string, entry = 'dist/index.js'): string {
  return pathToFileURL(path.join(vendorNodeModules(), packageName, entry)).href;
}
