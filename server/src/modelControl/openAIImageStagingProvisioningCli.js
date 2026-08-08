import { repositories } from '../repositories/index.js'
import { provisionOpenAIImageStaging } from './openAIImageStagingProvisioning.js'

const credential = String(process.env.CREATIVE_OPENAI_IMAGE_API_TOKEN ?? '').trim()
if (!credential) throw new Error('CREATIVE_OPENAI_IMAGE_API_TOKEN is required')

const actor = {
  id: String(process.env.OPENAI_IMAGE_STAGING_APPROVER_ID ?? 'staging-bootstrap'),
  handle: String(process.env.OPENAI_IMAGE_STAGING_APPROVER_HANDLE ?? 'helong'),
  role: 'admin',
}

try {
  const result = await provisionOpenAIImageStaging({
    repositories,
    actor,
    credential,
    secretExternalVersion: String(process.env.OPENAI_IMAGE_STAGING_SECRET_VERSION ?? `temporary-${Date.now()}`),
    secretExpiresAt: process.env.OPENAI_IMAGE_STAGING_SECRET_EXPIRES_AT || null,
  })
  const summary = Object.fromEntries(Object.entries(result).map(([name, resource]) => {
    if (Array.isArray(resource)) return [name, resource.map((item) => ({ id: item.id, key: item.versionKey ?? null, status: item.status }))]
    if (resource?.controls && resource?.capEvidence && resource?.circuit) return [name, {
      controlIds: resource.controls.map((item) => item.id),
      capEvidenceId: resource.capEvidence.id,
      circuitId: resource.circuit.id,
      circuitStatus: resource.circuit.status,
    }]
    return [name, resource ? { id: resource.id, key: resource.key ?? resource.versionKey ?? null, status: resource.status ?? 'configured' } : null]
  }))
  process.stdout.write(`${JSON.stringify({ decision: 'configured', resources: summary }, null, 2)}\n`)
} finally {
  await repositories.client?.$disconnect?.()
}
