import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const root = process.cwd()
const dist = path.join(root, 'dist')
const assets = path.join(dist, 'assets')
const budgetPath = path.join(root, 'config/production-asset-budgets.json')

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  throw new Error('Production assets are missing. Run npm run build before checking budgets.')
}

const budgets = JSON.parse(fs.readFileSync(budgetPath, 'utf8'))
if (budgets.schemaVersion !== 1) throw new Error(`Unsupported asset budget schema: ${budgets.schemaVersion}`)

const files = fs.readdirSync(assets)
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const assetName = (url) => path.basename(url)
const sizes = (file) => {
  const content = fs.readFileSync(path.join(assets, file))
  return { raw: content.byteLength, gzip: gzipSync(content).byteLength }
}
const format = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`
const failures = []
const results = []

const resolveHashedAsset = (sourceFile) => {
  const extension = path.extname(sourceFile)
  const stem = path.basename(sourceFile, extension)
  const matches = files.filter((file) => file.startsWith(`${stem}-`) && file.endsWith(extension))
  if (matches.length !== 1) {
    failures.push(`${sourceFile} expected one hashed production asset, found ${matches.length}`)
    return null
  }
  return matches[0]
}

function check(label, actual, maximum) {
  results.push(`${label}: ${format(actual)} / ${format(maximum)}`)
  if (actual > maximum) failures.push(`${label} is ${format(actual)}, above ${format(maximum)}`)
}

const entryStyleUrl = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/)?.[1]
if (!entryStyleUrl) failures.push('index.html has no entry stylesheet')
else {
  const entry = sizes(assetName(entryStyleUrl))
  check('entry CSS raw', entry.raw, budgets.entryStyle.maximumRawBytes)
  check('entry CSS gzip', entry.gzip, budgets.entryStyle.maximumGzipBytes)
}

const initialScriptUrls = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+\.js)"/g)].map((match) => match[1])
const initialScripts = initialScriptUrls.map(assetName).map(sizes).reduce((total, size) => ({
  raw: total.raw + size.raw,
  gzip: total.gzip + size.gzip,
}), { raw: 0, gzip: 0 })
check('initial JS raw', initialScripts.raw, budgets.initialScripts.maximumRawBytes)
check('initial JS gzip', initialScripts.gzip, budgets.initialScripts.maximumGzipBytes)

const styleSizes = files.filter((file) => file.endsWith('.css')).map(sizes)
const allStyles = styleSizes.reduce((total, size) => ({ raw: total.raw + size.raw, gzip: total.gzip + size.gzip }), { raw: 0, gzip: 0 })
check('all CSS raw', allStyles.raw, budgets.allStyles.maximumRawBytes)
check('all CSS gzip', allStyles.gzip, budgets.allStyles.maximumGzipBytes)

const initialScriptNames = new Set(initialScriptUrls.map(assetName))
const lazyScripts = files.filter((file) => file.endsWith('.js') && !initialScriptNames.has(file)).map((file) => ({ file, ...sizes(file) }))
const largestLazy = lazyScripts.sort((a, b) => b.raw - a.raw)[0]
if (!largestLazy) failures.push('No lazy JavaScript chunks were found')
else {
  check(`largest lazy JS raw (${largestLazy.file})`, largestLazy.raw, budgets.largestLazyScript.maximumRawBytes)
  check(`largest lazy JS gzip (${largestLazy.file})`, largestLazy.gzip, budgets.largestLazyScript.maximumGzipBytes)
}

const particleModelFiles = [
  ...budgets.particleModels.requiredDesktopFiles,
  ...budgets.particleModels.requiredMobileFiles,
]
let particleModelTotal = 0
for (const file of particleModelFiles) {
  const productionFile = resolveHashedAsset(file)
  if (!productionFile) continue
  const size = fs.statSync(path.join(assets, productionFile)).size
  const maximum = file.includes('-mobile.')
    ? budgets.particleModels.mobileMaximumBytesEach
    : budgets.particleModels.desktopMaximumBytesEach
  particleModelTotal += size
  check(`particle model ${file} raw`, size, maximum)
}
check('particle models total raw', particleModelTotal, budgets.particleModels.maximumTotalBytes)

const particleStaticImage = resolveHashedAsset(path.basename(budgets.particleStaticImage.file))
if (particleStaticImage) check('particle static image raw', fs.statSync(path.join(assets, particleStaticImage)).size, budgets.particleStaticImage.maximumBytes)

for (const prefix of budgets.adminStyleChunks.requiredPrefixes) {
  const matches = files.filter((file) => file.startsWith(prefix) && file.endsWith('.css'))
  if (matches.length !== 1) {
    failures.push(`${prefix} expected one standalone CSS chunk, found ${matches.length}`)
    continue
  }
  check(`${prefix} CSS raw`, sizes(matches[0]).raw, budgets.adminStyleChunks.maximumRawBytesEach)
}

if (failures.length) {
  console.error(`Production asset budget failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log(`Production asset budget passed (${results.length} checks)\n${results.join('\n')}`)
