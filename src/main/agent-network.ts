import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { BrowserMode } from '../shared/browser';
import type { LocalContextState } from '../shared/local-context';
import { vendorModuleUrl, vendorNodeModules } from './vendor';

type PiModule = typeof import('@earendil-works/pi-coding-agent');

// Resolved from the vendored node_modules at runtime so vite never bundles pi.
const importEsm = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

export async function createExaTool(options: {
  getNetworkEnabled: () => boolean;
  getLocalContext: () => LocalContextState;
}): Promise<ToolDefinition | null> {
  if (!process.env.EXA_API_KEY) return null;
  const { defineTool } = await importEsm<PiModule>(vendorModuleUrl('@earendil-works/pi-coding-agent'));
  return defineTool({
    name: 'exa_search',
    label: 'Exa Search',
    description: 'Fast tool for live-web research, current facts, source discovery, and text lookups. Use browser tools instead when live visual evidence or interactive page state is required.',
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 2_000 }),
      numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, default: 5 })),
    }),
    execute: async (_id, params, signal) => {
      if (!options.getNetworkEnabled()) throw new Error('Network access is disabled for this work item');
      const response = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.EXA_API_KEY! },
        body: JSON.stringify({
          query: params.query,
          type: 'auto',
          numResults: params.numResults ?? 5,
          ...(options.getLocalContext().countryCode ? { userLocation: options.getLocalContext().countryCode } : {}),
          contents: { text: { maxCharacters: 1_800 } },
        }),
        signal,
      });
      if (!response.ok) throw new Error(`Exa search failed (${response.status}): ${await response.text()}`);
      const payload = await response.json() as { results?: { title?: string; url?: string; publishedDate?: string; text?: string }[] };
      const results = Array.isArray(payload.results) ? payload.results : [];
      const text = results.map((result, index) => [
        `${index + 1}. ${result.title || '(untitled)'}`,
        result.url || '',
        result.publishedDate ? `Published: ${result.publishedDate}` : '',
        String(result.text || '').replace(/\s+/g, ' ').trim().slice(0, 1_800),
      ].filter(Boolean).join('\n')).join('\n\n');
      return { content: [{ type: 'text', text: text || 'No Exa results found.' }], details: { resultCount: results.length } };
    },
  });
}

/**
 * Writes a pi extension file that mounts chrome-devtools-mcp through
 * pi-mcp-adapter, and returns its path for `additionalExtensionPaths`.
 * pi's own loader transpiles the adapter's TypeScript sources at runtime.
 */
export async function writeBrowserMcpExtension(options: {
  agentDir: string;
  name: string;
  browser: { mode: BrowserMode; browserUrl?: string; executablePath?: string };
  chromeMcpPath: string;
}): Promise<string> {
  const browserArgs = options.browser.mode === 'visible' && options.browser.browserUrl
    ? [
        `--browser-url=${options.browser.browserUrl}`,
        '--no-usage-statistics',
        '--no-performance-crux',
        '--allow-unrestricted-paths',
        '--screenshot-format=jpeg',
        '--screenshot-quality=70',
        '--screenshot-max-width=1600',
      ]
    : [
        '--headless=true',
        '--isolated=true',
        ...(options.browser.executablePath ? [`--executable-path=${options.browser.executablePath}`] : []),
        '--no-usage-statistics',
        '--no-performance-crux',
        '--allow-unrestricted-paths',
        '--screenshot-format=jpeg',
        '--screenshot-quality=70',
        '--screenshot-max-width=1600',
      ];
  const mcpConfig = {
    settings: { requestTimeoutMs: 120_000 },
    mcpServers: {
      chrome_devtools: {
        command: process.execPath,
        args: [options.chromeMcpPath, ...browserArgs],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          CI: '1',
          CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1',
          CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1',
        },
        lifecycle: 'lazy',
      },
    },
  };
  const adapterPath = path.join(vendorNodeModules(), 'pi-mcp-adapter/index.ts');
  const extensionPath = path.join(options.agentDir, `${options.name}-mcp-extension.ts`);
  await writeFile(extensionPath, [
    `import { createMcpAdapter } from ${JSON.stringify(adapterPath)};`,
    `export default createMcpAdapter({ config: ${JSON.stringify(mcpConfig)} });`,
    '',
  ].join('\n'), { mode: 0o600 });
  return extensionPath;
}
