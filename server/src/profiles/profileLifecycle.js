import { HttpError } from '../common/errors/httpError.js'

export const profileVisibilities = ['public', 'unlisted', 'private']
export const profileLanes = ['maker', 'publisher', 'both']
export const accountDeletionGraceDays = 30

const fail = (message) => {
  throw new HttpError(400, 'VALIDATION_FAILED', message)
}

const boundedText = (value, name, { min = 0, max, nullable = false } = {}) => {
  if (value === undefined) return undefined
  if (value === null && nullable) return null
  if (typeof value !== 'string') fail(`${name} must be a string`)
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (normalized.length < min || normalized.length > max) fail(`${name} must be between ${min} and ${max} characters`)
  return normalized
}

const boundedList = (value, name, { maxItems = 12, maxLength = 40 } = {}) => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > maxItems) fail(`${name} must contain at most ${maxItems} items`)
  const normalized = value.map((item) => boundedText(item, `${name} item`, { min: 1, max: maxLength }))
  if (new Set(normalized.map((item) => item.toLowerCase())).size !== normalized.length) fail(`${name} must not contain duplicates`)
  return normalized
}

const expectedVersion = (value) => {
  if (!Number.isInteger(value) || value < 1) fail('expectedVersion must be a positive integer')
  return value
}

const booleanValue = (value, name) => {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') fail(`${name} must be a boolean`)
  return value
}

export const parseOwnProfileUpdate = (body = {}) => {
  const allowed = new Set([
    'displayName', 'handle', 'bio', 'lane', 'skills', 'languages', 'visibility',
    'discoverable', 'showActivity', 'showPortfolio', 'expectedVersion',
  ])
  const unknown = Object.keys(body).filter((key) => !allowed.has(key))
  if (unknown.length > 0) fail(`unsupported profile fields: ${unknown.sort().join(', ')}`)
  const handle = boundedText(body.handle, 'handle', { min: 3, max: 30 })
  if (handle !== undefined && !/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/i.test(handle)) {
    fail('handle may contain letters, numbers, underscores, and hyphens')
  }
  if (body.lane !== undefined && !profileLanes.includes(body.lane)) fail('lane is invalid')
  if (body.visibility !== undefined && !profileVisibilities.includes(body.visibility)) fail('visibility is invalid')
  const patch = {
    displayName: boundedText(body.displayName, 'displayName', { min: 1, max: 120 }),
    handle: handle?.toLowerCase(),
    bio: boundedText(body.bio, 'bio', { min: 0, max: 500 }),
    lane: body.lane,
    skills: boundedList(body.skills, 'skills'),
    languages: boundedList(body.languages, 'languages', { maxItems: 8, maxLength: 40 }),
    visibility: body.visibility,
    discoverable: booleanValue(body.discoverable, 'discoverable'),
    showActivity: booleanValue(body.showActivity, 'showActivity'),
    showPortfolio: booleanValue(body.showPortfolio, 'showPortfolio'),
    expectedVersion: expectedVersion(body.expectedVersion),
  }
  if (!Object.entries(patch).some(([key, value]) => key !== 'expectedVersion' && value !== undefined)) {
    fail('at least one profile field is required')
  }
  return patch
}

export const parseAccountDeletionRequest = (body = {}) => {
  const unknown = Object.keys(body).filter((key) => !['expectedVersion', 'reasonCode'].includes(key))
  if (unknown.length > 0) fail(`unsupported account deletion fields: ${unknown.sort().join(', ')}`)
  const reasonCode = boundedText(body.reasonCode, 'reasonCode', { min: 3, max: 64 })
  if (!/^[a-z0-9][a-z0-9._:-]*$/.test(reasonCode)) fail('reasonCode must be a bounded machine-readable code')
  return { expectedVersion: expectedVersion(body.expectedVersion), reasonCode }
}

export const accountStatusDto = (user) => ({
  status: user.deletionRequestedAt ? 'deletion_requested' : user.status,
  version: Number(user.accountVersion ?? 1),
  deletionRequestedAt: user.deletionRequestedAt?.toISOString?.() ?? user.deletionRequestedAt ?? null,
  deletionScheduledAt: user.deletionScheduledAt?.toISOString?.() ?? user.deletionScheduledAt ?? null,
  deletionReasonCode: user.deletionReasonCode ?? null,
})

export const profilePrivacyDto = (profile) => ({
  visibility: profile.visibility ?? 'public',
  discoverable: profile.discoverable !== false,
  showActivity: profile.showActivity !== false,
  showPortfolio: profile.showPortfolio !== false,
  version: Number(profile.version ?? 1),
  updatedAt: profile.updatedAt?.toISOString?.() ?? profile.updatedAt ?? null,
})

export const canReadProfile = ({ profile, viewer = null }) => {
  if (!profile || profile.user?.status && profile.user.status !== 'active') return false
  const owner = Boolean(viewer && (viewer.id === profile.userId || viewer.handle === profile.handle))
  if (owner) return true
  if (profile.user?.deletionRequestedAt) return false
  return (profile.visibility ?? 'public') !== 'private'
}

export const projectProfileForViewer = ({ profile, publicProfile, viewer = null }) => {
  if (!canReadProfile({ profile, viewer })) return null
  const owner = Boolean(viewer && (viewer.id === profile.userId || viewer.handle === profile.handle))
  const privacy = profilePrivacyDto(profile)
  const projected = {
    ...publicProfile,
    ...(!owner && !privacy.showActivity ? { stats: {}, reviews: [] } : {}),
    ...(!owner && !privacy.showPortfolio ? { portfolio: [] } : {}),
  }
  return owner ? { ...projected, privacy } : projected
}

export const deletionSchedule = (now = new Date()) => new Date(now.getTime() + accountDeletionGraceDays * 24 * 60 * 60 * 1000)
