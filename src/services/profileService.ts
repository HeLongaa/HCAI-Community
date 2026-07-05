import { api, withQuery } from './apiClient'
import type { MarketplaceProfile } from '../domain/types'
import type { ApiProfile, ProfileListQuery } from './contracts'

const toProfile = (profile: ApiProfile): MarketplaceProfile => ({
  ...profile,
  id: profile.id ?? profile.handle,
})

export const profileService = {
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
