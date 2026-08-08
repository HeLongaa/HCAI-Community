import { repositories } from '../repositories/index.js'
import {
  provisionMiniMaxVideoStaging,
  summarizeMiniMaxVideoStagingProvisioning,
} from './minimaxVideoStagingProvisioning.js'

const credential = String(process.env.CREATIVE_ROUTER_MINIMAX_VIDEO_API_KEY ?? '').trim()
if (!credential) throw new Error('CREATIVE_ROUTER_MINIMAX_VIDEO_API_KEY is required')

const actor = {
  id: String(process.env.MINIMAX_STAGING_APPROVER_ID ?? 'staging-bootstrap'),
  handle: String(process.env.MINIMAX_STAGING_APPROVER_HANDLE ?? 'helong'),
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
  process.stdout.write(`${JSON.stringify(summarizeMiniMaxVideoStagingProvisioning(result), null, 2)}\n`)
} finally {
  await repositories.client?.$disconnect?.()
}
