import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
const inventory = readJson('config/v1-runtime-surfaces.json')
const matrix = readJson('config/v1-production-fallback-dispositions.json')
const allowed = new Set(matrix.policy.allowedTargets)
const blockers = inventory.surfaces.filter((surface) => surface.classification === 'release_blocker')
const productionReady = inventory.productionPolicy.productionReady === true
const byId = new Map(matrix.dispositions.map((item) => [item.id, item]))
const failures = []

if (matrix.schemaVersion !== 1 || matrix.task !== 'V1-39') failures.push('unsupported disposition matrix metadata')
for (const blocker of blockers) {
  const disposition = byId.get(blocker.id)
  if (!disposition) { failures.push(`missing disposition: ${blocker.id}`); continue }
  if (!allowed.has(disposition.targetClassification)) failures.push(`invalid target classification: ${blocker.id}`)
  if (!disposition.strategy || !Array.isArray(disposition.evidence) || disposition.evidence.length === 0) failures.push(`missing strategy/evidence: ${blocker.id}`)
  for (const evidence of disposition.evidence ?? []) if (!fs.existsSync(path.join(root, evidence))) failures.push(`missing evidence file for ${blocker.id}: ${evidence}`)
}
for (const item of matrix.dispositions) {
  const surface = inventory.surfaces.find((candidate) => candidate.id === item.id)
  if (!surface) failures.push(`unknown disposition id: ${item.id}`)
  else if (productionReady && surface.classification !== item.targetClassification) failures.push(`classification evidence mismatch: ${item.id} is ${surface.classification}, expected ${item.targetClassification}`)
  if (!allowed.has(item.targetClassification) || !item.strategy || !Array.isArray(item.evidence) || item.evidence.length === 0) failures.push(`invalid resolved disposition: ${item.id}`)
  for (const evidence of item.evidence ?? []) if (!fs.existsSync(path.join(root, evidence))) failures.push(`missing evidence file for ${item.id}: ${evidence}`)
}
if (productionReady && blockers.length > 0) failures.push(`productionReady cannot be true with ${blockers.length} release blocker(s)`)
if (process.argv.includes('--require-ready') && (!productionReady || blockers.length > 0)) failures.push(`release requires productionReady=true and zero blockers; found ${blockers.length}`)
if (failures.length > 0) { for (const failure of failures) console.error(`FAIL ${failure}`); process.exit(1) }
console.log(`V1-39 disposition matrix verified: ${matrix.dispositions.length} entries; ${blockers.length} blocker(s) remain; productionReady=${productionReady}`)
