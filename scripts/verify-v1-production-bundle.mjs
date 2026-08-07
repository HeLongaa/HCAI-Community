import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assets = path.join(root, 'dist', 'assets')
const indexHtmlPath = path.join(root, 'dist', 'index.html')
if (!fs.existsSync(assets)) {
  console.error('FAIL production bundle is missing; run npm run build first')
  process.exit(1)
}
const javascript = fs.readdirSync(assets)
  .filter((file) => file.endsWith('.js'))
  .map((file) => fs.readFileSync(path.join(assets, file), 'utf8'))
  .join('\n')
const forbidden = [
  'Summer Shoes',
  'The Blue Camaro',
  'demo-access.',
  'Showing local demo data',
  '当前显示本地演示数据',
  'Mock workspace',
  'Demo fallback',
]
const failures = forbidden.filter((marker) => javascript.includes(marker))
const assetFiles = fs.readdirSync(assets)
const taskChunks = assetFiles.filter((file) => /^tasks-[^.]+\.js$/.test(file))
if (taskChunks.length !== 1) failures.push(`expected one independently loadable Tasks chunk, found ${taskChunks.length}`)
const landingChunks = assetFiles.filter((file) => /^CommunityLandingPage-[^.]+\.js$/.test(file))
if (landingChunks.length !== 1) failures.push(`expected one public Landing core chunk, found ${landingChunks.length}`)
const particleChunks = assetFiles.filter((file) => /^ParticleMorphBackground-[^.]+\.js$/.test(file))
if (particleChunks.length !== 1) failures.push(`expected one independently loadable Landing particle enhancement chunk, found ${particleChunks.length}`)
const adminChunks = assetFiles.filter((file) => /^admin-[^.]+\.js$/.test(file))
if (adminChunks.length !== 1) failures.push(`expected one Admin core chunk, found ${adminChunks.length}`)
const modelControlChunks = assetFiles.filter((file) => /^ModelControlPanel-[^.]+\.js$/.test(file))
if (modelControlChunks.length !== 1) failures.push(`expected one independently loadable Model Control chunk, found ${modelControlChunks.length}`)
const maximumLandingCoreGzipBytes = 20 * 1024
const landingCoreGzipBytes = landingChunks.length === 1
  ? gzipSync(fs.readFileSync(path.join(assets, landingChunks[0]))).byteLength
  : 0
if (landingCoreGzipBytes > maximumLandingCoreGzipBytes) {
  failures.push(`Landing core gzip ${landingCoreGzipBytes} bytes exceeds ${maximumLandingCoreGzipBytes} byte gate`)
}
const maximumParticleGzipBytes = 150 * 1024
const particleGzipBytes = particleChunks.length === 1
  ? gzipSync(fs.readFileSync(path.join(assets, particleChunks[0]))).byteLength
  : 0
if (particleGzipBytes > maximumParticleGzipBytes) {
  failures.push(`Landing particle enhancement gzip ${particleGzipBytes} bytes exceeds ${maximumParticleGzipBytes} byte gate`)
}
const maximumAdminCoreGzipBytes = 60 * 1024
const adminCoreGzipBytes = adminChunks.length === 1
  ? gzipSync(fs.readFileSync(path.join(assets, adminChunks[0]))).byteLength
  : 0
if (adminCoreGzipBytes > maximumAdminCoreGzipBytes) {
  failures.push(`Admin core gzip ${adminCoreGzipBytes} bytes exceeds ${maximumAdminCoreGzipBytes} byte gate`)
}
const maximumModelControlGzipBytes = 25 * 1024
const modelControlGzipBytes = modelControlChunks.length === 1
  ? gzipSync(fs.readFileSync(path.join(assets, modelControlChunks[0]))).byteLength
  : 0
if (modelControlGzipBytes > maximumModelControlGzipBytes) {
  failures.push(`Model Control gzip ${modelControlGzipBytes} bytes exceeds ${maximumModelControlGzipBytes} byte gate`)
}

const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8')
const entryMatch = indexHtml.match(/<script[^>]+src="\/assets\/([^"]+\.js)"/)
if (!entryMatch) {
  failures.push('production entry script missing from index.html')
}
const maximumEntryGzipBytes = 125 * 1024
const entryGzipBytes = entryMatch
  ? gzipSync(fs.readFileSync(path.join(assets, entryMatch[1]))).byteLength
  : 0
if (entryGzipBytes > maximumEntryGzipBytes) {
  failures.push(`entry gzip ${entryGzipBytes} bytes exceeds ${maximumEntryGzipBytes} byte gate`)
}
const requiredUnavailableStates = [
  'Task API unavailable',
  'Community API unavailable',
]
for (const marker of requiredUnavailableStates) {
  if (!javascript.includes(marker)) failures.push(`explicit unavailable state missing: ${marker}`)
}
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL production bundle contains/omits marker: ${failure}`)
  process.exit(1)
}
console.log(`V1-39 production bundle verified: ${forbidden.length} demo markers absent; ${requiredUnavailableStates.length} explicit API unavailable states present; Tasks isolated; entry gzip ${(entryGzipBytes / 1024).toFixed(2)} KiB; Landing core gzip ${(landingCoreGzipBytes / 1024).toFixed(2)} KiB; particle enhancement gzip ${(particleGzipBytes / 1024).toFixed(2)} KiB; Admin core gzip ${(adminCoreGzipBytes / 1024).toFixed(2)} KiB; Model Control gzip ${(modelControlGzipBytes / 1024).toFixed(2)} KiB`)
