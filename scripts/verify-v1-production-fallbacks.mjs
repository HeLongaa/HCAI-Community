import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))

export function verifyFallbackDisposition({ inventory, matrix, evidenceExists, requireDispositionComplete = false, legacyRequireReady = false }) {
  const allowed = new Set(matrix.policy?.allowedTargets ?? [])
  const blockers = inventory.surfaces.filter((surface) => surface.classification === 'release_blocker')
  const fallbackDispositionComplete = inventory.productionPolicy.fallbackDispositionComplete === true
  const byId = new Map(matrix.dispositions.map((item) => [item.id, item]))
  const failures = []

  if (matrix.schemaVersion !== 1 || matrix.task !== 'V1-39') failures.push('unsupported disposition matrix metadata')
  if (matrix.policy.scope !== 'runtime_surface_fallback_disposition_only') failures.push('disposition matrix scope must remain fallback-only')
  if (inventory.productionPolicy.scope !== matrix.policy.scope) failures.push('runtime inventory and disposition matrix scopes must match')
  if (inventory.productionPolicy.globalProductionApproval !== 'governed_by_release_scope_and_domain_gates') failures.push('global production approval source is missing')
  if ('productionReady' in inventory.productionPolicy) failures.push('ambiguous productionReady field is forbidden; use fallbackDispositionComplete')
  if ('productionReadyRequiresZeroReleaseBlockers' in matrix.policy) failures.push('ambiguous productionReady policy is forbidden')
  for (const blocker of blockers) {
    const disposition = byId.get(blocker.id)
    if (!disposition) { failures.push(`missing disposition: ${blocker.id}`); continue }
    if (!allowed.has(disposition.targetClassification)) failures.push(`invalid target classification: ${blocker.id}`)
    if (!disposition.strategy || !Array.isArray(disposition.evidence) || disposition.evidence.length === 0) failures.push(`missing strategy/evidence: ${blocker.id}`)
    for (const evidence of disposition.evidence ?? []) if (!evidenceExists(evidence)) failures.push(`missing evidence file for ${blocker.id}: ${evidence}`)
  }
  for (const item of matrix.dispositions) {
    const surface = inventory.surfaces.find((candidate) => candidate.id === item.id)
    if (!surface) failures.push(`unknown disposition id: ${item.id}`)
    else if (fallbackDispositionComplete && surface.classification !== item.targetClassification) failures.push(`classification evidence mismatch: ${item.id} is ${surface.classification}, expected ${item.targetClassification}`)
    if (!allowed.has(item.targetClassification) || !item.strategy || !Array.isArray(item.evidence) || item.evidence.length === 0) failures.push(`invalid resolved disposition: ${item.id}`)
    for (const evidence of item.evidence ?? []) if (!evidenceExists(evidence)) failures.push(`missing evidence file for ${item.id}: ${evidence}`)
  }
  if (fallbackDispositionComplete && blockers.length > 0) failures.push(`fallbackDispositionComplete cannot be true with ${blockers.length} release blocker(s)`)
  if (legacyRequireReady) failures.push('--require-ready is ambiguous and unsupported; use --require-dispositions-complete')
  if (requireDispositionComplete && (!fallbackDispositionComplete || blockers.length > 0)) failures.push(`fallback disposition gate requires completion and zero blockers; found ${blockers.length}`)
  return { blockers, failures, fallbackDispositionComplete }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inventory = readJson('config/v1-runtime-surfaces.json')
  const matrix = readJson('config/v1-production-fallback-dispositions.json')
  const result = verifyFallbackDisposition({
    inventory,
    matrix,
    evidenceExists: (evidence) => fs.existsSync(path.join(root, evidence)),
    requireDispositionComplete: process.argv.includes('--require-dispositions-complete'),
    legacyRequireReady: process.argv.includes('--require-ready'),
  })
  if (result.failures.length > 0) { for (const failure of result.failures) console.error(`FAIL ${failure}`); process.exit(1) }
  console.log(`V1-39 fallback disposition matrix verified: ${matrix.dispositions.length} entries; ${result.blockers.length} blocker(s) remain; fallbackDispositionComplete=${result.fallbackDispositionComplete}; global production approval is evaluated by release and domain gates`)
}
