import { createHash } from 'node:crypto'

import { HttpError } from '../common/errors/httpError.js'

export const providerMoneyScale = 1_000_000n

const safeIdentifierPattern = /^[a-z0-9][a-z0-9:._/-]{0,127}$/i
const currencyPattern = /^[A-Z]{3}$/

export const providerBillingUnits = Object.freeze({
  image: Object.freeze(['request', 'image']),
  chat: Object.freeze(['request', 'input_tokens', 'output_tokens', 'total_tokens']),
  video: Object.freeze(['generated_seconds']),
  music: Object.freeze(['generated_seconds', 'generated_minutes']),
})

const fail = (code, reasonCode, statusCode = 503) => {
  throw new HttpError(statusCode, code, 'Creative Provider cost policy blocked dispatch', { reasonCode })
}

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

export const stableProviderCostHash = (value) =>
  createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')

export const toProviderMoneyMicros = (value, { allowZero = true } = {}) => {
  const normalized = String(value ?? '').trim()
  const match = normalized.match(/^(\d+)(?:\.(\d{1,6}))?$/)
  if (!match) return null
  const whole = BigInt(match[1])
  const fraction = BigInt((match[2] ?? '').padEnd(6, '0'))
  const micros = whole * providerMoneyScale + fraction
  if (!allowZero && micros === 0n) return null
  return micros
}

export const providerMoneyAmount = (micros) => {
  if (micros == null) return null
  return Number(BigInt(micros)) / Number(providerMoneyScale)
}

const normalizedIdentifier = (value, reasonCode) => {
  const normalized = String(value ?? '').trim()
  if (!safeIdentifierPattern.test(normalized) || /token|secret|password|api[_-]?key/i.test(normalized)) {
    fail('CREATIVE_PROVIDER_COST_CONTRACT_INVALID', reasonCode)
  }
  return normalized
}

const normalizedCurrency = (value) => {
  const currency = String(value ?? '').trim().toUpperCase()
  if (!currencyPattern.test(currency)) fail('CREATIVE_PROVIDER_COST_CONTRACT_INVALID', 'currency_invalid')
  return currency
}

const normalizedDate = (value, reasonCode) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) fail('CREATIVE_PROVIDER_COST_CONTRACT_INVALID', reasonCode)
  return date.toISOString()
}

export const createProviderPricingSnapshot = ({
  providerId,
  providerAccountRef,
  providerModelId,
  workspace,
  currency,
  billingUnit,
  unitPrice,
  sourceType,
  sourceRef,
  calculatorVersion = 'provider-cost-calculator-v1',
  effectiveAt,
  capturedAt = effectiveAt,
  expiresAt = null,
}) => {
  const allowedUnits = providerBillingUnits[workspace]
  if (!allowedUnits?.includes(billingUnit)) {
    fail('CREATIVE_PROVIDER_COST_CONTRACT_INVALID', 'billing_unit_unsupported')
  }
  const unitPriceMicros = toProviderMoneyMicros(unitPrice)
  if (unitPriceMicros == null) fail('CREATIVE_PROVIDER_COST_CONTRACT_INVALID', 'unit_price_invalid')
  const snapshot = {
    schemaVersion: 'provider-pricing-snapshot-v1',
    providerId: normalizedIdentifier(providerId, 'provider_id_invalid'),
    providerAccountRef: normalizedIdentifier(providerAccountRef, 'provider_account_ref_invalid'),
    providerModelId: normalizedIdentifier(providerModelId, 'provider_model_id_invalid'),
    workspace: normalizedIdentifier(workspace, 'workspace_invalid'),
    currency: normalizedCurrency(currency),
    billingUnit,
    unitPriceMicros: unitPriceMicros.toString(),
    sourceType: normalizedIdentifier(sourceType, 'pricing_source_type_invalid'),
    sourceRef: normalizedIdentifier(sourceRef, 'pricing_source_ref_invalid'),
    calculatorVersion: normalizedIdentifier(calculatorVersion, 'calculator_version_invalid'),
    effectiveAt: normalizedDate(effectiveAt, 'pricing_effective_at_invalid'),
    capturedAt: normalizedDate(capturedAt, 'pricing_captured_at_invalid'),
    expiresAt: expiresAt == null ? null : normalizedDate(expiresAt, 'pricing_expires_at_invalid'),
  }
  return Object.freeze({
    ...snapshot,
    snapshotHash: stableProviderCostHash(snapshot),
  })
}

export const calculateProviderEstimate = ({ snapshot, quantity, now = new Date() }) => {
  if (!snapshot?.snapshotHash || stableProviderCostHash(Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => key !== 'snapshotHash'),
  )) !== snapshot.snapshotHash) {
    fail('CREATIVE_PROVIDER_PRICING_SNAPSHOT_INVALID', 'pricing_snapshot_hash_mismatch')
  }
  const evaluatedAt = new Date(normalizedDate(now, 'pricing_evaluation_at_invalid'))
  if (snapshot.expiresAt && new Date(normalizedDate(snapshot.expiresAt, 'pricing_expires_at_invalid')) <= evaluatedAt) {
    fail('CREATIVE_PROVIDER_PRICING_SNAPSHOT_EXPIRED', 'pricing_snapshot_expired')
  }
  const quantityMicros = toProviderMoneyMicros(quantity, { allowZero: false })
  if (quantityMicros == null) fail('CREATIVE_PROVIDER_COST_CONTRACT_INVALID', 'usage_quantity_invalid')
  const unitPriceMicros = BigInt(snapshot.unitPriceMicros)
  const estimateMicros = (unitPriceMicros * quantityMicros + providerMoneyScale - 1n) / providerMoneyScale
  return {
    currency: snapshot.currency,
    billingUnit: snapshot.billingUnit,
    quantityMicros: quantityMicros.toString(),
    estimateMicros: estimateMicros.toString(),
    amount: providerMoneyAmount(estimateMicros),
  }
}

