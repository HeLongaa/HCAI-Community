import { createHash } from 'node:crypto'

const dayMs = 86_400_000
const maximumPaths = 128
const maximumDepth = 8

export const configurationRetentionContract = Object.freeze({
  policyId: 'configuration_superseded_plus_365d',
  retentionDays: 365,
  summarySchemaVersion: 1,
  terminalChangeStatuses: Object.freeze(['published', 'rejected']),
  defaultSweepLimit: 100,
  maximumSweepLimit: 500,
})

export const configurationRetentionCutoff = (now = new Date()) =>
  new Date(now.getTime() - configurationRetentionContract.retentionDays * dayMs)

export const configurationRetentionSweepLimit = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed < 1) return configurationRetentionContract.defaultSweepLimit
  return Math.min(parsed, configurationRetentionContract.maximumSweepLimit)
}

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

const digest = (value) => createHash('sha256').update(String(value)).digest('hex')
const valueType = (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : typeof value

const flatten = (value) => {
  const paths = new Map()
  let truncated = false
  const visit = (item, path, depth) => {
    if (paths.size >= maximumPaths || depth > maximumDepth) {
      truncated = true
      return
    }
    const type = valueType(item)
    paths.set(digest(path), { type, valueDigest: digest(canonicalJson(item)) })
    if (type === 'array') item.forEach((child, index) => visit(child, `${path}/${index}`, depth + 1))
    else if (type === 'object') Object.keys(item).sort().forEach((key) => visit(item[key], `${path}/${key}`, depth + 1))
  }
  visit(value, '$', 0)
  return { paths, truncated }
}

export const buildConfigurationRetentionSummary = ({ value, previousValue = undefined, contentHash = null }) => {
  const current = flatten(value)
  const previous = previousValue === undefined || previousValue === null ? null : flatten(previousValue)
  const operations = { added: 0, removed: 0, changed: 0, unchanged: 0 }
  if (previous) {
    for (const [pathHash, item] of current.paths) {
      const prior = previous.paths.get(pathHash)
      if (!prior) operations.added += 1
      else if (prior.type !== item.type || prior.valueDigest !== item.valueDigest) operations.changed += 1
      else operations.unchanged += 1
    }
    for (const pathHash of previous.paths.keys()) if (!current.paths.has(pathHash)) operations.removed += 1
  }
  const typeCounts = {}
  for (const item of current.paths.values()) typeCounts[item.type] = (typeCounts[item.type] ?? 0) + 1
  return {
    schemaVersion: configurationRetentionContract.summarySchemaVersion,
    valueDigest: contentHash && /^[a-f0-9]{64}$/i.test(contentHash) ? contentHash.toLowerCase() : digest(canonicalJson(value)),
    previousValueDigest: previousValue === undefined || previousValue === null ? null : digest(canonicalJson(previousValue)),
    pathHashes: [...current.paths.entries()].map(([pathHash, item]) => ({ pathHash, type: item.type })),
    typeCounts,
    operations,
    truncated: current.truncated || Boolean(previous?.truncated),
  }
}

export const isConfigurationRetentionSummary = (value) => Boolean(
  value && value.schemaVersion === 1 && /^[a-f0-9]{64}$/.test(value.valueDigest) &&
  Array.isArray(value.pathHashes) && value.pathHashes.length <= maximumPaths &&
  value.pathHashes.every((item) => /^[a-f0-9]{64}$/.test(item.pathHash) && ['null', 'array', 'object', 'string', 'number', 'boolean', 'undefined', 'bigint'].includes(item.type)),
)
