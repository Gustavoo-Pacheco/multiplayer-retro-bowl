import { existsSync, writeFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Tests need the server's dev operations, which this local-only file turns on.
if (!existsSync('.dev.vars')) writeFileSync('.dev.vars', 'DEV_TOOLS=1\n');

const PORT = 5199;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 300_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 15_000,
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
