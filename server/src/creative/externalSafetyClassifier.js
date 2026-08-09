const decisions = new Set(['allow', 'review', 'block'])
const codePattern = /^[a-z0-9][a-z0-9._:-]{1,95}$/i
const maxResponseBytes = 16_384

const policyCategoryIds = new Set([
  'adult_explicit_sexual_content',
  'benign_original_or_authorized_creation',
  'child_sexual_exploitation',
  'copyright_trademark_artist_style_or_lyrics',
  'credential_theft_malware_or_cyber_abuse',
  'election_or_political_persuasion',
  'fraud_impersonation_or_deceptive_media',
  'graphic_violence_or_gore',
  'hate_extremist_praise_or_recruitment',
  'medical_legal_newsworthy_or_educational_sensitive_context',
  'minor_nonsexual_sensitive_depiction',
  'non_consensual_intimate_content',
  'personal_data_or_sensitive_attribute_inference',
  'public_figure_sensitive_context',
  'real_person_likeness_voice_or_biometrics',
  'regulated_advice_or_high_impact_decision',
  'self_harm_instructions_or_encouragement',
  'targeted_harassment_threats_or_doxxing',
  'violent_wrongdoing_instructions',
  'weapons_drugs_or_regulated_goods',
])

const readBoundedText = async (response) => {
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) throw new Error('classifier_response_too_large')
  if (!response.body || typeof response.body.getReader !== 'function') throw new Error('classifier_response_body_missing')

  const reader = response.body.getReader()
  const chunks = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw new Error('classifier_response_chunk_invalid')
      totalBytes += value.byteLength
      if (totalBytes > maxResponseBytes) throw new Error('classifier_response_too_large')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }

  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)), totalBytes)
  return body.toString('utf8')
}

const unavailable = (category) => Object.freeze({
  decision: 'review',
  classifierId: 'unavailable',
  classifierVersion: 'none',
  categories: [category],
})

export const classifyWithExternalSafetyService = async ({
  endpointValue,
  tokenValue,
  headers,
  body,
  contentType,
  fetchImpl,
}) => {
  let endpoint
  try { endpoint = new URL(String(endpointValue ?? '').trim()) } catch { endpoint = null }
  const token = String(tokenValue ?? '').trim()
  if (!endpoint || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || token.length < 16) {
    return unavailable('classifier_unavailable')
  }

  try {
    const response = await fetchImpl(endpoint.toString(), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': contentType,
        ...headers,
      },
      body,
    })
    if (!response.ok) throw new Error('classifier_response_failed')
    const payload = JSON.parse(await readBoundedText(response))
    const categories = Array.isArray(payload?.categories) ? [...new Set(payload.categories.map(String))] : null
    if (
      !decisions.has(payload?.decision) ||
      !codePattern.test(String(payload?.classifierId ?? '')) ||
      !codePattern.test(String(payload?.classifierVersion ?? '')) ||
      !categories ||
      categories.length > 20 ||
      categories.some((category) => !policyCategoryIds.has(category))
    ) {
      throw new Error('classifier_response_invalid')
    }
    return Object.freeze({
      decision: payload.decision,
      classifierId: payload.classifierId,
      classifierVersion: payload.classifierVersion,
      categories,
    })
  } catch {
    return unavailable('classifier_failed')
  }
}

export const externalSafetyClassifierContract = Object.freeze({
  maxResponseBytes,
  policyCategoryIds: Object.freeze([...policyCategoryIds]),
})
