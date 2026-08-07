import { ok } from '../../common/http/responses.js'

export const registerHealthRoutes = (router) => {
  router.add('GET', '/health', async (_request, response) => {
    const releaseArtifactSha256 = /^[a-f0-9]{64}$/i.test(process.env.RELEASE_ARTIFACT_SHA256 ?? '')
      ? process.env.RELEASE_ARTIFACT_SHA256.toLowerCase()
      : null
    if (releaseArtifactSha256) response.setHeader('x-release-artifact-sha256', releaseArtifactSha256)
    ok(response, {
      status: 'ok',
      service: 'hcai-community-server',
      timestamp: new Date().toISOString(),
      ...(releaseArtifactSha256 ? { releaseArtifactSha256 } : {}),
    })
  })
}
