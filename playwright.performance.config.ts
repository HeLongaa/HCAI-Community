import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PERFORMANCE_PORT ?? 4173)
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PLAYWRIGHT_PERFORMANCE_PORT must be a valid TCP port')
const origin = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  testMatch: 'public-entry-performance.spec.ts',
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `STATIC_HOST=127.0.0.1 STATIC_PORT=${port} npm run serve:production`,
    url: `${origin}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium-production', use: { ...devices['Desktop Chrome'] } }],
})
