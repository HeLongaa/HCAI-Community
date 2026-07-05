const parsePoints = (value) => {
  const cleaned = String(value).replace(/[^\d-]/g, '')
  const parsed = Number.parseInt(cleaned, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export const serializeAccount = (account) => ({
  id: account.id,
  handle: account.handle,
  email: account.email,
  displayName: account.displayName,
  role: account.role,
  permissions: account.permissions,
  profile: account.profile,
})

export const serializeTask = (task) => ({
  id: String(task.id),
  title: task.title,
  category: task.category,
  status: task.status,
  budget: task.budget,
  deadline: task.deadline,
  proposals: task.proposals,
  description: task.description,
  publisher: task.publisher,
  assignee: task.assignee,
  requirements: task.requirements,
  attachments: task.attachments,
  privateBrief: task.privateBrief,
  submission: task.submission,
  resultLinks: task.resultLinks,
  reviewNote: task.reviewNote,
  rights: task.rights,
})

export const serializeTaskDetail = serializeTask

export const serializeTaskProposal = (proposal) => ({
  id: String(proposal.id),
  taskId: String(proposal.taskId),
  proposer: proposal.proposer,
  coverLetter: proposal.coverLetter,
  estimate: proposal.estimate ?? '',
  status: proposal.status,
  decisionNote: proposal.decisionNote ?? '',
  createdAt: proposal.createdAt ?? '',
})

export const serializeTaskSubmission = (submission) => ({
  id: String(submission.id),
  taskId: String(submission.taskId),
  submitter: submission.submitter,
  content: submission.content,
  assetIds: submission.assetIds ?? [],
  rightsNote: submission.rightsNote ?? '',
  status: submission.status,
  reviewNote: submission.reviewNote ?? '',
  acceptanceChecklist: submission.acceptanceChecklist ?? submission.metadata?.acceptanceChecklist ?? [],
  reviewedBy: submission.reviewedBy ?? null,
  reviewedAt: submission.reviewedAt ?? null,
  createdAt: submission.createdAt ?? '',
})

export const serializeMediaAsset = (asset) => ({
  id: String(asset.id),
  fileName: asset.fileName,
  storageKey: asset.storageKey,
  contentType: asset.contentType,
  sizeBytes: asset.sizeBytes,
  purpose: asset.purpose,
  status: asset.status,
  metadata: asset.metadata ?? null,
  createdAt: asset.createdAt ?? '',
  updatedAt: asset.updatedAt ?? '',
})

export const serializeNotification = (notification) => ({
  id: String(notification.id),
  type: notification.type,
  title: notification.title,
  body: notification.body,
  resourceType: notification.resourceType,
  resourceId: notification.resourceId ?? null,
  metadata: notification.metadata ?? null,
  readAt: notification.readAt ?? null,
  createdAt: notification.createdAt ?? '',
})

export const serializeAuditEvent = (event) => ({
  id: String(event.id),
  actorType: event.actorType,
  actorId: event.actorId ?? null,
  action: event.action,
  resourceType: event.resourceType,
  resourceId: event.resourceId ?? null,
  metadata: event.metadata ?? null,
  createdAt: event.createdAt?.toISOString?.() ?? event.createdAt ?? '',
})

export const serializeSecurityEvent = (event) => ({
  id: String(event.id),
  type: event.type,
  severity: event.severity,
  source: event.source,
  clientKey: event.clientKey ?? null,
  identity: event.identity ?? null,
  method: event.method ?? null,
  pathname: event.pathname ?? null,
  occurredAt: event.occurredAt?.toISOString?.() ?? event.occurredAt ?? '',
  details: event.details ?? null,
})

export const serializeSecurityAlertDispatchEvent = (event) => {
  const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
    ? event.metadata
    : {}
  return {
    id: String(event.id),
    type: event.action ?? 'security.alert.dispatch',
    severity: String(metadata.severity ?? 'warning'),
    source: 'alert_dispatch',
    clientKey: metadata.channel ? String(metadata.channel) : null,
    identity: metadata.status ? String(metadata.status) : null,
    method: null,
    pathname: metadata.alertType ? String(metadata.alertType) : event.resourceId ?? null,
    occurredAt: event.createdAt?.toISOString?.() ?? event.createdAt ?? '',
    details: metadata,
  }
}

export const serializePost = (post) => ({
  id: String(post.id),
  title: post.title,
  category: post.category,
  author: post.author,
  replies: post.replies,
  likes: parsePoints(post.likes),
  views: parsePoints(post.views),
  votes: post.votes,
  tag: post.tag,
  solved: post.solved,
  excerpt: post.excerpt,
  body: post.body,
})

export const serializePostDetail = (post) => ({
  ...serializePost(post),
  comments: post.comments ?? [],
  relatedTasks: post.relatedTasks ?? [],
  viewerPermissions: post.viewerPermissions ?? {},
})

export const serializeProfile = (profile) => ({
  handle: profile.handle,
  lane: profile.lane,
  initials: profile.initials,
  name: profile.name,
  role: profile.role,
  bio: profile.bio,
  tags: profile.tags,
  zhTags: profile.zhTags,
  categories: profile.categories,
  languages: profile.languages,
  stats: profile.stats,
  badges: profile.badges,
  portfolio: profile.portfolio,
  reviews: profile.reviews,
})

export const serializeLedgerEntry = (entry) => ({
  id: entry.id,
  occurredAtLabel: entry.occurredAtLabel,
  description: entry.description,
  delta: entry.delta,
  balanceAfter: entry.balanceAfter,
  status: entry.status,
  sourceType: entry.sourceType,
  sourceId: entry.sourceId ?? null,
  userHandle: entry.userHandle ?? null,
})

export const serializeAdminReview = (review) => ({
  id: String(review.id),
  status: review.status,
  title: review.title,
  owner: review.owner,
  note: review.note,
  queue: review.queue,
  decision: review.decision ?? undefined,
  reviewedBy: review.reviewedBy ?? null,
  reviewedAt: review.reviewedAt ?? null,
  metadata: review.metadata ?? null,
})

export const serializeLibraryItem = (item) => ({
  id: String(item.id),
  title: item.title,
  type: item.type,
  source: item.source,
  saves: item.saves,
  text: item.text,
  sourceId: item.sourceId ?? null,
  metadata: item.metadata ?? null,
})
