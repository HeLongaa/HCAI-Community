const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null)

const firstNonEmpty = (...values) => values.find((value) => value !== undefined && value !== null && value !== '')

const parsePoints = (value) => {
  const cleaned = String(value ?? '').replace(/[^\d-]/g, '')
  const parsed = Number.parseInt(cleaned, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

const parseMoney = (value) => {
  if (value && typeof value === 'object') {
    return parseMoney(value.money)
  }
  const text = String(value ?? '').trim()
  if (!text) {
    return { amount: null, currency: null }
  }
  const currencyMatch = text.match(/^[^\d]+/)
  const numeric = Number.parseFloat(text.replace(/[^\d.-]/g, ''))
  return {
    amount: Number.isFinite(numeric) ? numeric : null,
    currency: currencyMatch?.[0] ?? null,
  }
}

const makeAccountSummary = (account) => ({
  handle: account.handle,
  name: { en: account.displayName ?? account.handle, zh: account.displayName ?? account.handle },
  role: { en: account.role ?? 'member', zh: account.role ?? 'member' },
  lane: account.profile?.lane ?? 'both',
  initials: String(account.displayName ?? account.handle).slice(0, 2).toUpperCase(),
})

const taskStatusLabel = {
  draft: 'Draft',
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  submitted: 'Submitted',
  pending_review: 'Pending Review',
  disputed: 'Disputed',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

const taskStatusValue = {
  Draft: 'draft',
  Open: 'open',
  Assigned: 'assigned',
  'In Progress': 'in_progress',
  Submitted: 'submitted',
  'Pending Review': 'pending_review',
  Disputed: 'disputed',
  Completed: 'completed',
  Rejected: 'rejected',
  Cancelled: 'cancelled',
  draft: 'draft',
  open: 'open',
  assigned: 'assigned',
  in_progress: 'in_progress',
  submitted: 'submitted',
  pending_review: 'pending_review',
  disputed: 'disputed',
  completed: 'completed',
  rejected: 'rejected',
  cancelled: 'cancelled',
}

const buildProfileSummary = (profile) => {
  const metadata = asObject(profile?.metadata)
  const user = profile?.user ?? null
  const displayName = String(firstNonEmpty(metadata?.name?.en, user?.displayName, profile?.handle, user?.id, 'User'))
  const role = firstNonEmpty(metadata?.role, user?.role ? { en: user.role, zh: user.role } : null, {
    en: 'Member',
    zh: '成员',
  })
  return {
    handle: profile?.handle ?? user?.id ?? '',
    name: metadata?.name ?? { en: displayName, zh: displayName },
    role,
    lane: profile?.lane ?? metadata?.lane ?? 'both',
    initials: metadata?.initials ?? displayName.slice(0, 2).toUpperCase(),
  }
}

const buildFallbackProfile = (profile) => ({
  handle: profile.handle,
  lane: profile.lane,
  initials: profile.handle.slice(0, 2).toUpperCase(),
  name: { en: profile.handle, zh: profile.handle },
  role: { en: 'Member', zh: '成员' },
  bio: '',
  tags: [],
  zhTags: [],
  categories: [],
  languages: [],
  stats: {},
  badges: [],
  portfolio: [],
  reviews: [],
})

export const getCommentDto = (comment) => ({
  id: comment.id,
  body: comment.body,
  author: comment.author ? buildProfileSummary(comment.author.profile ? comment.author.profile : comment.author) : null,
  parentId: comment.parentId ?? null,
  createdAt: comment.createdAt ? comment.createdAt.toISOString() : '',
})

export const getTaskDto = (task) => {
  const metadata = asObject(task.metadata)
  if (metadata) {
    return metadata
  }
  const publisher = task.publisher ? buildProfileSummary(task.publisher.profile ? task.publisher.profile : task.publisher) : null
  const assignee = task.assignee ? buildProfileSummary(task.assignee.profile ? task.assignee.profile : task.assignee) : null
  return {
    id: task.id,
    title: task.title,
    category: task.category,
    budget: {
      money: task.rewardCurrency ? `${task.rewardCurrency}${task.rewardAmount ?? ''}` : String(task.rewardAmount ?? ''),
      points: task.pointsReward,
    },
    status: taskStatusLabel[task.status] ?? task.status,
    deadline: task.deadlineAt ? task.deadlineAt.toISOString() : '',
    proposals: 0,
    description: task.description,
    publisher,
    assignee,
    requirements: [],
    attachments: [],
    privateBrief: '',
    submission: '',
    resultLinks: [],
    reviewNote: '',
    rights: '',
  }
}

export const getTaskProposalDto = (proposal) => ({
  id: proposal.id,
  taskId: proposal.taskId,
  proposer: proposal.proposer ? buildUserSummary(proposal.proposer) : null,
  coverLetter: proposal.coverLetter,
  estimate: proposal.estimate ?? '',
  status: proposal.status,
  decisionNote: asObject(proposal.metadata)?.decisionNote ?? '',
  createdAt: proposal.createdAt ? proposal.createdAt.toISOString() : '',
})

export const getTaskSubmissionDto = (submission) => ({
  id: submission.id,
  taskId: submission.taskId,
  submitter: submission.submitter ? buildUserSummary(submission.submitter) : null,
  content: submission.content,
  assetIds: submission.assetIds ?? [],
  rightsNote: submission.rightsNote ?? '',
  status: submission.status,
  reviewNote: submission.reviewNote ?? '',
  acceptanceChecklist: asObject(submission.metadata)?.acceptanceChecklist ?? [],
  dispute: asObject(submission.metadata)?.dispute ?? null,
  stale: asObject(submission.metadata)?.stale ?? null,
  reviewedBy: submission.reviewedBy ? buildUserSummary(submission.reviewedBy) : null,
  reviewedAt: submission.reviewedAt ? submission.reviewedAt.toISOString() : null,
  createdAt: submission.createdAt ? submission.createdAt.toISOString() : '',
})

export const getMediaAssetDto = (asset) => ({
  id: asset.id,
  fileName: asset.fileName,
  storageKey: asset.storageKey,
  contentType: asset.contentType,
  sizeBytes: asset.sizeBytes,
  purpose: asset.purpose,
  status: asset.status,
  metadata: asset.metadata ?? null,
  createdAt: asset.createdAt ? asset.createdAt.toISOString() : '',
  updatedAt: asset.updatedAt ? asset.updatedAt.toISOString() : '',
})

export const getCreativeGenerationDto = (generation) => ({
  id: generation.id,
  actorId: generation.actorId ?? null,
  actorHandle: generation.actorHandle ?? null,
  workspace: generation.workspace,
  mode: generation.mode,
  providerId: generation.providerId,
  providerMode: generation.providerMode ?? null,
  status: generation.status,
  promptHash: generation.promptHash,
  promptPreview: generation.promptPreview ?? null,
  inputAssetIds: generation.inputAssetIds ?? [],
  parameterKeys: generation.parameterKeys ?? [],
  outputAssetIds: generation.outputAssetIds ?? [],
  usage: generation.usage ?? null,
  credit: generation.credit ?? null,
  quota: generation.quota ?? null,
  safety: generation.safety ?? null,
  policy: generation.policy ?? null,
  providerRequestId: generation.providerRequestId ?? null,
  providerJobId: generation.providerJobId ?? null,
  errorCode: generation.errorCode ?? null,
  errorMessagePreview: generation.errorMessagePreview ?? null,
  startedAt: generation.startedAt ? generation.startedAt.toISOString() : null,
  completedAt: generation.completedAt ? generation.completedAt.toISOString() : null,
  failedAt: generation.failedAt ? generation.failedAt.toISOString() : null,
  createdAt: generation.createdAt ? generation.createdAt.toISOString() : '',
  updatedAt: generation.updatedAt ? generation.updatedAt.toISOString() : '',
})

export const getMediaScanJobDto = (job) => ({
  id: job.id,
  assetId: job.assetId,
  provider: job.provider,
  status: job.status,
  scanStatus: job.scanStatus,
  externalScanId: job.externalScanId ?? null,
  attempts: job.attempts,
  requestedAt: job.requestedAt ? job.requestedAt.toISOString() : null,
  timeoutAt: job.timeoutAt ? job.timeoutAt.toISOString() : null,
  nextRetryAt: job.nextRetryAt ? job.nextRetryAt.toISOString() : null,
  callbackAt: job.callbackAt ? job.callbackAt.toISOString() : null,
  failedAt: job.failedAt ? job.failedAt.toISOString() : null,
  reviewedById: job.reviewedById ?? null,
  reviewedAt: job.reviewedAt ? job.reviewedAt.toISOString() : null,
  note: job.note ?? null,
  rejectionReason: job.rejectionReason ?? null,
  metadata: job.metadata ?? null,
  createdAt: job.createdAt ? job.createdAt.toISOString() : '',
  updatedAt: job.updatedAt ? job.updatedAt.toISOString() : '',
})

export const getNotificationDto = (notification) => ({
  id: notification.id,
  type: notification.type,
  title: notification.title,
  body: notification.body,
  resourceType: notification.resourceType,
  resourceId: notification.resourceId ?? null,
  metadata: notification.metadata ?? null,
  readAt: notification.readAt ? notification.readAt.toISOString() : null,
  createdAt: notification.createdAt ? notification.createdAt.toISOString() : '',
})

export const getPostDto = (post) => {
  const metadata = asObject(post.metadata)
  return {
    ...(metadata ?? {}),
    id: post.id,
    title: post.title,
    category: post.category,
    author: (metadata?.author ?? (post.author ? buildProfileSummary(post.author.profile ? post.author.profile : post.author) : null)),
    replies: metadata?.replies ?? 0,
    likes: post.likesCount,
    views: post.viewsCount,
    votes: metadata?.votes ?? 0,
    tag: metadata?.tag ?? '',
    solved: post.solved,
    excerpt: metadata?.excerpt ?? '',
    body: post.body,
  }
}

export const getPostDetailDto = (post, viewer = null) => {
  const base = getPostDto(post)
  const metadata = asObject(post.metadata) ?? {}
  const canModerate = Array.isArray(viewer?.permissions) && viewer.permissions.includes('post:moderate')
  return {
    ...base,
    comments: (post.comments ?? []).map(getCommentDto),
    relatedTasks: metadata.relatedTasks ?? [],
    viewerPermissions: metadata.viewerPermissions ?? {
      canComment: Boolean(viewer),
      canLike: Boolean(viewer),
      canConvertToTask: Boolean(viewer),
      canModerate,
    },
  }
}

export const getProfileDto = (profile) => {
  const metadata = asObject(profile.metadata)
  if (metadata) {
    return metadata
  }
  return buildFallbackProfile(profile)
}

export const getLedgerDto = (entry) => ({
  id: entry.id,
  occurredAtLabel: entry.occurredAtLabel ?? '',
  description: entry.description ?? '',
  delta: entry.delta,
  balanceAfter: entry.balanceAfter,
  status: entry.status,
  sourceType: entry.sourceType,
  sourceId: entry.sourceId ?? null,
  userHandle: entry.user?.profile?.handle ?? null,
})

export const getAdminReviewDto = (review) => {
  const reviewerHandle = review.reviewedBy?.profile?.handle ?? review.reviewedBy?.id ?? null
  return {
    id: review.id,
    status: review.status,
    title: review.title,
    owner: review.owner,
    note: review.note,
    queue: review.queue,
    decision: review.decision ?? undefined,
    reviewedBy: reviewerHandle,
    reviewedAt: review.reviewedAt ? review.reviewedAt.toISOString() : null,
    metadata: review.metadata ?? null,
  }
}

export const buildAdminReviewRecord = (review) => ({
  id: review.id,
  queue: review.queue,
  status: review.status,
  title: review.title,
  owner: review.owner,
  note: review.note,
  decision: review.decision ?? null,
  metadata: review.metadata ?? null,
})

export const buildTaskRecord = (task, publisher, assignee) => {
  const money = parseMoney(task.budget)
  return {
    id: String(task.id),
    title: task.title,
    category: task.category,
    description: task.description,
    acceptanceRules: task.requirements?.[0] ?? task.reviewNote ?? task.rights ?? task.description,
    rewardAmount: money.amount == null ? null : String(money.amount),
    rewardCurrency: money.currency,
    pointsReward: parsePoints(task.points ?? task.budget?.points),
    status: taskStatusValue[task.status] ?? 'open',
    publisherId: publisher.id,
    assigneeId: assignee?.id ?? null,
    visibility: task.status === 'Open' || task.status === 'open' ? 'public' : 'community',
    deadlineAt: null,
    metadata: task,
  }
}

export const buildPostRecord = (post, author) => ({
  id: String(post.id),
  authorId: author.id,
  title: post.title,
  body: post.body ?? post.excerpt,
  category: post.category,
  tag: post.tag,
  solved: Boolean(post.solved),
  viewsCount: parsePoints(post.views),
  likesCount: parsePoints(post.likes),
  metadata: post,
})

export const buildPostCommentRecord = (comment, post, author, parent = null) => ({
  id: String(comment.id),
  postId: String(post.id),
  authorId: author.id,
  parentId: parent ? String(parent.id) : null,
  body: comment.body,
})

export const buildPostLikeRecord = (post, user, id) => ({
  id,
  postId: String(post.id),
  userId: user.id,
})

export const buildLibraryItemRecord = (item, user) => ({
  id: item.id ?? `library-${Date.now()}`,
  userId: user.id,
  sourceType: item.sourceType,
  sourceId: item.sourceId ?? null,
  title: item.title,
  content: item.content,
  metadata: item.metadata ?? null,
})

export const buildAuditRecord = ({ actorType, actorId = null, action, resourceType, resourceId = null, metadata = null }) => ({
  actorType,
  actorId,
  action,
  resourceType,
  resourceId,
  metadata,
})

export const buildProfileRecord = (profile, user) => ({
  userId: user.id,
  handle: profile.handle,
  bio: typeof profile.bio === 'string' ? profile.bio : profile.bio?.en ?? null,
  lane: profile.lane,
  skills: profile.tags ?? [],
  languages: profile.languages ?? [],
  portfolio: profile.portfolio ?? null,
  stats: profile.stats ?? null,
  metadata: profile,
})

export const buildLedgerRecord = (entry, user, index) => ({
  id: `ledger-${String(index + 1).padStart(3, '0')}`,
  userId: user.id,
  sourceType: 'community',
  sourceId: null,
  delta: parsePoints(entry[2]),
  balanceAfter: parsePoints(entry[3]),
  status: 'settled',
  description: entry[1],
  occurredAtLabel: entry[0],
})

export const buildUserSummary = (row) => {
  if (!row) {
    return null
  }
  const profile = row.profile ? buildProfileSummary(row.profile) : null
  if (profile) {
    return profile
  }
  const displayName = String(firstNonEmpty(row.displayName, row.profile?.handle, row.email, row.id, 'User'))
  return {
    handle: row.id,
    name: { en: displayName, zh: displayName },
    role: { en: row.role ?? 'member', zh: row.role ?? 'member' },
    lane: 'both',
    initials: displayName.slice(0, 2).toUpperCase(),
  }
}

export const parseTaskStatus = (status) => taskStatusValue[status] ?? 'open'

export const parseTaskVisibility = (status) => (status === 'Open' ? 'public' : 'community')

export const getParsedMoney = parseMoney
export const buildAccountSummary = makeAccountSummary

export const buildTaskViewModel = ({
  id,
  title,
  category,
  status,
  budget,
  deadline,
  pointsReward = 0,
  proposals = 0,
  description,
  publisher,
  assignee = null,
  requirements = [],
  attachments = [],
  privateBrief = '',
  submission = '',
  resultLinks = [],
  reviewNote = '',
  rights = '',
}) => ({
  id: String(id),
  title,
  category,
  status,
  budget,
  deadline,
  pointsReward,
  proposals,
  description,
  publisher,
  assignee,
  requirements,
  attachments,
  privateBrief,
  submission,
  resultLinks,
  reviewNote,
  rights,
})

export const taskStatusToLabel = (status) => taskStatusLabel[status] ?? status
export const taskStatusFromLabel = (status) => taskStatusValue[status] ?? 'open'
