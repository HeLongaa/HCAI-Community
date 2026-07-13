import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assets = path.join(root, 'dist', 'assets')
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
if (!javascript.includes('Catalog unavailable') || !javascript.includes('Task marketplace unavailable')) failures.push('explicit unavailable production catalog markers missing')
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL production bundle contains/omits marker: ${failure}`)
  process.exit(1)
}
console.log(`V1-39 production bundle verified: ${forbidden.length} demo markers absent; explicit unavailable states present`)
