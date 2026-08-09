import { randomUUID } from 'node:crypto'

const initialContentCategories = [
  ['skills', 'Skills', 'Skills'],
  ['workflows', 'Methods & Workflows', '方法与工作流'],
  ['templates', 'Templates', '模板'],
  ['prompt-packs', 'Prompt Packs', '提示词包'],
  ['tutorials', 'Tutorials', '教程'],
  ['case-studies', 'Case Studies', '案例复盘'],
].map(([slug, nameEn, nameZh], index) => ({ id: `inspiration-category-${slug}`, kind: 'content_type', slug, nameEn, nameZh, description: null, sortOrder: (index + 1) * 10, active: true }))

const initialDomainCategories = [
  ['image', 'Image', '图片'],
  ['video', 'Video', '视频'],
  ['music', 'Music', '音乐'],
  ['writing', 'Writing & Script', '文案与脚本'],
  ['assistant', 'Assistant', '对话与助手'],
  ['automation', 'Automation', '自动化'],
  ['marketing', 'Marketing', '营销'],
  ['education', 'Education', '教育'],
].map(([slug, nameEn, nameZh], index) => ({ id: `inspiration-domain-${slug}`, kind: 'domain', slug, nameEn, nameZh, description: null, sortOrder: (index + 1) * 10, active: true }))

const initialDifficultyCategories = [
  ['beginner', 'Beginner', '入门'],
  ['intermediate', 'Intermediate', '进阶'],
  ['professional', 'Professional', '专业'],
].map(([slug, nameEn, nameZh], index) => ({ id: `inspiration-difficulty-${slug}`, kind: 'difficulty', slug, nameEn, nameZh, description: null, sortOrder: (index + 1) * 10, active: true }))

const initialCategories = [...initialContentCategories, ...initialDomainCategories, ...initialDifficultyCategories]

const snapshot = (entry) => ({
  title: entry.title, summary: entry.summary, problem: entry.problem, audience: entry.audience,
  categoryId: entry.categoryId, contentType: entry.contentType, domains: entry.domains,
  difficulty: entry.difficulty, toolModels: entry.toolModels, content: entry.content,
  sourceAttribution: entry.sourceAttribution, license: entry.license, featured: entry.featured,
  supportsTaskDraft: entry.supportsTaskDraft, sortOrder: entry.sortOrder,
})

const dto = (entry, viewerId, favorites, usages, categories, includeRevisions = false) => {
  const { revisions: storedRevisions, ...base } = entry
  const revisions = includeRevisions ? storedRevisions?.map((revision) => ({ ...revision })) ?? [] : null
  return ({
  ...base,
  category: categories.find((item) => item.id === entry.categoryId) ?? null,
  favoriteCount: favorites.filter((item) => item.entryId === entry.id).length,
  usageCount: usages.filter((item) => item.entryId === entry.id).length,
  favorited: favorites.some((item) => item.entryId === entry.id && item.userId === viewerId),
  ...(revisions ? { revisions, pendingRevision: revisions.find((revision) => revision.version > entry.version && ['draft', 'pending_review', 'changes_requested', 'rejected'].includes(revision.status)) ?? null } : {}),
  })
}

