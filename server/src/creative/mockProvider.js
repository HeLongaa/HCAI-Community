import { createHash } from 'node:crypto'

const outputMetadataByWorkspace = {
  image: {
    type: 'image',
    label: 'Mock image preview',
    contentType: 'image/png',
  },
  video: {
    type: 'video',
    label: 'Mock video preview',
    contentType: 'video/mp4',
  },
  music: {
    type: 'audio',
    label: 'Mock audio preview',
    contentType: 'audio/mpeg',
  },
  chat: {
    type: 'text',
    label: 'Mock chat draft',
    contentType: 'application/json',
  },
}

const digestForGeneration = (request, actor) =>
  createHash('sha256')
    .update(JSON.stringify({
      actorId: actor?.id ?? 'anonymous',
      workspace: request.workspace,
      mode: request.mode,
      prompt: request.prompt,
      inputAssetIds: request.inputAssetIds,
      parameters: request.parameters,
    }))
    .digest('hex')
    .slice(0, 16)

export const buildMockCreativeGenerationId = (request, actor) => `gen_mock_${digestForGeneration(request, actor)}`

export const executeMockCreativeGeneration = ({ request, provider, actor, now = new Date() }) => {
  const digest = digestForGeneration(request, actor)
  const outputMetadata = outputMetadataByWorkspace[request.workspace]
  const createdAt = now.toISOString()
  return {
    id: buildMockCreativeGenerationId(request, actor),
    workspace: request.workspace,
    mode: request.mode,
    status: 'completed',
    provider: {
      id: provider.id,
      mode: provider.mode,
      label: provider.label,
    },
    prompt: request.prompt,
    inputAssetIds: request.inputAssetIds,
    parameters: request.parameters,
    outputs: [
      {
        id: `out_mock_${digest}`,
        type: outputMetadata.type,
        label: outputMetadata.label,
        contentType: outputMetadata.contentType,
        url: `mock://creative/${request.workspace}/${digest}`,
        storage: {
          persisted: false,
          provider: 'mock',
        },
        source: {
          kind: 'mock_provider',
          persistedMediaAssetId: null,
        },
      },
    ],
    usage: {
      estimatedCredits: 0,
      providerCostCents: 0,
      metered: false,
    },
    safety: {
      moderationRequired: false,
      reviewRequired: false,
    },
    createdBy: {
      id: actor.id,
      handle: actor.handle,
    },
    createdAt,
  }
}
