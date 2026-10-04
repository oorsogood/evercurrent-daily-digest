import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The e2e server injects a deterministic test LLM: no API key, no Groq calls, and a fresh database
// in the OS temp directory per run, so test data never lands in the project's .data folder.
const PORT = 3101;
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
      },
    },
  ],
  webServer: {
    command: 'npx vite build --logLevel error && npx tsx tests/e2e/server.ts',
    url: `http://127.0.0.1:${PORT}/api/context`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PORT: String(PORT), DATABASE_PATH: join(tmpdir(), `evercurrent-e2e-${Date.now()}.sqlite`) },
  },
});
