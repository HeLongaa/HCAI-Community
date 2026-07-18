import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import test from 'node:test'

const script = new URL('./check-oauth-provider-readiness.mjs', import.meta.url)

const runPreflight = (args, env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script.pathname, ...args], {
    env: {
      PATH: process.env.PATH,
      OAUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
      OAUTH_GITHUB_CLIENT_SECRET: 'github-secret',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.on('error', reject)
  child.on('close', (code) => resolve({ code, stdout, stderr }))
})

const withProviderStatusServer = async (callbackFor, execute) => {
  let origin = ''
  const server = createServer((request, response) => {
    if (request.url !== '/api/auth/oauth/providers') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      data: ['google', 'github'].map((provider) => ({
        provider,
        mode: 'external',
        available: true,
        callbackUrl: callbackFor(provider, origin),
      })),
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  origin = `http://127.0.0.1:${address.port}`
  try {
    await execute(origin)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

test('preflight accepts Admin-managed client ids and exact callbacks', async () => {
  await withProviderStatusServer(
    (provider, origin) => `${origin}/api/auth/oauth/${provider}/callback`,
    async (origin) => {
      const result = await runPreflight(['--allow-local', `--api-origin=${origin}`])
      assert.equal(result.code, 0, result.stderr)
      assert.match(result.stdout, /client_id=admin\/runtime/)
      assert.match(result.stdout, /callback=exact/)
    },
  )
})

test('preflight rejects a runtime callback registered for another origin', async () => {
  await withProviderStatusServer(
    (provider) => `https://wrong.example.com/api/auth/oauth/${provider}/callback`,
    async (origin) => {
      const result = await runPreflight(['--allow-local', `--api-origin=${origin}`])
      assert.equal(result.code, 1)
      assert.match(result.stderr, /effective callback must equal/)
    },
  )
})
