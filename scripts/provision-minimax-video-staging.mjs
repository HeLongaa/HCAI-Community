import { repositories } from '../server/src/repositories/index.js'
import { provisionMiniMaxVideoStaging } from '../server/src/modelControl/minimaxVideoStagingProvisioning.js'

const withSecret = process.argv.includes('--with-secret')
const credential = withSecret ? String(process.env.CREATIVE_ROUTER_MINIMAX_VIDEO_API_KEY ?? '').trim() : null
if (withSecret && !credential) throw new Error('CREATIVE_ROUTER_MINIMAX_VIDEO_API_KEY is required with --with-secret')

const actor = {
  id: String(process.env.MINIMAX_STAGING_APPROVER_ID ?? 'profile-veyn'),
  handle: String(process.env.MINIMAX_STAGING_APPROVER_HANDLE ?? 'veyn'),
  role: 'admin',
}

try {
  const result = await provisionMiniMaxVideoStaging({
    repositories,
    actor,
    credential,
    secretExternalVersion: String(process.env.MINIMAX_STAGING_SECRET_VERSION ?? `temporary-${Date.now()}`),
    secretExpiresAt: process.env.MINIMAX_STAGING_SECRET_EXPIRES_AT || null,
  })
  const summary = Object.fromEntries(Object.entries(result).map(([name, resource]) => [name, resource ? {
    id: resource.id,
    key: resource.key ?? null,
    status: resource.status ?? 'configured',
  } : null]))
  process.stdout.write(`${JSON.stringify({ decision: result.secretRef || !withSecret ? 'configured' : 'no_go', resources: summary }, null, 2)}\n`)
} finally {
  await repositories.client?.$disconnect?.()
}
