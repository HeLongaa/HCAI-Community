import { json, ok } from '../../common/http/responses.js'

const service = 'hcai-community-server'
const defaultReadinessTimeoutMs = 2_000

const releaseArtifactIdentity = () => {
  const releaseArtifactSha256 = /^[a-f0-9]{64}$/i.test(process.env.RELEASE_ARTIFACT_SHA256 ?? '')
    ? process.env.RELEASE_ARTIFACT_SHA256.toLowerCase()
    : null
  return releaseArtifactSha256 ? { releaseArtifactSha256 } : {}
}

const applyProbeHeaders = (response, releaseArtifactSha256) => {
  response.setHeader('cache-control', 'no-store')
  if (releaseArtifactSha256) response.setHeader('x-release-artifact-sha256', releaseArtifactSha256)
}

const runBoundedCheck = async (check, timeoutMs) => {
  let timeout
  try {
    const result = await Promise.race([
      Promise.resolve().then(check),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('readiness check timed out')), timeoutMs)
      }),
    ])
    return result === false ? 'failed' : 'ok'
  } catch {
    return 'failed'
  } finally {
    clearTimeout(timeout)
  }
}

export const registerHealthRoutes = (router, options = {}) => {
  const readinessChecks = options.readinessChecks ?? {}
  const readinessTimeoutMs = Number.isInteger(options.readinessTimeoutMs) && options.readinessTimeoutMs > 0
    ? options.readinessTimeoutMs
    : defaultReadinessTimeoutMs

  router.add('GET', '/health', async (_request, response) => {
    const artifact = releaseArtifactIdentity()
    applyProbeHeaders(response, artifact.releaseArtifactSha256)
    ok(response, {
      status: 'ok',
      service,
      timestamp: new Date().toISOString(),
      ...artifact,
    })
  })

  router.add('GET', '/ready', async (_request, response) => {
    const artifact = releaseArtifactIdentity()
    applyProbeHeaders(response, artifact.releaseArtifactSha256)
    const entries = await Promise.all(Object.entries(readinessChecks).map(async ([name, check]) => [
      name,
      typeof check === 'function' ? await runBoundedCheck(check, readinessTimeoutMs) : 'failed',
    ]))
    const checks = Object.fromEntries(entries)
    const ready = entries.length > 0 && entries.every(([, status]) => status === 'ok')
    const payload = {
      data: {
        status: ready ? 'ready' : 'not_ready',
        service,
        timestamp: new Date().toISOString(),
        checks,
        ...artifact,
      },
    }
    json(response, ready ? 200 : 503, payload)
  })
}
