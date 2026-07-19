import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import test from 'node:test'
import { promisify } from 'node:util'

const run = promisify(execFile)
const script = new URL('./check-openai-image-readiness.mjs', import.meta.url)

test('fixture preflight validates staging gates without exposing its token', async () => {
  const { stdout, stderr } = await run(process.execPath, [script.pathname, '--profile=fixture', '--mode=preflight'])
  assert.equal(stderr, '')
  assert.match(stdout, /PASS credential is present/)
  assert.match(stdout, /"credentialConfigured": true/)
  assert.doesNotMatch(stdout, /openai-image-readiness-fixture-token/)
})

test('environment preflight fails closed when the credential is absent', async () => {
  await assert.rejects(
    run(process.execPath, [script.pathname, '--profile=env', '--mode=preflight'], {
      env: {
        NODE_ENV: 'production',
        CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
        CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED: 'true',
        CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED: 'true',
        CREATIVE_OPENAI_IMAGE_CONFIRMATION: 'staging-only',
      },
    }),
    (error) => error.code === 1 && /FAIL credential is present/.test(error.stdout),
  )
})

test('acceptance cannot use fixture credentials', async () => {
  await assert.rejects(
    run(process.execPath, [script.pathname, '--profile=fixture', '--mode=acceptance']),
    (error) => error.code === 1 && /requires --profile=env/.test(error.stderr),
  )
})

test('acceptance rejects incomplete approval before any Provider request', async () => {
  await assert.rejects(
    run(process.execPath, [script.pathname, '--profile=env', '--mode=acceptance'], {
      env: {
        NODE_ENV: 'production',
        CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
        CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED: 'true',
        CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED: 'true',
        CREATIVE_OPENAI_IMAGE_CONFIRMATION: 'staging-only',
        CREATIVE_OPENAI_IMAGE_API_TOKEN: 'must-not-be-used',
      },
    }),
    (error) => error.code === 1 && /acceptance approval failed/.test(error.stderr),
  )
})
