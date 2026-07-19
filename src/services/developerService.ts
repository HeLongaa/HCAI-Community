import { api, apiRequest, withQuery } from './apiClient'
import type { ApiPaginationMeta, DeveloperAccessControl, DeveloperApiKeyCredential, DeveloperKeyIssueResult, DeveloperServiceAccount, DeveloperServiceAccountQuery, WebhookControl, WebhookDelivery, WebhookDeliveryQuery, WebhookEventDefinition, WebhookIssueResult, WebhookSubscription, WebhookSubscriptionQuery } from './contracts'

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
  webhookControl: () => api.get<WebhookControl>('/developer/webhooks/control'),
  webhookEvents: () => api.get<WebhookEventDefinition[]>('/developer/webhooks/events'),
  async webhooks(query: WebhookSubscriptionQuery = {}) {
    const envelope = await api.getEnvelope<WebhookSubscription[]>(withQuery('/developer/webhooks', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  createWebhook: (payload: { name: string; endpointUrl: string; eventTypes: string[]; maxAttempts?: number }) => api.post<WebhookIssueResult>('/developer/webhooks', payload),
  updateWebhook: (id: string, payload: { name: string; endpointUrl: string; eventTypes: string[]; maxAttempts: number; expectedVersion: number; reasonCode: string }) => api.put<WebhookSubscription>(`/developer/webhooks/${encodeURIComponent(id)}/configuration`, payload),
  transitionWebhook: (id: string, action: 'enable' | 'disable', payload: { expectedVersion: number; reasonCode: string }) => api.post<WebhookSubscription>(`/developer/webhooks/${encodeURIComponent(id)}/transitions`, { action, ...payload }),
  rotateWebhookSecret: (id: string, payload: { expectedVersion: number; reasonCode: string }) => api.post<WebhookIssueResult>(`/developer/webhooks/${encodeURIComponent(id)}/rotate-secret`, payload),
  deleteWebhook: (id: string, payload: { expectedVersion: number; reasonCode: string }) => apiRequest<WebhookSubscription>(`/developer/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }),
  async webhookDeliveries(query: WebhookDeliveryQuery = {}) {
    const envelope = await api.getEnvelope<WebhookDelivery[]>(withQuery('/developer/webhook-deliveries', query))
    return { items: envelope.data, nextCursor: (envelope.meta as ApiPaginationMeta | undefined)?.pagination?.nextCursor ?? null }
  },
  replayWebhookDelivery: (id: string, payload: { expectedVersion: number; reasonCode: string; idempotencyKey: string }) => api.post<WebhookDelivery>(`/developer/webhook-deliveries/${encodeURIComponent(id)}/replay`, payload),
}
