import { createMcpAdapter } from 'pi-mcp-adapter';

const visible = process.env.PI_BROWSER_MODE === 'visible' && Boolean(process.env.PI_BROWSER_URL);
const chromeArgs = visible
  ? [
      `--browser-url=${process.env.PI_BROWSER_URL}`,
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
      '--executable-path=/usr/bin/chromium',
      '--chrome-arg=--no-sandbox',
      '--chrome-arg=--disable-dev-shm-usage',
      '--no-usage-statistics',
      '--no-performance-crux',
      '--allow-unrestricted-paths',
      '--screenshot-format=jpeg',
      '--screenshot-quality=70',
      '--screenshot-max-width=1600',
    ];

export default createMcpAdapter({
  config: {
    settings: {
      requestTimeoutMs: 120_000,
    },
    mcpServers: {
      chrome_devtools: {
        command: '/app/node_modules/.bin/chrome-devtools-mcp',
        args: chromeArgs,
        env: {
          CI: '1',
          CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1',
          CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1',
        },
        lifecycle: 'lazy',
      },
    },
  },
});
