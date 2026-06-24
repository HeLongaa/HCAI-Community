import type { LocalizedText, ThemeMode } from './types'

export const themeModes: Array<{ key: ThemeMode; label: LocalizedText }> = [
  { key: 'black', label: { en: 'Black', zh: '黑色' } },
  { key: 'white', label: { en: 'White', zh: '白色' } },
]

export const readThemeMode = (): ThemeMode => {
  try {
    const saved = localStorage.getItem('hcaiThemeMode')
    return themeModes.some((item) => item.key === saved) ? (saved as ThemeMode) : 'black'
  } catch {
    return 'black'
  }
}
