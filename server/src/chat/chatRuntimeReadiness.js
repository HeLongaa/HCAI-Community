import { resolveModelRuntimeReadiness } from '../modelControl/modelRuntimeResolver.js'

const directRuntimeModes = new Set(['mock', 'openai_staging', 'openai_production'])

const runtimeDescriptor = (runtime) => runtime?.generationProvider
  ? {
      id: runtime.generationProvider.id,
      label: runtime.generationProvider.label,
      kind: 'provider',
    }
  : runtime?.mode === 'mock'
    ? { id: 'mock-chat', label: 'Mock Chat Runtime', kind: 'demo' }
    : null

const routedRuntimeDescriptor = (readiness) => {
  const selected = readiness.attempts?.find((attempt) => attempt.selected) ?? null
  const id = readiness.checks?.model?.key ?? selected?.modelKey ?? readiness.checks?.deployment?.providerModelId ?? null
  const label = readiness.checks?.deployment?.providerModelId ?? readiness.checks?.model?.key ?? selected?.modelKey ?? null
  return id && label ? { id, label, kind: 'provider' } : { id: 'approved-chat-runtime', label: 'Approved Chat Runtime', kind: 'provider' }
}

export const readChatRuntimeReadiness = async ({
  repositories,
  source = process.env,
  runtime,
  actor,
  now = new Date(),
  readinessResolver = resolveModelRuntimeReadiness,
}) => {
  const checkedAt = now.toISOString()
  let readiness
  try {
    readiness = await readinessResolver({
      repositories,
      modality: 'chat',
      operation: 'generate',
      environment: String(source.CREATIVE_PROVIDER_RUNTIME_ENV ?? 'staging').trim().toLowerCase(),
      region: String(source.CREATIVE_PROVIDER_REGION ?? 'us').trim().toLowerCase() || null,
      subjectKey: actor?.id ?? actor?.handle ?? 'anonymous',
      role: actor?.role ?? 'member',
      baseSource: source,
      now,
    })
  } catch {
    return {
      availability: 'unavailable',
      reasonCode: 'runtime_status_unavailable',
      checkedAt,
      runtime: null,
    }
  }

  if (readiness.ready) {
    return {
      availability: 'available',
      reasonCode: null,
      checkedAt: readiness.checkedAt ?? checkedAt,
      runtime: routedRuntimeDescriptor(readiness),
    }
  }

  if (readiness.reasonCode === 'no_active_route_policy' && directRuntimeModes.has(runtime?.mode)) {
    return {
      availability: runtime.mode === 'mock' ? 'demo' : 'available',
      reasonCode: runtime.mode === 'mock' ? 'mock_runtime' : null,
      checkedAt: readiness.checkedAt ?? checkedAt,
      runtime: runtimeDescriptor(runtime),
    }
  }

  return {
    availability: 'unavailable',
    reasonCode: readiness.reasonCode === 'no_active_route_policy' && runtime?.mode === 'disabled'
      ? 'chat_provider_disabled'
      : 'no_approved_runtime',
    checkedAt: readiness.checkedAt ?? checkedAt,
    runtime: null,
  }
}
