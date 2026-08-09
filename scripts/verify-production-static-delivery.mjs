import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import { createProductionStaticServer } from './lib/production-static-server.mjs'

const root = process.cwd()
const contract = JSON.parse(fs.readFileSync(path.join(root, 'config/production-static-delivery-contract.json'), 'utf8'))
const dist = path.join(root, contract.rootDirectory)
const assets = path.join(dist, 'assets')
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Production build is missing')

const assetFiles = fs.readdirSync(assets)
const exactlyOne = (pattern, label) => {
  const matches = assetFiles.filter((file) => pattern.test(file))
  if (matches.length !== 1) throw new Error(`${label} expected one asset, found ${matches.length}`)
  return `/assets/${matches[0]}`
}
const scriptPath = exactlyOne(/^index-[\w-]+\.js$/, 'Entry script')
const stylePath = exactlyOne(/^index-[\w-]+\.css$/, 'Entry stylesheet')
const modelPath = exactlyOne(/^1111-mobile\.pcloud-[\w-]+\.bin$/, 'Mobile point cloud')
const staticImagePath = exactlyOne(/^landing-particles-static-[\w-]+\.webp$/, 'Static particle image')

const server = createProductionStaticServer({ rootDirectory: dist, contract })
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const port = typeof address === 'object' && address ? address.port : 0

const request = (pathname, { headers = {}, method = 'GET' } = {}) => new Promise((resolve, reject) => {
  const outbound = http.request({ host: '127.0.0.1', port, path: pathname, method, headers }, (response) => {
    const chunks = []
    response.on('data', (chunk) => chunks.push(chunk))
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }))
  })
  outbound.on('error', reject)
  outbound.end()
})

const checks = []
const check = (id, pass, detail = '') => checks.push({ id, pass: Boolean(pass), detail })
try {
  const health = await request('/healthz')
  check('health', health.status === 200 && health.headers['cache-control'] === contract.healthCacheControl)

  const html = await request('/')
  check('html_revalidation', html.status === 200 && html.headers['content-type']?.startsWith('text/html') && html.headers['cache-control'] === contract.htmlCacheControl)
  check('security_headers', Object.entries(contract.securityHeaders).every(([name, value]) => html.headers[name] === value))

  const script = await request(scriptPath, { headers: { 'accept-encoding': 'br, gzip' } })
  check('hashed_asset_immutable', script.status === 200 && script.headers['cache-control'] === contract.assetCacheControl)
  check('brotli_javascript', script.headers['content-encoding'] === 'br' && script.headers.vary === 'Accept-Encoding' && script.headers['content-type']?.startsWith('text/javascript'))

  const style = await request(stylePath, { headers: { 'accept-encoding': 'gzip' } })
  check('gzip_stylesheet', style.status === 200 && style.headers['content-encoding'] === 'gzip' && style.headers['content-type']?.startsWith('text/css'))

  const model = await request(modelPath, { headers: { 'accept-encoding': 'identity' } })
  check('point_cloud_mime', model.status === 200 && model.headers['content-type'] === 'application/octet-stream' && model.headers['cache-control'] === contract.assetCacheControl)
  const modelRange = await request(modelPath, { headers: { range: 'bytes=0-99', 'accept-encoding': 'br' } })
  check('point_cloud_range', modelRange.status === 206 && modelRange.body.byteLength === 100 && modelRange.headers['content-range'] === 'bytes 0-99/216000' && !modelRange.headers['content-encoding'])

  const image = await request(staticImagePath)
  check('webp_mime', image.status === 200 && image.headers['content-type'] === 'image/webp' && image.headers['cache-control'] === contract.assetCacheControl)

  const spa = await request('/auth/deep-link')
  check('spa_fallback', spa.status === 200 && spa.headers['content-type']?.startsWith('text/html') && spa.headers['cache-control'] === contract.htmlCacheControl)
  const backendRoutes = await Promise.all(['/api/me', '/health', '/ready'].map((pathname) => request(pathname)))
  check('backend_route_not_spa', backendRoutes.every((response) => response.status === 404 && response.headers['content-type']?.startsWith('application/json') && response.headers['cache-control'] === contract.healthCacheControl))
  const missing = await request('/assets/missing.js')
  check('asset_not_found', missing.status === 404)
  const traversal = await request('/%2e%2e/package.json')
  check('path_traversal_rejected', traversal.status === 400)
} finally {
  await new Promise((resolve) => server.close(resolve))
}

const missingChecks = contract.requiredChecks.filter((id) => !checks.some((check) => check.id === id))
const failures = checks.filter((check) => !check.pass)
if (missingChecks.length || failures.length) {
  console.error(`Production static delivery failed:\n${[
    ...missingChecks.map((id) => `- missing check: ${id}`),
    ...failures.map((check) => `- ${check.id}${check.detail ? `: ${check.detail}` : ''}`),
  ].join('\n')}`)
  process.exit(1)
}
console.log(`Production static delivery passed (${checks.length} checks)`)
