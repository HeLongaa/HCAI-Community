import { useEffect, useState } from 'react'
import type { Role } from '../domain/types'

export function useAccountState() {
  const [userRole, setUserRole] = useState<Role>(() => {
    try {
      const raw = localStorage.getItem('hcaiUser')
      if (!raw) return 'member'
      const parsed = JSON.parse(raw) as { role?: Role }
      return parsed.role ?? 'member'
    } catch {
      return 'member'
    }
  })
  const [accountName] = useState(() => {
    try {
      const raw = localStorage.getItem('hcaiUser')
      if (!raw) return 'HCAI Creator'
      const parsed = JSON.parse(raw) as { displayName?: string }
      return parsed.displayName ?? 'HCAI Creator'
    } catch {
      return 'HCAI Creator'
    }
  })

  useEffect(() => {
    localStorage.setItem('hcaiUser', JSON.stringify({ displayName: accountName, role: userRole }))
  }, [accountName, userRole])

  return {
    accountName,
    userRole,
    setUserRole,
  }
}
