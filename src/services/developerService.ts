import { api, withQuery } from './apiClient'
import type { ApiPaginationMeta, DeveloperAccessControl, DeveloperApiKeyCredential, DeveloperKeyIssueResult, DeveloperServiceAccount, DeveloperServiceAccountQuery } from './contracts'

export const developerService = {
  control: () => api.get<DeveloperAccessControl>('/developer/access-control'),
  async list(query: DeveloperServiceAccountQuery = {}) {
    const envelope = await api.getEnvelope<DeveloperServiceAccount[]>(withQuery('/developer/service-accounts', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  createAccount: (payload: { name: string; description: string }) => api.post<DeveloperServiceAccount>('/developer/service-accounts', payload),
  revokeAccount: (id: string, payload: { expectedVersion: number; reasonCode: string }) => api.post<DeveloperServiceAccount>(`/developer/service-accounts/${encodeURIComponent(id)}/transitions`, { action: 'revoke', ...payload }),
  createKey: (accountId: string, payload: { name: string; scopes: string[]; ipAllowlist: string[]; ttlDays: number }) => api.post<DeveloperKeyIssueResult>(`/developer/service-accounts/${encodeURIComponent(accountId)}/keys`, payload),
  rotateKey: (accountId: string, keyId: string, payload: { name: string; scopes: string[]; ipAllowlist: string[]; ttlDays: number; expectedVersion: number; reasonCode: string }) => api.post<DeveloperKeyIssueResult>(`/developer/service-accounts/${encodeURIComponent(accountId)}/keys/${encodeURIComponent(keyId)}/rotate`, payload),
  revokeKey: (accountId: string, keyId: string, payload: { expectedVersion: number; reasonCode: string }) => api.post<DeveloperApiKeyCredential>(`/developer/service-accounts/${encodeURIComponent(accountId)}/keys/${encodeURIComponent(keyId)}/revoke`, payload),
}
