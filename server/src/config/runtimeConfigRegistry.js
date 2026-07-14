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

export const validateRuntimeConfigValue = (key, value) => {
  const entry = runtimeConfigByKey[key]
  if (!entry) throw validationFailed('configuration key is not registered')
  if (entry.valueType === 'object' && (value == null || typeof value !== 'object' || Array.isArray(value))) {
    throw validationFailed(`${key} must be an object`)
  }
  assertNoInlineSecrets(value)
  return { key, value, valueSchemaVersion: entry.schemaVersion }
}

export const buildRuntimeConfigSnapshot = (overrides = {}) =>
  Object.freeze(Object.fromEntries(runtimeConfigEntries.map((entry) => {
    const value = overrides[entry.key] ?? entry.defaultValue
    return [entry.key, validateRuntimeConfigValue(entry.key, value)]
  })))
