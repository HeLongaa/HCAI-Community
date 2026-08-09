export type PublicPricingPlan = {
  id: string
  name: { en: string; zh: string }
  badge?: { en: string; zh: string }
  monthlyPrice: number
  yearlyPrice: number
  currency: string
  summary: { en: string; zh: string }
  features: Array<{ en: string; zh: string }>
  checkoutAvailable: boolean
}

type PublicPricingCatalog = {
  version: string
  plans: PublicPricingPlan[]
}

const localizedText = (value: unknown): value is { en: string; zh: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.en === 'string' && Boolean(record.en.trim()) && typeof record.zh === 'string' && Boolean(record.zh.trim())
}

const validPlan = (value: unknown): value is PublicPricingPlan => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const plan = value as Record<string, unknown>
  return typeof plan.id === 'string' && Boolean(plan.id.trim())
    && localizedText(plan.name)
    && (plan.badge == null || localizedText(plan.badge))
    && typeof plan.monthlyPrice === 'number' && plan.monthlyPrice >= 0
    && typeof plan.yearlyPrice === 'number' && plan.yearlyPrice >= 0
    && typeof plan.currency === 'string' && /^[A-Z]{3}$/.test(plan.currency)
    && localizedText(plan.summary)
    && Array.isArray(plan.features) && plan.features.every(localizedText)
    && typeof plan.checkoutAvailable === 'boolean'
}

const parseCatalog = (raw: string | undefined): PublicPricingCatalog | null => {
  if (!raw?.trim()) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (typeof value.version !== 'string' || !Array.isArray(value.plans) || !value.plans.every(validPlan)) return null
    return { version: value.version, plans: value.plans }
  } catch {
    return null
  }
}

export const publicPricingCatalog = parseCatalog(import.meta.env.VITE_PUBLIC_PRICING_CATALOG_JSON)
