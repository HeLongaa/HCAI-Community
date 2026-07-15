import { useEffect, useState } from 'react'
import type { MarketplaceProfile, Permission, Role } from '../domain/types'
import { findProfile } from '../domain/utils'
import { authService, type SessionUser } from '../services/authService'
import { complianceService, policyConsentRequest } from '../services/complianceService'
import type { ApiPolicyConsentStatus, OAuthProvider, RegisterRequest } from '../services/contracts'
import { getStoredAccessToken, setStoredAccessToken } from '../services/apiClient'

export type OAuthLoginResult = 'authenticated' | 'redirecting'

type AccountState = {
  displayName: string
  role: Role
  handle: string
  profile: MarketplaceProfile | null
  permissions: Permission[]
  policyConsent: ApiPolicyConsentStatus | null
  source: 'api' | 'stored' | 'fallback'
}

const fallbackProfile = findProfile('taskops') ?? null
let accountBootstrapPromise: Promise<SessionUser> | null = null

const bootstrapAccount = () => {
  if (!accountBootstrapPromise) {
    accountBootstrapPromise = (async () => {
      try {
        return await authService.me()
      } catch {
        await authService.refresh()
        return authService.me()
      }
    })().finally(() => {
      accountBootstrapPromise = null
    })
  }
  return accountBootstrapPromise
}

const guestState = (): AccountState => ({
  displayName: 'Guest',
  role: 'member',
  handle: '',
  profile: null,
  permissions: [],
  policyConsent: null,
  source: 'fallback',
})

const asProfileLane = (lane?: string): MarketplaceProfile['lane'] => (
  lane === 'maker' || lane === 'publisher' || lane === 'both' ? lane : 'both'
)

const initialsFor = (value: string) => value.trim().slice(0, 2).toUpperCase() || 'U'

const profileFromUser = (user: SessionUser): MarketplaceProfile | null => {
  const localProfile = user.profile?.handle ? findProfile(user.profile.handle) : findProfile(user.handle)
  if (localProfile) {
    return localProfile
  }

  const handle = user.profile?.handle ?? user.handle
  if (!handle) {
    return null
  }
  const displayName = user.displayName || handle
  const name = user.profile?.name ?? { en: displayName, zh: displayName }
  const role = user.profile?.role ?? { en: user.role, zh: user.role }

  return {
    id: handle,
    handle,
    initials: user.profile?.initials ?? initialsFor(displayName),
    lane: asProfileLane(user.profile?.lane),
    name,
    role,
    bio: {
      en: 'Registered HCAI member.',
      zh: '已注册 HCAI 用户。',
    },
    tags: [],
    zhTags: [],
    categories: [],
    languages: [],
    stats: {
      score: 0,
      completed: 0,
      posted: 0,
      response: 'New',
      acceptance: 'New',
      earned: '0 pts',
      paid: '0',
      rank: 'New member',
    },
    badges: [],
    portfolio: [],
    reviews: [],
  }
}

const stateFromUser = (user: SessionUser): AccountState => ({
  displayName: user.displayName,
  role: user.role,
  handle: user.handle,
  profile: profileFromUser(user),
  permissions: user.permissions,
  policyConsent: user.policyConsent ?? null,
  source: 'api',
})

const loadInitialState = (): AccountState => {
  try {
    const raw = localStorage.getItem('hcaiUser')
    if (!raw) {
      return guestState()
    }
    if (!getStoredAccessToken()) {
      return guestState()
    }
    const parsed = JSON.parse(raw) as Partial<AccountState>
    return {
      displayName: parsed.displayName ?? 'HCAI Creator',
      role: parsed.role ?? 'member',
      handle: parsed.handle ?? 'taskops',
      profile: parsed.profile ?? fallbackProfile,
      permissions: parsed.permissions ?? ['task:create', 'post:create', 'comment:create', 'points:read'],
      policyConsent: parsed.policyConsent ?? null,
      source: 'stored',
    }
  } catch {
    return guestState()
  }
}

export function useAccountState() {
  const [account, setAccount] = useState<AccountState>(loadInitialState)
  const [bootstrapped, setBootstrapped] = useState(false)

  useEffect(() => {
    let active = true
    bootstrapAccount()
      .then((user) => {
        if (!active) return
        setAccount(stateFromUser(user))
        setStoredAccessToken(getStoredAccessToken())
      })
      .catch((error) => {
        console.info('[account-service]', error)
        if (!active) return
        setStoredAccessToken(null)
        setAccount(guestState())
      })
      .finally(() => {
        if (active) setBootstrapped(true)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!bootstrapped) return
    localStorage.setItem('hcaiUser', JSON.stringify(account))
  }, [account, bootstrapped])

  const loginAs = async (handle: string): Promise<void> => {
    await authService.login(handle)
    applySession(await authService.me())
  }

  const applySession = (user: SessionUser) => {
    const next = stateFromUser(user)
    setAccount(next)
    localStorage.setItem('hcaiUser', JSON.stringify(next))
  }

  const loginWithPassword = async (email: string, password: string): Promise<void> => {
    await authService.loginWithPassword(email, password)
    applySession(await authService.me())
  }

  const registerWithEmail = async (payload: RegisterRequest): Promise<void> => {
    await authService.register(payload)
    applySession(await authService.me())
  }

  const acceptCurrentPolicies = async (locale: 'en' | 'zh'): Promise<void> => {
    const manifest = await complianceService.getManifest()
    const policyConsent = await complianceService.acceptPolicies(policyConsentRequest(manifest, locale))
    setAccount((current) => {
      const next = { ...current, policyConsent }
      localStorage.setItem('hcaiUser', JSON.stringify(next))
      return next
    })
  }

  const loginWithOAuthProvider = async (provider: OAuthProvider): Promise<OAuthLoginResult> => {
    const session = await authService.loginWithOAuthProvider(provider)
    if (session) {
      applySession(await authService.me())
      return 'authenticated'
    }
    return 'redirecting'
  }

  const logout = async (): Promise<void> => {
    try {
      await authService.logout()
    } catch (error) {
      console.info('[account-service]', error)
    } finally {
      setStoredAccessToken(null)
      const next = guestState()
      setAccount(next)
      localStorage.removeItem('hcaiUser')
    }
  }

  const setUserRole = (nextRole: Role | ((prevState: Role) => Role)) => {
    setAccount((current) => {
      const role = typeof nextRole === 'function' ? nextRole(current.role) : nextRole
      const permissions = role === 'admin'
        ? ['task:create', 'task:propose', 'task:claim', 'task:submit', 'task:review', 'task:moderate', 'post:create', 'post:moderate', 'comment:create', 'points:read', 'points:adjust', 'admin:access', 'admin:audit:read', 'admin:queue:read', 'admin:queue:review', 'admin:permissions:manage', 'security:alerts:manage'] satisfies Permission[]
        : current.permissions
      const next = { ...current, role, permissions }
      localStorage.setItem('hcaiUser', JSON.stringify(next))
      return next
    })
  }

  const hasPermission = (permission: Permission) => account.permissions.includes(permission)

  return {
    accountName: account.displayName,
    accountProfile: account.profile ?? fallbackProfile,
    accountHandle: account.handle,
    accountSource: account.source,
    accountReady: bootstrapped,
    userRole: account.role,
    permissions: account.permissions,
    policyConsent: account.policyConsent,
    hasPermission,
    setUserRole,
    loginAs,
    loginWithPassword,
    loginWithOAuthProvider,
    registerWithEmail,
    acceptCurrentPolicies,
    logout,
  }
}
