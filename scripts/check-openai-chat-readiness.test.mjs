import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import test from 'node:test'
import { promisify } from 'node:util'

const run = promisify(execFile)
const script = new URL('./check-openai-chat-readiness.mjs', import.meta.url)

test('fixture preflight validates all staging gates without exposing its token', async () => {
  const { stdout, stderr } = await run(process.execPath, [script.pathname, '--profile=fixture', '--mode=preflight'])
  assert.equal(stderr, '')
  assert.match(stdout, /PASS credential is present/)
  assert.match(stdout, /"credentialConfigured": true/)
  assert.doesNotMatch(stdout, /openai-chat-readiness-fixture-token/)
})

test('environment preflight fails closed when the credential is absent', async () => {
  await assert.rejects(
    run(process.execPath, [script.pathname, '--profile=env', '--mode=preflight'], {
      env: {
        NODE_ENV: 'production',
        CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
        CHAT_PROVIDER_MODE: 'openai_staging',
        CHAT_OPENAI_HTTP_CLIENT_ENABLED: 'true',
        CHAT_OPENAI_NETWORK_CALLS_ENABLED: 'true',
        CHAT_OPENAI_SAFETY_CLASSIFIER_ENABLED: 'true',
        CHAT_OPENAI_CONFIRMATION: 'staging-only',
      },
    }),
    (error) => error.code === 1 && /CHAT_OPENAI_API_TOKEN is required/.test(error.stderr),
  )
})

test('live smoke cannot use fixture credentials', async () => {
  await assert.rejects(
    run(process.execPath, [script.pathname, '--profile=fixture', '--mode=live']),
    (error) => error.code === 1 && /live smoke requires --profile=env/.test(error.stderr),
  )
})

test('live smoke rejects incomplete approval before any Provider request', async () => {
  await assert.rejects(
    run(process.execPath, [script.pathname, '--profile=env', '--mode=live'], {
      env: {
        NODE_ENV: 'production',
        CREATIVE_PROVIDER_RUNTIME_ENV: 'staging',
        CHAT_PROVIDER_MODE: 'openai_staging',
        CHAT_OPENAI_HTTP_CLIENT_ENABLED: 'true',
        CHAT_OPENAI_NETWORK_CALLS_ENABLED: 'true',
        CHAT_OPENAI_SAFETY_CLASSIFIER_ENABLED: 'true',
        CHAT_OPENAI_CONFIRMATION: 'staging-only',
        CHAT_OPENAI_API_TOKEN: 'must-not-be-used',
      },
    }),
    (error) => error.code === 1 && /live smoke approval failed/.test(error.stderr),
  )
})