export const providerBudgetWindowFor = (now = new Date()) => {
  const date = normalizedDate(now, 'budget_window_date_invalid').slice(0, 10)
  return {
    start: `${date}T00:00:00.000Z`,
    end: `${date}T23:59:59.999Z`,
  }
}

export const buildProviderCostReservation = ({
  generationId,
  providerCost,
  workspace,
  mode,
  now = new Date(),
}) => {
  const estimate = providerCost?.estimate ?? {}
  const budget = providerCost?.budget ?? {}
  const model = providerCost?.model ?? {}
  const estimateMicros = toProviderMoneyMicros(estimate.amount, { allowZero: false })
  const capMicros = toProviderMoneyMicros(budget.dailyCapAmount, { allowZero: false })
  const openingSpentMicros = toProviderMoneyMicros(budget.spentAmount ?? 0)
  if (estimateMicros == null) fail('CREATIVE_PROVIDER_BUDGET_BLOCKED', 'missing_cost_estimate')
  if (capMicros == null) fail('CREATIVE_PROVIDER_BUDGET_BLOCKED', 'missing_budget_cap')
  if (openingSpentMicros == null) fail('CREATIVE_PROVIDER_BUDGET_BLOCKED', 'spent_amount_invalid')
  const currency = normalizedCurrency(estimate.currency)
  if (normalizedCurrency(budget.dailyCapCurrency) !== currency) {
    fail('CREATIVE_PROVIDER_BUDGET_BLOCKED', 'budget_currency_mismatch')
  }
  const billingUnit = estimate.billingUnit ?? 'request'
  const quantity = estimate.quantity ?? 1
  const unitPrice = estimate.unitPrice ?? estimate.amount
  const snapshot = createProviderPricingSnapshot({
    providerId: providerCost.providerId,
    providerAccountRef: providerCost.providerAccountRef,
    providerModelId: model.providerModelId,
    workspace,
    currency,
    billingUnit,
    unitPrice,
    sourceType: model.pricingSource ?? 'fixture_config',
    sourceRef: `${providerCost.providerId}:${workspace}:configured-estimate`,
    effectiveAt: model.pricingSnapshotAt ?? now,
    capturedAt: model.pricingSnapshotAt ?? now,
  })
  const calculatedEstimate = calculateProviderEstimate({ snapshot, quantity, now })
  if (calculatedEstimate.estimateMicros !== estimateMicros.toString()) {
    fail('CREATIVE_PROVIDER_COST_CONTRACT_INVALID', 'estimate_calculation_mismatch')
  }
  const window = providerBudgetWindowFor(now)
  return {
    sourceKey: `provider-cost:${stableProviderCostHash({ generationId, providerId: providerCost.providerId })}`,
    generationId: normalizedIdentifier(generationId, 'generation_id_invalid'),
    providerId: snapshot.providerId,
    providerAccountRef: snapshot.providerAccountRef,
    providerModelId: snapshot.providerModelId,
    workspace: snapshot.workspace,
    mode: normalizedIdentifier(mode, 'mode_invalid'),
    budgetScope: normalizedIdentifier(budget.budgetScope, 'budget_scope_invalid'),
    currency,
    estimateMicros: estimateMicros.toString(),
    capMicros: capMicros.toString(),
    openingSpentMicros: openingSpentMicros.toString(),
    windowStart: window.start,
    windowEnd: window.end,
    pricingSnapshot: snapshot,
    pricingSnapshotHash: snapshot.snapshotHash,
  }
}

export const providerCostCloseout = (generation) => {
  const providerCost = generation?.usage?.providerCost
  if (!providerCost) return null
  const status = generation.status
  if (status === 'queued' || status === 'running') return null
  const actualMicros = toProviderMoneyMicros(providerCost.actual?.amount)
  const actualCurrency = providerCost.actual?.currency == null
    ? null
    : normalizedCurrency(providerCost.actual.currency)
  if (actualMicros != null && actualCurrency === normalizedCurrency(providerCost.estimate?.currency)) {
    return {
      action: 'settle',
      actualMicros: actualMicros.toString(),
      actualCurrency,
      usage: providerCost.usage ?? null,
      risk: providerCost.risk ?? null,
    }
  }
  return {
    action: 'reconcile',
    reasonCode: actualCurrency && actualCurrency !== normalizedCurrency(providerCost.estimate?.currency)
      ? 'actual_currency_mismatch'
      : 'actual_cost_missing',
    usage: providerCost.usage ?? null,
    risk: providerCost.risk ?? null,
  }
}