export const createSeedInspirationRepository = ({ getUserById, recordAudit }) => {
  const categories = initialCategories.map((item) => ({ ...item }))
  const entries = []
  const favoritesStore = []
  const usages = []
  const now = () => new Date().toISOString()
  const list = (options = {}, actor = null, own = false) => {
    const viewerId = actor?.id ?? null
    const search = options.search?.toLowerCase()
    const filtered = entries.filter((entry) => {
      if (own ? entry.authorId !== viewerId : entry.status !== 'published') return false
      if (options.status && own && entry.status !== options.status) return false
      if (options.category && categories.find((category) => category.id === entry.categoryId)?.slug !== options.category) return false
      if (options.domain && !entry.domains.includes(options.domain)) return false
      if (options.difficulty && entry.difficulty !== options.difficulty) return false
      if (options.sourceKind && entry.sourceKind !== options.sourceKind) return false
      if (options.featured && !entry.featured) return false
      if (search && !`${entry.title} ${entry.summary} ${entry.problem}`.toLowerCase().includes(search)) return false
      return true
    }).sort((a, b) => Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt))
    const limit = options.limit ?? 30
    return { items: filtered.slice(0, limit).map((entry) => dto(entry, viewerId, favoritesStore, usages, categories, own)), limit, nextCursor: null }
  }
  const find = (id, actor = null, allowOwn = false) => {
    const entry = entries.find((item) => item.id === String(id))
    if (!entry || (entry.status !== 'published' && (!allowOwn || entry.authorId !== actor?.id))) return null
    if (allowOwn && entry.authorId === actor?.id) return dto(entry, actor.id, favoritesStore, usages, categories, true)
    return {
      ...dto(entry, actor?.id ?? null, favoritesStore, usages, categories),
      revisions: entry.revisions
        .filter((revision) => revision.status === 'published' && revision.version <= entry.version)
        .map(({ snapshot: _snapshot, ...revision }) => ({ ...revision })),
    }
  }
  const create = (payload, actor, official = false) => {
    if (!getUserById(actor.id)) return null
    const timestamp = now()
    const entry = {
      id: `inspiration-${randomUUID()}`, ...payload, authorId: actor.id, createdById: actor.id,
      author: { id: actor.id, handle: actor.handle, displayName: actor.displayName },
      sourceKind: official ? 'official' : 'user_submission', status: official ? 'published' : 'draft',
      version: 1, reviewNote: null, publishedAt: official ? timestamp : null, archivedAt: null, createdAt: timestamp, updatedAt: timestamp,
      featured: Boolean(payload.featured), supportsTaskDraft: Boolean(payload.supportsTaskDraft), sortOrder: payload.sortOrder ?? 0,
      revisions: [],
    }
    entry.revisions.push({ id: `revision-${randomUUID()}`, version: 1, status: official ? 'published' : 'draft', reviewNote: null, snapshot: snapshot(entry), createdAt: timestamp })
    entries.push(entry)
    recordAudit({ actor, action: official ? 'inspiration.official_published' : 'inspiration.draft_created', resourceType: 'inspiration_entry', resourceId: entry.id })
    return dto(entry, actor.id, favoritesStore, usages, categories)
  }
  const updateOwn = (id, payload, actor) => {
    const entry = entries.find((item) => item.id === String(id) && item.authorId === actor.id && item.sourceKind === 'user_submission' && ['draft', 'changes_requested', 'rejected', 'published'].includes(item.status))
    if (!entry) return null
    if (entry.status === 'published') {
      const nextVersion = entry.version + 1
      const existing = entry.revisions.find((revision) => revision.version === nextVersion)
      if (existing && !['draft', 'changes_requested', 'rejected'].includes(existing.status)) return null
      const nextSnapshot = snapshot({ ...entry, ...(existing?.snapshot ?? {}), ...payload })
      if (existing) Object.assign(existing, { status: 'draft', reviewNote: null, snapshot: nextSnapshot, reviewedAt: null })
      else entry.revisions.unshift({ id: `revision-${randomUUID()}`, version: nextVersion, status: 'draft', reviewNote: null, snapshot: nextSnapshot, createdAt: now() })
      entry.updatedAt = now()
      recordAudit({ actor, action: 'inspiration.revision_draft_updated', resourceType: 'inspiration_entry', resourceId: entry.id, metadata: { version: nextVersion } })
      return dto(entry, actor.id, favoritesStore, usages, categories, true)
    }
    Object.assign(entry, payload, { status: 'draft', reviewNote: null, version: entry.version + 1, updatedAt: now() })
    entry.revisions.unshift({ id: `revision-${randomUUID()}`, version: entry.version, status: 'draft', reviewNote: null, snapshot: snapshot(entry), createdAt: entry.updatedAt })
    recordAudit({ actor, action: 'inspiration.draft_updated', resourceType: 'inspiration_entry', resourceId: entry.id, metadata: { version: entry.version } })
    return dto(entry, actor.id, favoritesStore, usages, categories, true)
  }
  const submit = (id, actor) => {
    const entry = entries.find((item) => item.id === String(id) && item.authorId === actor.id && item.sourceKind === 'user_submission')
    if (!entry) return null
    if (entry.status === 'published') {
      const revision = entry.revisions.find((item) => item.version === entry.version + 1 && ['draft', 'changes_requested'].includes(item.status))
      if (!revision) return null
      revision.status = 'pending_review'; revision.reviewNote = null; entry.updatedAt = now()
      recordAudit({ actor, action: 'inspiration.revision_submitted', resourceType: 'inspiration_entry', resourceId: entry.id, metadata: { version: revision.version } })
      return dto(entry, actor.id, favoritesStore, usages, categories, true)
    }
    if (!['draft', 'changes_requested'].includes(entry.status)) return null
    entry.status = 'pending_review'; entry.reviewNote = null; entry.updatedAt = now(); entry.revisions[0].status = 'pending_review'
    recordAudit({ actor, action: 'inspiration.submitted', resourceType: 'inspiration_entry', resourceId: entry.id, metadata: { version: entry.version } })
    return dto(entry, actor.id, favoritesStore, usages, categories, true)
  }
  const withdraw = (id, actor) => {
    const entry = entries.find((item) => item.id === String(id) && item.authorId === actor.id && item.sourceKind === 'user_submission')
    if (!entry) return null
    if (entry.status === 'pending_review') {
      entry.status = 'draft'; entry.reviewNote = null; entry.updatedAt = now(); entry.revisions[0].status = 'draft'
      recordAudit({ actor, action: 'inspiration.submission_withdrawn', resourceType: 'inspiration_entry', resourceId: entry.id, metadata: { version: entry.version } })
      return dto(entry, actor.id, favoritesStore, usages, categories, true)
    }
    if (entry.status === 'published') {
      const revision = entry.revisions.find((item) => item.version === entry.version + 1 && item.status === 'pending_review')
      if (!revision) return null
      revision.status = 'draft'; revision.reviewNote = null; entry.updatedAt = now()
      recordAudit({ actor, action: 'inspiration.revision_withdrawn', resourceType: 'inspiration_entry', resourceId: entry.id, metadata: { version: revision.version } })
      return dto(entry, actor.id, favoritesStore, usages, categories, true)
    }
    return null
  }
  const favorite = (id, actor, active) => {
    const entry = entries.find((item) => item.id === String(id) && item.status === 'published')
    if (!entry) return null
    const index = favoritesStore.findIndex((item) => item.entryId === entry.id && item.userId === actor.id)
    if (active && index < 0) favoritesStore.push({ entryId: entry.id, userId: actor.id, createdAt: now() })
    if (!active && index >= 0) favoritesStore.splice(index, 1)
    recordAudit({ actor, action: active ? 'inspiration.favorited' : 'inspiration.unfavorited', resourceType: 'inspiration_entry', resourceId: entry.id })
    return dto(entry, actor.id, favoritesStore, usages, categories)
  }
  const review = (id, payload, actor) => {
    const entry = entries.find((item) => item.id === String(id) && item.sourceKind === 'user_submission')
    if (!entry) return null
    const nextStatus = payload.decision === 'approve' ? 'published' : payload.decision === 'request_changes' ? 'changes_requested' : 'rejected'
    if (entry.status === 'published') {
      const revision = entry.revisions.find((item) => item.version === entry.version + 1 && item.status === 'pending_review')
      if (!revision) return null
      revision.status = nextStatus; revision.reviewNote = payload.note || null; revision.reviewedAt = now()
      if (nextStatus === 'published') Object.assign(entry, revision.snapshot, { version: revision.version, reviewNote: payload.note || null, reviewedById: actor.id, updatedAt: now() })
      recordAudit({ actor, action: `inspiration.revision_review.${payload.decision}`, resourceType: 'inspiration_entry', resourceId: entry.id, metadata: { version: revision.version, note: payload.note } })
      return dto(entry, actor.id, favoritesStore, usages, categories, true)
    }
    if (entry.status !== 'pending_review') return null
    entry.status = nextStatus
    entry.reviewNote = payload.note || null; entry.reviewedById = actor.id; entry.updatedAt = now(); entry.publishedAt = entry.status === 'published' ? entry.updatedAt : null
    entry.revisions[0] = { ...entry.revisions[0], status: entry.status, reviewNote: entry.reviewNote, reviewedAt: entry.updatedAt }
    recordAudit({ actor, action: `inspiration.review.${payload.decision}`, resourceType: 'inspiration_entry', resourceId: entry.id, metadata: { version: entry.version, note: payload.note } })
    return dto(entry, actor.id, favoritesStore, usages, categories, true)
  }
  const updateAdmin = (id, payload, actor) => {
    const entry = entries.find((item) => item.id === String(id) && ['published', 'archived'].includes(item.status))
    if (!entry) return null
    if (entry.revisions.some((revision) => revision.version > entry.version && ['draft', 'pending_review', 'changes_requested', 'rejected'].includes(revision.status))) return null
    Object.assign(entry, payload, { version: entry.version + 1, updatedAt: now() })
    entry.revisions.unshift({ id: `revision-${randomUUID()}`, version: entry.version, status: entry.status, reviewNote: null, snapshot: snapshot(entry), reviewedAt: entry.updatedAt, createdAt: entry.updatedAt })
    recordAudit({ actor, action: 'inspiration.admin_updated', resourceType: 'inspiration_entry', resourceId: entry.id, metadata: { version: entry.version } })
    return dto(entry, actor.id, favoritesStore, usages, categories, true)
  }
  const rollback = (id, payload, actor) => {
    const entry = entries.find((item) => item.id === String(id))
    const revision = entry?.revisions.find((item) => item.version === payload.version)
    if (!entry || !revision) return null
    if (entry.revisions.some((item) => item.version > entry.version && ['draft', 'pending_review', 'changes_requested', 'rejected'].includes(item.status))) return null
    const nextVersion = entry.version + 1
    Object.assign(entry, revision.snapshot, { status: 'published', version: nextVersion, reviewNote: payload.note, reviewedById: actor.id, archivedAt: null, publishedAt: entry.publishedAt ?? now(), updatedAt: now() })
    entry.revisions.unshift({ id: `revision-${randomUUID()}`, version: nextVersion, status: 'published', reviewNote: payload.note, snapshot: snapshot(entry), reviewedAt: entry.updatedAt, createdAt: entry.updatedAt })
    recordAudit({ actor, action: 'inspiration.version_rolled_back', resourceType: 'inspiration_entry', resourceId: entry.id, metadata: { sourceVersion: payload.version, version: nextVersion, note: payload.note } })
    return dto(entry, actor.id, favoritesStore, usages, categories, true)
  }
  return {
    categories: () => categories.filter((item) => item.active).sort((a, b) => a.sortOrder - b.sortOrder),
    adminCategories: () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder),
    createCategory: (payload, actor) => { const category = { id: `inspiration-category-${randomUUID()}`, ...payload, active: true }; categories.push(category); recordAudit({ actor, action: 'inspiration.category_created', resourceType: 'inspiration_category', resourceId: category.id, metadata: { slug: category.slug, kind: category.kind } }); return category },
    updateCategory: (id, payload, actor) => {
      const category = categories.find((item) => item.id === String(id))
      if (!category) return null
      const { replacementCategoryId, ...data } = payload
      const referenced = entries.filter((entry) => category.kind === 'content_type'
        ? entry.categoryId === category.id
        : category.kind === 'domain'
          ? entry.domains.includes(category.slug)
          : entry.difficulty === category.slug)
      if (data.kind && data.kind !== category.kind && referenced.length > 0) return { conflict: 'replacement_invalid', referenceCount: referenced.length }
      const migrateEntry = (entry, target) => {
        if (category.kind === 'content_type') { entry.categoryId = target.id; entry.contentType = target.slug }
        if (category.kind === 'domain') entry.domains = entry.domains.map((value) => value === category.slug ? target.slug : value)
        if (category.kind === 'difficulty') entry.difficulty = target.slug
        entry.updatedAt = now()
      }
      let replacement = null
      if (data.active === false && referenced.length > 0) {
        replacement = categories.find((item) => item.id === replacementCategoryId && item.active && item.kind === category.kind)
        if (!replacement || replacement.id === category.id) return { conflict: replacementCategoryId ? 'replacement_invalid' : 'replacement_required', referenceCount: referenced.length }
        referenced.forEach((entry) => migrateEntry(entry, replacement))
      } else if (data.slug && data.slug !== category.slug) {
        referenced.forEach((entry) => migrateEntry(entry, { id: category.id, slug: data.slug }))
      }
      Object.assign(category, data)
      recordAudit({ actor, action: 'inspiration.category_updated', resourceType: 'inspiration_category', resourceId: category.id, metadata: { active: category.active, sortOrder: category.sortOrder, migratedEntries: replacement ? referenced.length : 0, replacementCategoryId: replacement?.id ?? null } })
      return category
    },
    list, find, create, updateOwn, submit, withdraw,
    mySubmissions: (options, actor) => list(options, actor, true),
    favorite,
    favorites: (options, actor) => ({ items: favoritesStore.filter((item) => item.userId === actor.id).map((favoriteItem) => { const entry = find(favoriteItem.entryId, actor); return entry ? { ...entry, favoritedAt: favoriteItem.createdAt } : null }).filter(Boolean), limit: options.limit ?? 100, nextCursor: null }),
    removeFavorites: (ids, actor) => { const before = favoritesStore.length; for (let index = favoritesStore.length - 1; index >= 0; index -= 1) if (favoritesStore[index].userId === actor.id && ids.includes(favoritesStore[index].entryId)) favoritesStore.splice(index, 1); const removed = before - favoritesStore.length; recordAudit({ actor, action: 'inspiration.favorites_bulk_removed', resourceType: 'inspiration_favorite', resourceId: actor.id, metadata: { requestedCount: ids.length, removedCount: removed } }); return { removed, ids } },
    use: (id, actor) => { const entry = find(id, actor); if (!entry) return null; usages.push({ id: `usage-${randomUUID()}`, entryId: entry.id, userId: actor.id, entryVersion: entry.version, action: 'workspace_handoff', createdAt: now() }); recordAudit({ actor, action: 'inspiration.sent_to_workspace', resourceType: 'inspiration_entry', resourceId: entry.id, metadata: { version: entry.version } }); return { item: dto(entries.find((item) => item.id === entry.id), actor.id, favoritesStore, usages, categories), workspaceDraft: { title: entry.title, seed: JSON.stringify({ problem: entry.problem, audience: entry.audience, ...entry.content }), entryId: entry.id, version: entry.version } } },
    adminList: (options, actor) => ({ items: entries.filter((entry) => !options.status || entry.status === options.status || (options.status === 'pending_review' && entry.revisions.some((revision) => revision.status === 'pending_review'))).map((entry) => dto(entry, actor.id, favoritesStore, usages, categories, true)), limit: options.limit ?? 100, nextCursor: null }),
    adminFind: (id, actor) => { const entry = entries.find((item) => item.id === String(id)); return entry ? dto(entry, actor.id, favoritesStore, usages, categories, true) : null },
    updateAdmin, review, rollback,
    setArchived: (id, actor, archived) => { const entry = entries.find((item) => item.id === String(id)); if (!entry) return null; entry.status = archived ? 'archived' : 'published'; entry.archivedAt = archived ? now() : null; entry.publishedAt = entry.publishedAt ?? now(); recordAudit({ actor, action: archived ? 'inspiration.archived' : 'inspiration.restored', resourceType: 'inspiration_entry', resourceId: entry.id }); return dto(entry, actor.id, favoritesStore, usages, categories) },
  }
}
