import registry from '../../../config/runtime-config-registry.json' with { type: 'json' }
import { validationFailed } from '../common/http/validation.js'

const secretRefPattern = new RegExp(registry.secretPolicy.allowedRefPattern)
const forbiddenKeyPattern = new RegExp(registry.secretPolicy.forbiddenValueKeys.join('|'), 'i')

export const runtimeConfigEntries = Object.freeze(registry.entries.map((entry) => Object.freeze({ ...entry })))
export const runtimeConfigByKey = Object.freeze(Object.fromEntries(runtimeConfigEntries.map((entry) => [entry.key, entry])))

const assertNoInlineSecrets = (value, path = 'value') => {
  if (value == null) return
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoInlineSecrets(item, `${path}[${index}]`))
    return
  }
  if (typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeyPattern.test(key) && (typeof child !== 'string' || !secretRefPattern.test(child))) {
      throw validationFailed(`${path}.${key} must be a secretref:// reference`)
    }
    assertNoInlineSecrets(child, `${path}.${key}`)
  }
}

const typeMatches = (value, type) => type === 'null' ? value === null
  : type === 'integer' ? Number.isInteger(value)
    : type === 'object' ? Boolean(value && typeof value === 'object' && !Array.isArray(value))
      : typeof value === type

const validateSchemaValue = (value, schema, path) => {
  const acceptedTypes = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (schema.type && !acceptedTypes.some((type) => typeMatches(value, type))) {
    throw validationFailed(`${path} must be ${acceptedTypes.join(' or ')}`)
  }
  if (value === null) return
  if (schema.enum && !schema.enum.includes(value)) throw validationFailed(`${path} must be one of: ${schema.enum.join(', ')}`)
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) throw validationFailed(`${path} must be at least ${schema.minimum}`)
    if (schema.maximum != null && value > schema.maximum) throw validationFailed(`${path} must be at most ${schema.maximum}`)
  }
  if (typeof value === 'string' && schema.pattern && !(new RegExp(schema.pattern)).test(value)) {
    throw validationFailed(`${path} has an invalid format`)
  }
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) throw validationFailed(`${path}.${key} is required`)
    }
    for (const [key, child] of Object.entries(value)) {
      if (!schema.properties[key]) throw validationFailed(`${path}.${key} is not allowed`)
      validateSchemaValue(child, schema.properties[key], `${path}.${key}`)
    }
  }
}

export const validateRuntimeConfigValue = (key, value) => {
  const entry = runtimeConfigByKey[key]
  if (!entry) throw validationFailed('configuration key is not registered')
  if (entry.valueType === 'object' && (value == null || typeof value !== 'object' || Array.isArray(value))) {
    throw validationFailed(`${key} must be an object`)
  }
  assertNoInlineSecrets(value, key)
  validateSchemaValue(value, { type: entry.valueType, ...entry.schema }, key)
  if (key === 'jobs.worker' && value.renewIntervalSeconds >= value.leaseTtlSeconds) {
    throw validationFailed('jobs.worker.renewIntervalSeconds must be less than leaseTtlSeconds')
  }
  return { key, value, valueSchemaVersion: entry.schemaVersion }
}

export const buildRuntimeConfigSnapshot = (overrides = {}) =>
  Object.freeze(Object.fromEntries(runtimeConfigEntries.map((entry) => {
    const value = overrides[entry.key] ?? entry.defaultValue
    return [entry.key, validateRuntimeConfigValue(entry.key, value)]
  })))
