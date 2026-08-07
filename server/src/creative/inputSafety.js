import { createHash } from 'node:crypto'

import { classifyWithExternalSafetyService } from './externalSafetyClassifier.js'

const decisions = new Set(['allow', 'review', 'block'])
const codePattern = /^[a-z0-9][a-z0-9._:-]{1,95}$/i
const hash = (value) => createHash('sha256').update(value).digest('hex')
const safeCodes = (value) => Array.isArray(value) ? value.map(String).filter((item) => codePattern.test(item)).slice(0, 20) : []
const unavailable = (category) => ({ decision: 'review', classifierId: 'unavailable', classifierVersion: 'none', categories: [category] })

const externalClassifier = ({ generation, asset, body, contentType, source, fetchImpl }) => classifyWithExternalSafetyService({
  endpointValue: source.CREATIVE_INPUT_SAFETY_CLASSIFIER_URL,
  tokenValue: source.CREATIVE_INPUT_SAFETY_CLASSIFIER_TOKEN,
  body,
  contentType,
  fetchImpl,
  headers: {
    'x-creative-generation-id': String(generation.id).slice(0, 128),
    'x-creative-input-id': String(asset.id).slice(0, 128),
    'x-creative-workspace': String(generation.workspace).slice(0, 32),
  },
})

const classifyAsset = async ({ generation, asset, body, contentType, source, classifier, fetchImpl, now }) => {
  let raw
  if (generation.provider?.id === 'mock') {
    raw = { decision: 'allow', classifierId: 'local-fixture', classifierVersion: '1', categories: [] }
  } else if (!Buffer.isBuffer(body) || body.length === 0 || body.length !== Number(asset.sizeBytes)) {
    raw = unavailable('input_bytes_unavailable')
  } else if (classifier) {
    try { raw = await classifier({ generation, asset, body, contentType, now }) } catch { raw = unavailable('classifier_failed') }
  } else if (String(source.CREATIVE_INPUT_SAFETY_CLASSIFIER_MODE ?? '').toLowerCase() === 'external') {
    raw = await externalClassifier({ generation, asset, body, contentType, source, fetchImpl })
  } else if (source.NODE_ENV !== 'production') {
    raw = { decision: 'allow', classifierId: 'local-fixture', classifierVersion: '1', categories: [] }
  } else {
    raw = unavailable('classifier_unavailable')
  }
  const decision = decisions.has(String(raw?.decision)) ? String(raw.decision) : 'review'
  const classifierId = codePattern.test(String(raw?.classifierId ?? '')) ? String(raw.classifierId) : 'invalid'
  const classifierVersion = codePattern.test(String(raw?.classifierVersion ?? '')) ? String(raw.classifierVersion) : 'unknown'
  const categories = safeCodes(raw?.categories)
  return Object.freeze({
    schemaVersion: 1,
    assetId: String(asset.id),
    decision,
    classified: classifierId !== 'unavailable' && classifierId !== 'invalid',
    classifierId,
    classifierVersion,
    categories,
    evidenceHash: hash(JSON.stringify({ generationId: generation.id, assetId: asset.id, decision, classifierId, classifierVersion, categories })),
    classifiedAt: now.toISOString(),
  })
}

export const classifyCreativeInputs = async ({
  generation,
  assets = [],
  inputAssetReader = null,
  source = process.env,
  classifier = null,
  fetchImpl = globalThis.fetch,
  now = new Date(),
}) => {
  if (assets.length === 0) {
    return Object.freeze({ schemaVersion: 1, decision: 'allow', classified: true, inputCount: 0, evidenceHashes: [], items: [], cachedInputs: new Map() })
  }
  const cachedInputs = new Map()
  const items = []
  for (const asset of assets) {
    let input = null
    try { input = typeof inputAssetReader === 'function' ? await inputAssetReader(asset) : null } catch { input = null }
    const body = input?.body
    if (Buffer.isBuffer(body)) cachedInputs.set(String(asset.id), input)
    items.push(await classifyAsset({
      generation,
      asset,
      body,
      contentType: String(input?.contentType ?? asset.contentType ?? 'application/octet-stream'),
      source,
      classifier,
      fetchImpl,
      now,
    }))
  }
  const decision = items.some((item) => item.decision === 'block')
    ? 'block'
    : items.some((item) => item.decision !== 'allow') ? 'review' : 'allow'
  return Object.freeze({
    schemaVersion: 1,
    decision,
    classified: items.every((item) => item.classified),
    inputCount: items.length,
    evidenceHashes: items.map((item) => item.evidenceHash),
    items,
    cachedInputs,
  })
}

export const creativeInputSafetyPolicyProjection = (result) => Object.freeze({
  schemaVersion: result.schemaVersion,
  decision: result.decision,
  classified: result.classified,
  inputCount: result.inputCount,
  evidenceHashes: result.evidenceHashes,
  categories: [...new Set(result.items.flatMap((item) => item.categories))].slice(0, 20),
})
