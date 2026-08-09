import https from 'node:https'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { createVaultSecretLifecycleHandler } from './vaultSecretLifecycleGateway.js'

const parsePort = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error('SECRET_LIFECYCLE_GATEWAY_PORT is invalid')
  return parsed
}

export const startSecretLifecycleGatewayServer = ({ source = process.env, logger = console } = {}) => {
  const certFile = String(source.SECRET_LIFECYCLE_GATEWAY_TLS_CERT_FILE ?? '').trim()
  const keyFile = String(source.SECRET_LIFECYCLE_GATEWAY_TLS_KEY_FILE ?? '').trim()
  if (!certFile || !keyFile) throw new Error('Secret lifecycle gateway TLS certificate and key files are required')
  const handler = createVaultSecretLifecycleHandler({ source, logger })
  const server = https.createServer({ cert: readFileSync(certFile), key: readFileSync(keyFile), minVersion: 'TLSv1.2' }, handler)
  server.requestTimeout = 10_000
  server.headersTimeout = 5_000
  server.keepAliveTimeout = 5_000
  server.maxHeadersCount = 32
  const host = String(source.SECRET_LIFECYCLE_GATEWAY_HOST ?? '0.0.0.0').trim()
  const port = parsePort(source.SECRET_LIFECYCLE_GATEWAY_PORT ?? '8790')
  server.listen(port, host, () => logger.info?.('[secret-lifecycle]', { event: 'listening', host, port }))
  const shutdown = () => {
    const forcedExit = setTimeout(() => process.exit(1), 10_000).unref()
    server.close((error) => {
      clearTimeout(forcedExit)
      process.exit(error ? 1 : 0)
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startSecretLifecycleGatewayServer()
