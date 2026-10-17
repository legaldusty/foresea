import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5199', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx vite build --outDir dist-e2e --emptyOutDir && PORT=5199 GIVEWAY_DIST=dist-e2e GIVEWAY_AUDIT=data/cache/audit-e2e.sqlite npx tsx server/main.ts --ais replay',
    url: 'http://localhost:5199/api/health',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: 'demo', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
