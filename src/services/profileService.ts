import { api, withQuery } from './apiClient'
import type { MarketplaceProfile } from '../domain/types'
import type { AccountLifecycleStatus, ApiOwnProfile, ApiPortfolioAsset, ApiProfile, ProfileListQuery } from './contracts'

const toProfile = (profile: ApiProfile): MarketplaceProfile => ({
  ...profile,
  id: profile.id ?? profile.handle,
})

export const profileService = {
  async own() {
    const profile = await api.get<ApiOwnProfile>('/profiles/me')
    return { ...profile, id: profile.id ?? profile.handle }
  },
  async updateOwn(body: {
    displayName?: string
    handle?: string
    bio?: string
    lane?: 'maker' | 'publisher' | 'both'
    skills?: string[]
    languages?: string[]
    visibility?: 'public' | 'unlisted' | 'private'
    discoverable?: boolean
    showActivity?: boolean
    showPortfolio?: boolean
    expectedVersion: number
  }) {
    const profile = await api.patch<ApiOwnProfile>('/profiles/me', body)
    return { ...profile, id: profile.id ?? profile.handle }
  },
  accountStatus() {
    return api.get<AccountLifecycleStatus>('/users/me/account-status')
  },
  requestAccountDeletion(payload: { expectedVersion: number; reasonCode: string }) {
    return api.post<AccountLifecycleStatus>('/users/me/account-deletion', payload)
  },
  cancelAccountDeletion(payload: { expectedVersion: number; reasonCode: string }) {
    return api.del<AccountLifecycleStatus>('/users/me/account-deletion', { body: JSON.stringify(payload) })
  },
  ownPortfolio() {
    return api.get<ApiPortfolioAsset[]>('/profiles/me/portfolio')
  },
  updatePortfolioAsset(id: string, body: { title?: string; caption?: string; sortOrder?: number; action?: 'publish' | 'withdraw' | 'archive' | 'restore' }) {
    return api.patch<ApiPortfolioAsset>(`/profiles/me/portfolio/${id}`, body)
  },
  async list(query?: ProfileListQuery) {
    const profiles = await api.get<ApiProfile[]>(withQuery('/profiles', query))
    return profiles.map(toProfile)
  },
  async rankings() {
    const profiles = await api.get<ApiProfile[]>('/profiles/rankings')
    return profiles.map(toProfile)
  },
  async findByHandle(handle: string) {
    const profile = await api.get<ApiProfile>(`/profiles/${handle}`)
    return toProfile(profile)
  },
}
