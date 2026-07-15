import { api, setStoredAccessToken } from './apiClient'
import type {
  ApiAccount,
  ApiSession,
  LoginRequest,
  LogoutRequest,
  OAuthProvider,
  OAuthAccountLink,
  OAuthProviderMetadata,
  OAuthSessionResponse,
  OAuthStartResponse,
  RefreshSessionRequest,
  RegisterRequest,
  RevokeSessionsResponse,
  SessionResponse,
  UnlinkOAuthAccountResponse,
} from './contracts'

export type SessionUser = ApiAccount

export const authService = {
  async me() {
    return api.get<SessionUser>('/me')
  },
  async login(handle = 'taskops') {
    const body: LoginRequest = { handle }
    const session = await api.post<SessionResponse>('/auth/login', body)
    setStoredAccessToken(session.accessToken)
    return session
  },
  async loginWithPassword(email: string, password: string) {
    const body: LoginRequest = { email, password }
    const session = await api.post<SessionResponse>('/auth/login', body)
    setStoredAccessToken(session.accessToken)
    return session
  },
  async register(payload: RegisterRequest) {
    const session = await api.post<SessionResponse>('/auth/register', payload)
    setStoredAccessToken(session.accessToken)
    return session
  },
  async listOAuthProviders() {
    return api.get<OAuthProviderMetadata[]>('/auth/oauth/providers')
  },
  async listOAuthAccounts() {
    return api.get<OAuthAccountLink[]>('/auth/oauth/accounts')
  },
  async loginWithOAuthProvider(provider: OAuthProvider, options: { redirectTo?: string; linkAccount?: boolean } = {}) {
    const start = await api.post<OAuthStartResponse>(`/auth/oauth/${provider}/start`, options)
    if (start.mode === 'external') {
      window.location.assign(start.authorizationUrl)
      return null
    }
    const callbackUrl = new URL(start.authorizationUrl, window.location.origin)
    const callbackPath = `${callbackUrl.pathname.replace(/^\/api/, '')}${callbackUrl.search}`
    const session = await api.get<OAuthSessionResponse>(callbackPath)
    setStoredAccessToken(session.accessToken)
    return session
  },
  async unlinkOAuthAccount(provider: OAuthProvider) {
    return api.del<UnlinkOAuthAccountResponse>(`/auth/oauth/accounts/${provider}`)
  },
  async refresh(refreshToken?: string | null) {
    const body: RefreshSessionRequest = refreshToken ? { refreshToken } : {}
    const session = await api.post<SessionResponse>('/auth/refresh', body, { token: null })
    setStoredAccessToken(session.accessToken)
    return session
  },
  async logout(refreshToken?: string | null) {
    const body: LogoutRequest = refreshToken ? { refreshToken } : {}
    await api.post('/auth/logout', body, { token: null })
    setStoredAccessToken(null)
  },
  async listSessions() {
    return api.get<ApiSession[]>('/auth/sessions')
  },
  async revokeSession(id: string) {
    return api.del<{ revoked: boolean }>(`/auth/sessions/${encodeURIComponent(id)}`)
  },
  async revokeAllSessions() {
    return api.del<RevokeSessionsResponse>('/auth/sessions')
  },
}
