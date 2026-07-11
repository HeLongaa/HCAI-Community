import { buildCreativeProviderConfig } from '../config/env.js'
import { createCreativeProviderStatusClient } from './providerHttpClient.js'

export const createProviderPollingStatusClients = ({
  source = process.env,
  fetchImpl = globalThis.fetch,
} = {}) => {
  const config = buildCreativeProviderConfig(source)
  if (!config.polling.enabled || !config.polling.workerEnabled) {
    return Object.freeze({})
  }

  return Object.freeze({
    replicate: createCreativeProviderStatusClient({
      providerId: 'replicate-staging',
      source,
      fetchImpl,
    }),
  })
}
