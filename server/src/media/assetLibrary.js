const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const videoTypes = new Set(['video/mp4', 'video/webm'])
const audioTypes = new Set(['audio/mpeg', 'audio/wav', 'audio/mp4'])
const chatTypes = new Set(['text/plain', 'text/markdown', 'application/pdf', ...imageTypes])

export const assetMediaType = (contentType = '') => {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  return 'document'
}

export const assetEligibleForWorkspace = (asset, workspace) => {
  if (!workspace) return true
  if (asset.status !== 'uploaded' || asset.metadata?.security?.scanStatus !== 'clean' || asset.archivedAt || asset.deletedAt) return false
  if (workspace === 'image') return ['submission_asset', 'profile_portfolio', 'library_asset'].includes(asset.purpose) && imageTypes.has(asset.contentType)
  if (workspace === 'video') return ['submission_asset', 'profile_portfolio', 'library_asset'].includes(asset.purpose) && imageTypes.has(asset.contentType)
  if (workspace === 'music') return false
  return ['task_attachment', 'library_asset'].includes(asset.purpose) && chatTypes.has(asset.contentType) && asset.sizeBytes <= 20 * 1024 * 1024
}

const safeRelation = (relation) => ({
  id: String(relation.id),
  sourceAssetId: String(relation.sourceAssetId),
  targetAssetId: String(relation.targetAssetId),
  relationType: relation.relationType,
  sourceGenerationId: relation.sourceGenerationId ?? null,
  targetWorkspace: relation.targetWorkspace ?? null,
  role: relation.role ?? null,
  createdAt: relation.createdAt?.toISOString?.() ?? relation.createdAt ?? '',
})

export const buildSafeAssetLibraryItem = (asset, { generation = null, relations = [], referenced = false } = {}) => {
  const clean = asset.status === 'uploaded' && asset.metadata?.security?.scanStatus === 'clean'
  const deleted = Boolean(asset.deletedAt)
  return {
    id: String(asset.id),
    fileName: asset.fileName,
    contentType: asset.contentType,
    mediaType: assetMediaType(asset.contentType),
    sizeBytes: asset.sizeBytes,
    purpose: asset.purpose,
    status: asset.status,
    scanStatus: asset.metadata?.security?.scanStatus ?? 'pending',
    archivedAt: asset.archivedAt?.toISOString?.() ?? asset.archivedAt ?? null,
    deletedAt: asset.deletedAt?.toISOString?.() ?? asset.deletedAt ?? null,
    deletionReason: asset.deletionReason ?? null,
    sourceGeneration: generation ? {
      id: String(generation.id),
      workspace: generation.workspace,
      mode: generation.mode,
      status: generation.status,
      createdAt: generation.createdAt?.toISOString?.() ?? generation.createdAt ?? '',
    } : null,
    relations: relations.map(safeRelation),
    referenced,
    actions: {
      download: { available: clean && !asset.archivedAt && !deleted, reason: deleted ? 'asset_deleted' : clean ? (asset.archivedAt ? 'asset_archived' : null) : 'asset_not_clean' },
      archive: { available: !asset.archivedAt && !deleted, reason: deleted ? 'asset_deleted' : asset.archivedAt ? 'already_archived' : null },
      restore: { available: Boolean(asset.archivedAt) && !deleted, reason: deleted ? 'asset_deleted' : asset.archivedAt ? null : 'not_archived' },
      delete: { available: !deleted, reason: deleted ? 'already_deleted' : null },
      recover: { available: deleted, reason: deleted ? null : 'not_deleted' },
      reuse: Object.fromEntries(['image', 'video', 'music', 'chat'].map((workspace) => [workspace, {
        available: assetEligibleForWorkspace(asset, workspace),
        reason: assetEligibleForWorkspace(asset, workspace) ? null : asset.archivedAt ? 'asset_archived' : clean ? 'incompatible_asset' : 'asset_not_clean',
      }])),
    },
    createdAt: asset.createdAt?.toISOString?.() ?? asset.createdAt ?? '',
    updatedAt: asset.updatedAt?.toISOString?.() ?? asset.updatedAt ?? '',
  }
}
