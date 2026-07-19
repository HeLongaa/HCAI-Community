import { api, withQuery } from './apiClient'
import type {
  ApiComplianceManifest,
  ApiPolicyConsentStatus,
  ApiSupportRequest,
  ApiSupportRequestList,
  CreateSupportRequest,
  PolicyConsentRequest,
} from './contracts'

export const policyConsentRequest = (
  manifest: ApiComplianceManifest,
  locale: 'en' | 'zh',
): PolicyConsentRequest => ({
  accepted: true,
  locale,
  policyVersions: Object.fromEntries(
    manifest.policies
      .filter((policy) => manifest.consentContract.requiredPolicyIds.includes(policy.id))
      .map((policy) => [policy.id, policy.version]),
  ),
})

export const complianceService = {
  getManifest() {
    return api.get<ApiComplianceManifest>('/compliance/policies')
  },
  getConsentStatus() {
    return api.get<ApiPolicyConsentStatus>('/compliance/consent')
  },
  acceptPolicies(payload: PolicyConsentRequest) {
    return api.post<ApiPolicyConsentStatus>('/compliance/consent', payload)
  },
  listSupportRequests(options: { cursor?: string | null; limit?: number } = {}) {
    return api.get<ApiSupportRequestList>(withQuery('/support/requests', options))
  },
  createSupportRequest(payload: CreateSupportRequest) {
    return api.post<ApiSupportRequest>('/support/requests', payload)
  },
  getSupportRequest(id: string) {
    return api.get<ApiSupportRequest>(`/support/requests/${encodeURIComponent(id)}`)
  },
  addSupportMessage(id: string, payload: { message: string; expectedVersion: number; reasonCode?: string }) {
    return api.post<ApiSupportRequest>(`/support/requests/${encodeURIComponent(id)}/messages`, payload)
  },
}
