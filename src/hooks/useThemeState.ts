import { useEffect, useState } from 'react'
import type { ThemeMode } from '../domain/types'
import { readThemeMode } from '../domain/theme'

export function useThemeState() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode)

  useEffect(() => {
    localStorage.setItem('hcaiThemeMode', themeMode)
  }, [themeMode])

  return {
    themeMode,
    setThemeMode,
  }
}
