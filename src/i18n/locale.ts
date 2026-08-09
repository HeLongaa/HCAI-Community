import type { Locale } from '../domain/types'

const localeStorageKey = 'hcaiLocale'

export const readLocale = (): Locale => {
  try {
    const saved = localStorage.getItem(localeStorageKey)
    return saved === 'zh' || saved === 'en' ? saved : 'en'
  } catch {
    return 'en'
  }
}

export const persistLocale = (locale: Locale) => {
  try {
    localStorage.setItem(localeStorageKey, locale)
  } catch {
    // Storage may be unavailable in hardened or private browser contexts.
  }
}
