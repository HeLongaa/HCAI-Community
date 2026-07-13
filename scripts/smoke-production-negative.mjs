import process from 'node:process'
import {
  assertProductionPersistence,
  shouldAutoSeedPrisma,
  shouldLoadDemoRepository,
} from '../server/src/repositories/runtimePolicy.js'
import { buildEnv } from '../server/src/config/env.js'
import { buildOpenAIChatRuntimeConfig } from '../server/src/chat/openaiChatProvider.js'

const failures = []
try {
  assertProductionPersistence({ NODE_ENV: 'production', DATABASE_URL: '' })
  failures.push('missing DATABASE_URL did not fail closed')
} catch (error) {
  if (!String(error.message).includes('PRODUCTION_DATABASE_REQUIRED')) failures.push(`unexpected persistence error: ${error.message}`)
}
if (shouldLoadDemoRepository({ NODE_ENV: 'production' })) failures.push('production loads Seed repository')
if (shouldAutoSeedPrisma({ NODE_ENV: 'production', DEMO_DATABASE_AUTOSEED: 'true' })) failures.push('production enables demo autoseed')

const base = { NODE_ENV: 'production', ACCESS_TOKEN_SECRET: '0123456789abcdef0123456789abcdef' }
for (const [label, run] of [
  ['creative mock', () => buildEnv({ ...base, CREATIVE_PROVIDER_MODE: 'mock' })],
  ['chat mock', () => buildOpenAIChatRuntimeConfig({ NODE_ENV: 'production', CHAT_PROVIDER_MODE: 'mock' })],
]) {
  try { run(); failures.push(`${label} was accepted in production`) } catch { /* expected */ }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  process.exit(1)
}
console.log('V1-39 negative production smoke passed: DB/Seed/autoseed/mock Provider paths fail closed')
