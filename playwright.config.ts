import { defineConfig, devices } from '@playwright/test'

const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === 'true'
const portFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`)
  }
  return value
}
const apiPort = portFromEnv('PLAYWRIGHT_API_PORT', 8787)
const webPort = portFromEnv('PLAYWRIGHT_WEB_PORT', 5174)
const apiOrigin = `http://127.0.0.1:${apiPort}`
const webOrigin = `http://127.0.0.1:${webPort}`

export default defineConfig({
  testDir: './e2e',
  testIgnore: 'public-entry-performance.spec.ts',
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL: webOrigin,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `NODE_ENV=test PORT=${apiPort} DATABASE_URL= CHAT_MOCK_STREAM_DELAY_MS=150 CHAT_MESSAGE_ENCRYPTION_KEY=CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg= npm --prefix server run start:e2e`,
      url: `${apiOrigin}/health`,
      reuseExistingServer,
      timeout: 30_000,
    },
    {
      command: `VITE_ALLOW_MOCK_PROVIDER=true VITE_API_PROXY_TARGET=${apiOrigin} npm run dev -- --host 127.0.0.1 --port ${webPort}`,
      url: webOrigin,
      reuseExistingServer,
      timeout: 30_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
