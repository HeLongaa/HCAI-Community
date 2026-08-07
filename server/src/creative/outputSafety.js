import { createHash } from 'node:crypto'

import { classifyWithExternalSafetyService } from './externalSafetyClassifier.js'

const decisions = new Set(['allow', 'review', 'block'])
const codePattern = /^[a-z0-9][a-z0-9._:-]{1,95}$/i
const hash = (value) => createHash('sha256').update(value).digest('hex')
const safeCodes = (value) => Array.isArray(value) ? value.map(String).filter((item) => codePattern.test(item)).slice(0, 20) : []

const normalizeDecision = (value, fallback = 'review') => decisions.has(String(value)) ? String(value) : fallback

const externalClassifier = ({ generation, output, body, contentType, source, fetchImpl }) => classifyWithExternalSafetyService({
  endpointValue: source.CREATIVE_OUTPUT_SAFETY_CLASSIFIER_URL,
  tokenValue: source.CREATIVE_OUTPUT_SAFETY_CLASSIFIER_TOKEN,
  body,
  contentType,
  fetchImpl,
  headers: {
    'x-creative-generation-id': String(generation.id).slice(0, 128),
    'x-creative-output-id': String(output.id).slice(0, 128),
    'x-creative-workspace': String(generation.workspace).slice(0, 32),
  },
})

export const classifyCreativeOutput = async ({
  generation,
  output,
  body,
  contentType,
  source = process.env,
  classifier = null,
  fetchImpl = globalThis.fetch,
  now = new Date(),
}) => {
  let raw
  if (classifier) {
    try { raw = await classifier({ generation, output, body, contentType, now }) } catch { raw = null }
  } else if (String(source.CREATIVE_OUTPUT_SAFETY_CLASSIFIER_MODE ?? '').toLowerCase() === 'external') {
    raw = await externalClassifier({ generation, output, body, contentType, source, fetchImpl })
  } else if (generation.provider?.id === 'mock' || source.NODE_ENV !== 'production') {
    raw = { decision: 'allow', classifierId: 'local-fixture', classifierVersion: '1', categories: [] }
  } else {
    raw = { decision: 'review', classifierId: 'unavailable', classifierVersion: 'none', categories: ['classifier_unavailable'] }
  }
  const decision = normalizeDecision(raw?.decision)
  const classifierId = codePattern.test(String(raw?.classifierId ?? '')) ? String(raw.classifierId) : 'invalid'
  const classifierVersion = codePattern.test(String(raw?.classifierVersion ?? '')) ? String(raw.classifierVersion) : 'unknown'
  const categories = safeCodes(raw?.categories)
  return Object.freeze({
    schemaVersion: 1,
    decision,
    classified: classifierId !== 'unavailable' && classifierId !== 'invalid',
    classifierId,
    classifierVersion,
    categories,
    evidenceHash: hash(JSON.stringify({ generationId: generation.id, outputId: output.id, decision, classifierId, classifierVersion, categories })),
    classifiedAt: now.toISOString(),
  })
}

export const aggregateOutputSafety = (items = []) => {
  const decision = items.some((item) => item.decision === 'block') ? 'block' : items.some((item) => item.decision !== 'allow') ? 'review' : 'allow'
  return Object.freeze({
    schemaVersion: 1,
    decision,
    classified: items.length > 0 && items.every((item) => item.classified),
    outputCount: items.length,
    evidenceHashes: items.map((item) => item.evidenceHash),
  })
}
