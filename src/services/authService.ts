import { api, setStoredAccessToken } from './apiClient'
import type {
  ApiAccount,
  ApiSession,
  AuthEmailRequestResponse,
  LoginRequest,
  LogoutRequest,
  OAuthProvider,
  OAuthAccountLink,
  OAuthProviderMetadata,
  OAuthSessionResponse,
  OAuthStartResponse,
  RefreshSessionRequest,
  RegistrationResponse,
  RegisterRequest,
  RevokeSessionsResponse,
  PasswordResetResponse,
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
    const result = await api.post<RegistrationResponse>('/auth/register', payload)
    if ('accessToken' in result) setStoredAccessToken(result.accessToken)
    return result
  },
  async resendEmailVerification(email: string) {
    return api.post<AuthEmailRequestResponse>('/auth/email/verification/resend', { email }, { token: null })
  },
  async verifyEmail(token: string) {
    const session = await api.post<SessionResponse>('/auth/email/verify', { token }, { token: null })
    setStoredAccessToken(session.accessToken)
    return session
  },
  async requestPasswordReset(email: string) {
    return api.post<AuthEmailRequestResponse>('/auth/password-reset/request', { email }, { token: null })
  },
  async resetPassword(token: string, password: string) {
    const result = await api.post<PasswordResetResponse>('/auth/password-reset/confirm', { token, password }, { token: null })
    setStoredAccessToken(null)
    return result
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
