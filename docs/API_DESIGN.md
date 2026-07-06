# API Design

Base path: `/api`

All responses use the same envelope:

```ts
type ApiResponse<T> = {
  data: T
  meta?: {
    requestId?: string
    pagination?: {
      cursor?: string
      nextCursor?: string
      limit: number
    }
  }
  error?: {
    code: string
    message: string
    details?: unknown
  }
}
```

## Auth

### `POST /auth/login`

Body:

```ts
{
  provider: 'email' | 'google' | 'apple' | 'wechat'
  email?: string
  password?: string
  oauthCode?: string
}
```

Returns:

```ts
{
  accessToken: string
  refreshToken: string
  user: UserDto
}
```

### `POST /auth/refresh`

Body:

```ts
{ refreshToken: string }
```

### `POST /auth/logout`

Requires auth. Revokes refresh token.

### `GET /me`

Requires auth. Returns current user, role, permissions, and profile summary.

## Users And Profiles

### `GET /profiles/:handle`

Public. Returns public profile, portfolio, badges, stats, and public reviews.

### `PATCH /profiles/me`

Requires auth. Updates current user's profile.

### `GET /profiles/rankings`

Query:

```ts
{
  lane?: 'maker' | 'publisher' | 'both'
  category?: string
  limit?: number
}
```

## Tasks

### `GET /tasks`

Query:

```ts
{
  status?: TaskStatus
  category?: string
  search?: string
  cursor?: string
  limit?: number
}
```

Returns task cards plus publisher summary.

### `POST /tasks`

Requires `task:create`.

Body:

```ts
{
  title: string
  category: string
  rewardAmount?: number
  rewardCurrency?: string
  pointsReward: number
  deadlineAt?: string
  visibility: 'public' | 'community' | 'invite_only'
  description: string
  acceptanceRules: string
  attachmentIds?: string[]
}
```

### `GET /tasks/:id`

Returns full task detail, proposal summary, submission state, and permissions for current user.

### `POST /tasks/:id/proposals`

Requires `task:propose`.

Body:

```ts
{
  coverLetter: string
  estimate?: string
}
```

### `GET /tasks/:id/proposals`

Requires auth. Publishers and admins can read all proposals for the task; proposers can read their own proposals. Supports `cursor` and `limit`.

### `POST /tasks/:id/proposals/:proposalId/actions`

Requires `task:review`. Publishers and admins can accept or reject a proposal. Accepting a proposal assigns the task to the proposer and moves the task to `In Progress`.

Body:

```ts
{
  decision: 'accept' | 'reject'
  note?: string
}
```

### `POST /tasks/:id/claim`

Requires `task:claim`. Directly assigns a task when no proposal approval is required.

### `POST /tasks/:id/submissions`

Requires `task:submit`.

Body:

```ts
{
  content: string
  assetIds: string[]
  rightsNote: string
}
```

### `GET /tasks/:id/submissions`

Requires auth. Publishers, assignees, and admins can read normalized submission records. Supports `cursor` and `limit`.

### `POST /tasks/:id/review`

Requires `task:review`.

Body:

```ts
{
  decision: 'approve' | 'reject' | 'request_changes'
  reviewNote: string
  acceptanceChecklist?: Array<{ label: string; checked: boolean }>
}
```

Approving a task requires every supplied acceptance checklist item to be checked, updates the latest pending submission, writes a settled point ledger entry for the assignee or latest submitter, and increments creator/publisher reputation stats once for the completion.

### `POST /tasks/:id/disputes`

Requires `task:submit`. The submitter can dispute the latest rejected or stale submission. The task moves to `Disputed`, the submission moves to `disputed`, an admin review is opened in the `task_disputes` queue, and the task timeline records `task.dispute.opened`.

Body:

```ts
{
  reason: string
}
```

### `POST /tasks/stale-submissions/sweep`

Requires `task:moderate`. Marks pending-review submissions older than `olderThanHours` as `stale`, notifies task participants, and writes `task.submission.stale` timeline events. `taskId` can scope the sweep to a single task.

Body:

```ts
{
  olderThanHours?: number // default 72
  limit?: number // default 50, max 100
  taskId?: string | null
}
```

### `GET /tasks/:id/events`

Requires task participant or admin permission. Returns task audit timeline.

## Community

### `GET /posts`

Query:

```ts
{
  sort?: 'hot' | 'new' | 'unanswered' | 'solved'
  category?: string
  tag?: string
  cursor?: string
  limit?: number
}
```

### `POST /posts`

Requires `post:create`.

### `GET /posts/:id`

Returns post detail, comments, related tasks, and viewer permissions.

### `POST /posts/:id/comments`

Requires `comment:create`.

### `POST /posts/:id/like`

Requires auth. Idempotently likes the post.

### `DELETE /posts/:id/like`

Requires auth. Removes current user's like.

### `POST /posts/:id/convert-to-task`

Requires `task:create`.

Body:

```ts
{
  rewardAmount?: number
  pointsReward: number
  deadlineAt?: string
  acceptanceRules: string
}
```

## Library

### `GET /library`

Requires auth. Returns saved inspirations.

### `POST /library/items`

Requires auth. Saves a post, prompt, tutorial, template, or external item.

### `POST /library/items/:id/convert-to-task`

Requires `task:create`.

### `POST /library/items/:id/send-to-workspace`

Requires auth. Creates a workspace draft from a library item.

## Points

### `GET /points/balance`

Requires auth.

### `GET /points/ledger`

Requires `points:read`.

Query:

```ts
{
  status?: 'pending' | 'settled' | 'cancelled'
  userHandle?: string // requires points:adjust when querying another user
  cursor?: string
  limit?: number
}
```

Returns `meta.summary` with available, frozen, pending settlement, projected balance, and lifetime totals.

## Creative Generation

### `GET /creative/providers`

Requires auth-compatible public access. Returns safe creative provider capability metadata without secrets.

### `POST /creative/generations`

Requires auth. Executes the mock provider path, applies moderation/review policy, reserves quota, reserves creative credits, persists generated outputs as media assets, commits quota, settles credits, and returns a safe generation response. Provider or media persistence failure releases quota and refunds the credit reservation.

The response includes:

```ts
{
  usage: { estimatedCredits: number; providerCostCents: number; currency: 'credits' }
  quota: { reservationId: string; reserved: number; used: number; released: number; remaining: number }
  credit: { ledgerId: string; status: 'settled' | 'refunded' | 'reserved' | 'cancelled'; reserved: number; settled: number; refunded: number }
  generationRecord: { id: string; promptHash: string; promptPreview: string | null; credit?: object; quota?: object }
}
```

Moderation-blocked and quota-exceeded requests do not reserve credits or create provider work.

### `GET /admin/creative/generations`

Requires `admin:audit:read`. Returns read-only creative generation history for operators. Supports `userHandle`/`actorHandle`, `workspace`, `mode`, `providerId`, `status`, `reviewRequired`, `mediaAssetId`, `dateFrom`, `dateTo`, `cursor`, and `limit` filters. The response uses the safe durable generation record shape: prompt hash/preview only, no raw prompt.

### `GET /admin/creative/generations/:id`

Requires `admin:audit:read`. Returns a single safe creative generation record with linked `outputAssetIds`, `usage`, `quota`, `credit`, `safety`, and `policy` metadata. This endpoint is read-only; retry, cancel, force-review, and refund controls remain out of scope.

### `POST /points/redemptions`

Requires auth. Creates a redemption request.

## Admin

### `GET /admin/security/events`

Requires `admin:audit:read`. Returns recent security events from rate limits, request body rejections, and failed-login anomaly detection. Prisma-backed deployments read from the durable `security_events` table; local/test deployments fall back to the in-process collector capped by `SECURITY_EVENT_MAX_ITEMS`. Supports cursor pagination plus optional `type`, `source`, and `severity` filters.

### `GET /admin/security/alerts`

Requires `admin:audit:read`. Returns aggregated security event alerts for rate-limit spikes, oversized request rejection spikes, failed-login anomaly spikes, and security alert delivery failure spikes. `SECURITY_ALERT_WINDOW_MINUTES` controls the lookback window. Thresholds default to `SECURITY_ALERT_RATE_LIMIT_THRESHOLD=10`, `SECURITY_ALERT_BODY_REJECTED_THRESHOLD=5`, `SECURITY_ALERT_AUTH_FAILURE_THRESHOLD=1`, and `SECURITY_ALERT_DELIVERY_FAILURE_THRESHOLD=3`. Prisma-backed deployments create deduped `security.event.alert` station notifications for audit readers and can fan out new alerts through `SECURITY_ALERT_WEBHOOK_*`, `SECURITY_ALERT_SLACK_*`, and `SECURITY_ALERT_EMAIL_*` channels. Delivery attempts are audited as `security.alert.dispatch`; failed attempts are aggregated into `security.alert.delivery_failed.spike` so channel outages surface in the same Admin Security workflow.

Alert disposition is derived from `security_alert` audit events. Acknowledged alerts remain visible for tracking. Silenced alerts remain visible with `state='silenced'` and suppress new station notifications and external fan-out until the silence expires or is removed. Read and export endpoints require `admin:audit:read`; disposition endpoints require `security:alerts:manage`.

### `GET /admin/security/alerts/:id/events`

Requires `admin:audit:read`. Returns recent `AdminSecurityEventDto[]` samples matching the alert source within the configured security alert window. For `security.alert.delivery_failed.spike`, samples are normalized from failed `security.alert.dispatch` audit events with `source='alert_dispatch'`.

### `GET /admin/security/alerts/:id/export`

Requires `admin:audit:read`. Returns a JSON incident handoff artifact with `{ exportedAt, alert, events, auditEvents }`, where `events` contains recent matching `AdminSecurityEventDto` samples and `auditEvents` contains `security.alert.*` / `security.alert.dispatch` records for the alert.

### `POST /admin/security/alerts/:id/acknowledge`

Requires `security:alerts:manage`. Records `security.alert.acknowledged` and returns the updated alert.

Body:

```ts
{
  note?: string
}
```

### `POST /admin/security/alerts/:id/silence`

Requires `security:alerts:manage`. Records `security.alert.silenced`, returns the updated alert, and suppresses new notifications for the alert until `until`. If `until` is omitted the server defaults to a 24-hour silence.

Body:

```ts
{
  until?: string
  note?: string
}
```

### `POST /admin/security/alerts/:id/unsilence`

Requires `security:alerts:manage`. Records `security.alert.unsilenced` and returns the updated alert.

Body:

```ts
{
  note?: string
}
```

### `GET /admin/operations/metrics`

Requires `admin:audit:read`. Returns a lightweight operations metrics summary for a recent time window. `windowMinutes` defaults to `60` and must be between `5` and `1440`.

The response includes security event totals by source/severity, current security alert totals by type/state, security alert disposition counts and best-effort acknowledgement latency, security alert delivery failures by channel/status, scan history archive candidate counts, archive write totals/bytes/provider counts, scan history prune totals, and media scan alert delivery failures.

### `GET /admin/operations/metrics/export`

Requires `admin:audit:read`. Returns a JSON operations handoff artifact with `kind='admin.operations.metrics.snapshot'`, the selected metrics window, the current metrics summary, recent dispatch/archive/prune audit samples, server-generated handoff remediation hints, and audit drill-down filters. The export records `admin.operations.metrics_exported` on `operations_metrics` with metadata for `windowMinutes`, per-sample counts, hint count, and export time.

### `GET /admin/points/ledger`

Requires `points:adjust`.

Query:

```ts
{
  userHandle?: string
  status?: 'pending' | 'settled' | 'cancelled'
  search?: string
  cursor?: string
  limit?: number // 1..100, default 20
}
```

Returns filtered ledger entries and `meta.summary`.

### `GET /admin/points/ledger.csv`

Requires `points:adjust`. Uses the same filters as `/admin/points/ledger` and returns `text/csv`.

### `POST /admin/points/adjustments`

Requires `points:adjust`.

Body:

```ts
{
  userHandle: string
  delta: number // non-zero integer, abs <= 1_000_000
  reason: string
  reasonCode?: string | null
}
```

Creates a settled `manual_adjustment` ledger entry and writes an audit event.

If `Math.abs(delta)` is greater than the actor's direct adjustment limit, the API creates an `admin_reviews` item in the `points` queue instead of immediately settling the ledger. Review metadata includes requester, reason code, balance before, projected balance, and threshold. `POINT_ADJUSTMENT_REVIEW_THRESHOLD` sets the default admin direct limit, and `POINT_ADJUSTMENT_DIRECT_LIMITS` can override role limits with a comma-separated map such as `admin:5000,moderator:1000`. Approving that review creates the settled `manual_adjustment` ledger entry with the review id as `sourceId`; rejecting it leaves the ledger unchanged. Points queue reviews require both `admin:queue:review` and `points:adjust`, and the original requester cannot approve their own point adjustment.

Response:

```ts
{
  status: 'applied' | 'pending_review'
  threshold: number
  entry: ApiLedgerEntry | null
  review: AdminReviewQueueItemDto | null
}
```

### `GET /admin/points/policy`

Requires `points:adjust`.

Returns the active point adjustment policy:

```ts
{
  roleLimits: Record<'member' | 'creator' | 'publisher' | 'moderator' | 'admin', number>
  reasonCodes: string[]
  approvalTemplates: string[]
}
```

### `PUT /admin/points/policy`

Requires `admin:permissions:manage`.

Updates the persisted point adjustment policy and writes a `points.policy.updated` audit event.

### `GET /admin/points/policy/history`

Requires `points:adjust`.

Returns recent `points.policy.updated` and `points.policy.rolled_back` events with `previous`, `next`, `diff`, and a human-readable `summary`.

### `POST /admin/points/policy/rollback`

Requires `admin:permissions:manage`.

Body:

```ts
{
  eventId: string
}
```

Restores the policy to the selected history event's `previous` value and writes a `points.policy.rolled_back` audit event.

### `GET /notifications`

Requires authentication.

Query:

```ts
{
  readState?: 'unread' | 'read' | 'all'
  unreadOnly?: boolean // legacy alias for readState='unread'
  type?: string
  resourceType?: string
  cursor?: string
  limit?: number
}
```

Returns the current user's notification inbox. Current notification producers cover task proposal submission/acceptance/rejection, submission/resubmission, revision requests, submission approval/rejection, reward settlement, stale submissions, dispute open/receipt, high-value point adjustment requests, point adjustment approval/rejection results, point policy rollback events, media scan manual-review requests, media scan rejections, media scan retry requests, scanner health alerts, and security alerts.

Notification `metadata.target` can carry a client deep link:

```ts
{
  page: 'admin' | 'mine' | 'points'
  admin?: {
    tab?: 'Task review' | 'Finance'
    queue?: string
    reviewId?: string
    ledgerUserHandle?: string
    policyHistoryEventId?: string
    mediaStatus?: 'pending' | 'scanning' | 'review' | 'clean' | 'rejected' | 'all'
    mediaAssetId?: string
  }
}
```

### `POST /notifications/:id/read`

Requires authentication. Marks one notification as read. The repository enforces recipient ownership and returns `404` when the notification does not belong to the actor.

### `POST /notifications/read-all`

Requires authentication. Marks every unread notification owned by the current user as read and returns:

```ts
{
  updated: number
}
```

### `GET /admin/permissions`

Requires `admin:audit:read`.

Returns the permission catalog:

```ts
Array<{
  id: string
  description?: string | null
}>
```

### `GET /admin/roles`

Requires `admin:audit:read`.

Returns the current role permission matrix:

```ts
Array<{
  role: 'member' | 'creator' | 'publisher' | 'moderator' | 'admin'
  permissions: string[]
}>
```

### `PUT /admin/roles/:role/permissions`

Requires `admin:permissions:manage`.

Body:

```ts
{
  permissions: string[]
}
```

Returns the updated role permission row and writes an audit event.

### `GET /admin/reviews`

Requires `admin:queue:read`.

Query:

```ts
{
  queue?: 'tasks' | 'submissions' | 'community' | 'reports' | 'users'
  status?: string
  cursor?: string
  limit?: number // 1..100, default 20
}
```

Pagination uses cursor-as-last-id. When `meta.pagination.nextCursor` is present, pass it as `cursor` to read the next page.

### `POST /admin/reviews/:id/actions`

Requires `admin:queue:review`.

Body:

```ts
{
  decision: 'approve' | 'reject'
  note?: string
}
```

### `POST /admin/tasks/:id/reject`

Requires `admin:queue:review` and task moderation authority.

### `POST /admin/posts/:id/moderate`

Requires `post:moderate`.

### `POST /admin/users/:id/status`

Requires `user:moderate`.

## Media

### `POST /media/uploads`

Requires auth. Creates a signed upload URL.

Body:

```ts
{
  fileName: string
  contentType: string
  sizeBytes: number
  purpose: 'task_attachment' | 'submission_asset' | 'profile_portfolio' | 'library_asset'
  metadata?: Record<string, unknown>
}
```

Returns a persisted pending asset plus a mock signed upload contract:

```ts
{
  asset: MediaAssetDto
  upload: {
    method: 'PUT'
    url: string
    headers: Record<string, string>
    expiresAt: string
  }
}
```

### `GET /media/review-queue`

Requires `admin:queue:read`. Lists media assets by scan governance state for operations review.

Query:

```ts
{
  status?: 'pending' | 'scanning' | 'review' | 'clean' | 'rejected' | 'all' // default: 'review'
  purpose?: 'task_attachment' | 'submission_asset' | 'profile_portfolio' | 'library_asset'
  search?: string
  cursor?: string
  limit?: number
}
```

Returns `MediaAssetDto[]` with pagination metadata. Scan state is exposed under `asset.metadata.security.scanStatus`; Prisma-backed deployments project the latest durable `media_scan_jobs` row into this compatibility field.

### `GET /media/scan-jobs`

Requires `admin:queue:read`. Lists scanner job health for assets that have asynchronous scan records. Prisma-backed deployments read durable `media_scan_jobs` rows and return the associated `MediaAssetDto` with the latest job projected into `metadata.security`.

Query:

```ts
{
  status?: 'active' | 'queued' | 'retrying' | 'timed_out' | 'completed' | 'failed' | 'all' // default: 'active'
  purpose?: 'task_attachment' | 'submission_asset' | 'profile_portfolio' | 'library_asset'
  search?: string
  cursor?: string
  limit?: number
}
```

`active` includes `queued`, `retrying`, and derived `timed_out` jobs. In Prisma-backed mode, `timed_out` is derived from `media_scan_jobs.timeout_at`; the seed/demo repository derives the same status from `metadata.security.scanTimeoutAt`.

### `GET /media/governance-config`

Requires `admin:queue:read`. Returns a safe media governance configuration projection for Admin UI inspection. URLs, secrets, signatures, access keys, and bucket names are not returned.

```ts
{
  storage: {
    driver: string
  }
  scanner: {
    provider: string
    requestAdapter: string
    requestDispatchConfigured: boolean
    requestSigningConfigured: boolean
    requestTimeoutSeconds: number
    callbackBaseConfigured: boolean
    webhookSecretConfigured: boolean
    callbackSignatureConfigured: boolean
    callbackSignatureToleranceSeconds: number
    retryDelaySeconds: number
    timeoutSeconds: number
    maxAttempts: number
    workerEnabled: boolean
    workerIntervalSeconds: number
  }
  retention: {
    historyRetentionDays: number
    historyRetentionMaxPerAsset: number
  }
  alerts: {
    windowMinutes: number
    thresholds: {
      callbackDenied: number
      dispatchFailed: number
      timeout: number
      alertDeliveryFailed: number
    }
    channels: {
      webhook: { configured: boolean; signed: boolean; timeoutSeconds: number }
      slack: { configured: boolean; timeoutSeconds: number }
      email: { configured: boolean; signed: boolean; recipientCount: number; fromConfigured: boolean; timeoutSeconds: number }
    }
  }
}
```

### `PUT /media/governance-policy`

Requires `admin:permissions:manage`. Persists editable numeric media governance policy overrides in `system_settings.media_governance_policy` and returns the same safe configuration projection as `GET /media/governance-config`. Env vars remain the fallback for omitted values. This endpoint does not accept deployment secrets, URLs, buckets, or access keys.

The effective policy is used at runtime for scanner alert windows and thresholds, scan sweep maximum attempts, and scan job history retention. Scan request creation still reads provider timeout/retry dispatch settings from deployment env vars so the scanner adapter remains independent from database access.

```ts
{
  scanner?: {
    retryDelaySeconds?: number
    timeoutSeconds?: number
    maxAttempts?: number
    workerIntervalSeconds?: number
  }
  retention?: {
    historyRetentionDays?: number
    historyRetentionMaxPerAsset?: number
  }
  alerts?: {
    windowMinutes?: number
    thresholds?: {
      callbackDenied?: number
      dispatchFailed?: number
      timeout?: number
      alertDeliveryFailed?: number
    }
  }
}
```

### `GET /media/governance-policy/history`

Requires `admin:queue:read`. Returns recent `media.governance_policy.updated` and `media.governance_policy.rolled_back` events with `previous`, `next`, `diff`, and a human-readable `summary`.

### `POST /media/governance-policy/rollback`

Requires `admin:permissions:manage`.

```ts
{
  eventId: string
}
```

Restores the policy to the selected history event's `previous` value, writes a `media.governance_policy.rolled_back` audit event, and returns the safe media governance configuration projection.

### `GET /media/scan-alerts`

Requires `admin:queue:read`. Returns scanner health alerts when recent signals cross configured thresholds. The default window is `MEDIA_SCAN_ALERT_WINDOW_MINUTES=60`; thresholds default to `MEDIA_SCAN_CALLBACK_DENIED_ALERT_THRESHOLD=3`, `MEDIA_SCAN_DISPATCH_FAILED_ALERT_THRESHOLD=3`, `MEDIA_SCAN_TIMEOUT_ALERT_THRESHOLD=2`, and `MEDIA_SCAN_ALERT_DELIVERY_FAILED_ALERT_THRESHOLD=2`.

```ts
Array<{
  id: string
  type: 'media.scan.callback_denied.spike' | 'media.scan.dispatch_failed.spike' | 'media.scan.timeout.spike' | 'media.scan.alert_delivery_failed.spike'
  state: 'active' | 'acknowledged' | 'silenced'
  severity: 'warning' | 'critical'
  title: string
  summary: string
  count: number
  threshold: number
  windowMinutes: number
  resourceType: 'media_asset'
  resourceId: string | null
  metadata: Record<string, unknown>
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  acknowledgementNote: string | null
  silencedUntil: string | null
  silencedBy: string | null
  silenceNote: string | null
  createdAt: string
}>
```

Alert disposition is derived from `media_scan_alert` audit events. Acknowledged alerts remain visible for tracking. Silenced alerts remain visible with `state='silenced'` and suppress new station notifications and external fan-out until the silence expires or is removed.

### `GET /media/scan-alerts/:id/events`

Requires `admin:queue:read`. Returns up to five recent samples that contributed to the alert. Audit-backed alerts return audit events directly; scanner dispatch failures return the same shape as synthesized `media.scan.dispatch_failed` samples without secret material.

```ts
Array<{
  id: string
  actorType: 'user' | 'system'
  actorId: string | null
  action: 'media.scan.callback_denied' | 'media.scan.timeout' | 'media.scan.alert.dispatch' | 'media.scan.dispatch_failed'
  resourceType: string
  resourceId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}>
```

### `POST /media/scan-alerts/:id/acknowledge`

Requires `admin:queue:review`. Records `media.scan.alert.acknowledged` and returns the updated alert.

```ts
{
  note?: string
}
```

### `POST /media/scan-alerts/:id/silence`

Requires `admin:queue:review`. Records `media.scan.alert.silenced`, returns the updated alert, and suppresses new notifications for the alert until `until`. If `until` is omitted the server defaults to a 24-hour silence.

```ts
{
  until?: string // future ISO timestamp
  note?: string
}
```

### `POST /media/scan-alerts/:id/unsilence`

Requires `admin:queue:review`. Records `media.scan.alert.unsilenced` and returns the updated alert.

```ts
{
  note?: string
}
```

When an active or acknowledged alert first creates unread station notifications for media queue readers, the server can also fan it out to external operations channels.

Generic webhook configuration:

- `MEDIA_SCAN_ALERT_WEBHOOK_URL`: target URL for `POST` delivery.
- `MEDIA_SCAN_ALERT_WEBHOOK_SECRET`: optional HMAC secret for delivery signing.
- `MEDIA_SCAN_ALERT_WEBHOOK_TIMEOUT_SECONDS`: delivery timeout, default `5`.

Generic webhook requests use this payload:

```ts
{
  type: 'media.scan.alert'
  alert: MediaScanAlertDto
  sentAt: string
}
```

The request includes `x-media-scan-alert-id` and `x-media-scan-alert-type`. When a secret is configured it also includes `x-media-scan-alert-signature: sha256=<hex hmac>` over the raw JSON body.

Slack webhook configuration:

- `MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL`: Slack incoming webhook URL.
- `MEDIA_SCAN_ALERT_SLACK_TIMEOUT_SECONDS`: delivery timeout, default `5`.

Slack requests send a Slack-compatible `text` plus `blocks` payload containing alert title, summary, type, severity, count, threshold, and window. Delivery results are recorded as `media.scan.alert.dispatch` audit events with channel (`webhook`, `slack`, or `email`), status, status code, and error metadata; webhook URLs, secrets, and signatures are never stored. Failed delivery audit events can raise `media.scan.alert_delivery_failed.spike` when they cross the configured threshold.

Email webhook configuration:

- `MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL`: HTTP mailer endpoint.
- `MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET`: optional HMAC secret for delivery signing.
- `MEDIA_SCAN_ALERT_EMAIL_TO`: comma-separated recipient list; required when the email webhook URL is configured.
- `MEDIA_SCAN_ALERT_EMAIL_FROM`: optional sender address.
- `MEDIA_SCAN_ALERT_EMAIL_TIMEOUT_SECONDS`: delivery timeout, default `5`.

Email requests send `to`, optional `from`, `subject`, `text`, `html`, the raw `alert`, and `sentAt`. Signed email requests use the same `x-media-scan-alert-signature` header format as the generic webhook. Delivery audit channel is `email`.

### `GET /media/scan-jobs/archive`

Requires `admin:queue:read`. Returns a paginated cold-archive candidate manifest for inactive scan job history that would be pruned by the current media governance retention policy. This endpoint does not delete rows. Operators or offline jobs can persist the manifest and referenced rows to cold storage before running the sweep.

The deletion boundary matches `POST /media/scan-jobs/sweep`: inactive `completed` and `failed` rows are candidates when they are older than `MEDIA_SCAN_HISTORY_RETENTION_DAYS` or exceed the newest `MEDIA_SCAN_HISTORY_RETENTION_MAX_PER_ASSET` rows for an asset. Active `queued`, `retrying`, and derived `timed_out` jobs are retained.

Query:

```ts
{
  cursor?: string
  limit?: number // default 100, max 500
}
```

Returns:

```ts
{
  exportedAt: string
  mode: 'candidate_manifest'
  retention: {
    days: number
    maxPerAsset: number
    cutoff?: string
  }
  deleteBoundary: {
    inactiveStatuses: string[]
    activeStatusesRetained: string[]
    prunedByAge: string
    prunedByCount: string
  }
  count: number
  totalCandidates?: number
  limit: number
  nextCursor: string | null
  items: Array<MediaScanJobDto & {
    archiveReasons: Array<'age' | 'count' | string>
    asset?: {
      id: string
      fileName: string
      storageKey: string
      contentType: string
      purpose: string
      status: string
      ownerId?: string | null
    }
  }>
}
```

### `POST /media/scan-jobs/archive`

Requires `admin:queue:review`. Generates the same manifest as `GET /media/scan-jobs/archive`, writes it through the configured storage backend, and records `media.scan.history_archived` audit metadata with storage key, provider, byte size, and candidate counts. In `STORAGE_DRIVER=mock` mode the server returns a mock archive URL without writing external storage. In `STORAGE_DRIVER=s3` mode the server writes the JSON manifest through an S3-compatible presigned PUT URL.

Query:

```ts
{
  cursor?: string
  limit?: number // default 100, max 500
}
```

Returns the manifest shape above plus:

```ts
{
  storage: {
    provider: 'mock' | 's3' | string
    storageKey: string
    url?: string
    bytes: number
    statusCode?: number | null
    writtenAt: string
  }
}
```

### `POST /media/scan-jobs/sweep`

Requires `admin:queue:review`. Runs the scan-job maintenance sweep once. Timed-out jobs below `MEDIA_SCAN_MAX_ATTEMPTS` are automatically requeued with a new durable scan job and `externalScanId`; jobs at or above the max attempt limit are marked `failed`, moved to `scanStatus: 'review'`, mirrored into the asset security projection, and notify media queue operators. The sweep also prunes inactive scan history using `MEDIA_SCAN_HISTORY_RETENTION_DAYS` (default `180`) and `MEDIA_SCAN_HISTORY_RETENTION_MAX_PER_ASSET` (default `50`); `queued` and `retrying` jobs are never pruned.

Returns:

```ts
{
  inspected: number
  retried: number
  failed: number
  pruned: number
  retention: {
    days: number
    maxPerAsset: number
    cutoff?: string
  }
  items: MediaAssetDto[]
}
```

### `GET /media/uploads/:id/scan-jobs`

Requires `admin:queue:read`. Returns durable scan job attempt history for a media asset, ordered newest first. Prisma-backed deployments return rows from `media_scan_jobs`; seed/demo mode projects the latest compatibility scan metadata as a single history item.

Query:

```ts
{
  cursor?: string
  limit?: number // default 10, max 50
}
```

Response uses the standard pagination envelope:

```ts
{
  data: Array<{
    id: string
    assetId: string
    provider: string
    status: 'queued' | 'retrying' | 'completed' | 'failed'
    scanStatus: string
    externalScanId: string | null
    attempts: number
    requestedAt: string | null
    timeoutAt: string | null
    nextRetryAt: string | null
    callbackAt: string | null
    failedAt: string | null
    note: string | null
    rejectionReason: string | null
    metadata: Record<string, unknown> | null
  }>
  meta: {
    pagination: {
      limit: number
      nextCursor: string | null
    }
  }
}
```

### `POST /media/uploads/:id/complete`

Requires auth. Marks an owned upload complete after object storage confirms file presence.

Body:

```ts
{
  checksum?: string
  detectedContentType?: string
}
```

Completion records secondary MIME validation plus scan provider metadata under `metadata.security`. `MEDIA_SCAN_PROVIDER=manual` records `scanStatus: 'pending'`; `MEDIA_SCAN_PROVIDER=mock` deterministically records `clean`, `review`, or `rejected` based on filename/storage-key signatures for local testing; `MEDIA_SCAN_PROVIDER=webhook` records `scanStatus: 'scanning'`, an external scan id, and waits for the provider callback. When `MEDIA_SCAN_REQUEST_URL` is configured, webhook mode also POSTs a scan request to the scanner service. `MEDIA_SCAN_REQUEST_ADAPTER` defaults to `generic-webhook` and is mirrored to `metadata.security.scanRequestAdapter` plus scan-job metadata for operations reporting. Supported adapters are:

- `generic-webhook`: sends `scanId`, `adapter`, `trigger`, `callbackUrl`, and full asset metadata.
- `clamav-http`: sends a ClamAV-oriented `jobId`, `callbackUrl`, object-storage `source`, and asset `metadata`; also includes `x-clamav-job-id`.

All adapters send `x-media-scan-id`, `x-media-scan-adapter`, and optional `x-media-scan-signature`; dispatch status is mirrored to `metadata.security.scanDispatchStatus`.

### `POST /media/uploads/:id/scan`

Requires `admin:queue:review`. Records a manual media review decision.

Body:

```ts
{
  decision: 'clean' | 'reject'
  note?: string
  detectedContentType?: string
}
```

### `POST /media/uploads/:id/scan-callback`

Requires `MEDIA_SCAN_WEBHOOK_SECRET` to be configured and sent as the `x-media-scan-secret` header. Records asynchronous scanner results without a user session. When `MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET` is configured, callbacks must also include:

- `x-media-scan-timestamp`: current Unix epoch milliseconds.
- `x-media-scan-signature`: `sha256=<hex hmac>` of `${timestamp}.${rawJsonBody}` using `MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET`.

`MEDIA_SCAN_CALLBACK_SIGNATURE_TOLERANCE_SECONDS` controls timestamp skew tolerance and defaults to 300 seconds.

Rejected callback authentication/signature attempts write a system audit event with action `media.scan.callback_denied`. The audit metadata records the denial reason, target asset id, optional `externalScanId`, remote address, and whether the secret/timestamp/signature headers were present; secret and signature values are never stored.

Body:

```ts
{
  status: 'clean' | 'review' | 'rejected'
  note?: string
  reason?: string
  detectedContentType?: string
  externalScanId?: string
}
```

Callback status mapping:

- `clean`: marks the asset clean, completes the scan job, and allows private download contracts.
- `review`: keeps the asset uploaded, marks the scan job completed, and notifies media queue operators for manual review.
- `rejected`: rejects the asset, marks the scan job failed, records `rejectionReason`, and blocks private downloads.

### `POST /media/uploads/:id/scan-retry`

Requires `admin:queue:review`. Requeues an uploaded media asset for webhook scanning, increments `metadata.security.scanAttempts`, creates a new `externalScanId`, sets `scanJobStatus: 'retrying'`, refreshes `scanTimeoutAt`, and dispatches a scanner request when `MEDIA_SCAN_REQUEST_URL` is configured.

### `GET /media/assets/:id/download`

Requires auth plus owner access or `admin:access`. Returns a private download contract only when the media asset is uploaded and `metadata.security.scanStatus === 'clean'`.

## Error Codes

- `AUTH_REQUIRED`
- `TOKEN_EXPIRED`
- `PERMISSION_DENIED`
- `VALIDATION_FAILED`
- `NOT_FOUND`
- `CONFLICT`
- `INVALID_STATE_TRANSITION`
- `RATE_LIMITED`
- `BODY_TOO_LARGE`
- `INTERNAL_ERROR`

`RATE_LIMITED` is returned with HTTP 429 when a client exceeds the configured abuse guard for high-risk buckets:

- `auth`: `POST /auth/login`, `POST /auth/register`, and `POST /auth/refresh`; configured by `RATE_LIMIT_AUTH_MAX`.
- `upload`: `POST /media/uploads`; configured by `RATE_LIMIT_UPLOAD_MAX`.
- `admin_mutation`: mutating `/admin/**` requests; configured by `RATE_LIMIT_ADMIN_MUTATION_MAX`.

All buckets share `RATE_LIMIT_WINDOW_MS`; `RATE_LIMIT_ENABLED=false` disables the guard for trusted internal deployments. The current deployment store is `RATE_LIMIT_STORE=memory`, with a small store interface kept at the HTTP boundary so a durable Redis-compatible backend can replace it without changing route handlers.

429 responses include:

- `Retry-After`: seconds until the active window resets.
- `error.details.bucket`: the logical bucket id.
- `error.details.limit`: configured request limit for that bucket.
- `error.details.count`: observed request count in the current window.
- `error.details.resetAt`: ISO timestamp for the active window reset.
- `error.details.retryAfterSeconds`: same value as the response header.

The HTTP server also exposes an `onRateLimitExceeded(event)` observer hook. Production startup currently writes this structured event to logs; later deployments should forward it into metrics and alerting.

`BODY_TOO_LARGE` is returned with HTTP 413 when a request body exceeds `REQUEST_BODY_MAX_BYTES`. The guard rejects oversized `Content-Length` requests before route handling when possible, and still caps chunked or streaming bodies while reading. `REQUEST_BODY_SIZE_GUARD_ENABLED=false` disables the guard for trusted internal deployments.

413 responses include:

- `error.details.limitBytes`: configured request body limit.
- `error.details.contentLengthBytes`: declared body size when rejected from `Content-Length`.
- `error.details.receivedBytes`: bytes read when rejected during stream reading.
- `error.details.source`: `content-length` or `stream`.

The HTTP server also exposes an `onRequestBodyRejected(event)` observer hook. Production startup currently writes this structured event to logs; later deployments should forward it into metrics and alerting alongside `RATE_LIMITED` events.

Failed-login anomaly monitoring records `AUTH_FAILED` outcomes from `/auth/login` in a rolling `AUTH_FAILURE_WINDOW_MS` window:

- `auth.failed_login.ip_accounts`: one client IP fails against at least `AUTH_FAILURE_IP_ACCOUNT_THRESHOLD` distinct identities.
- `auth.failed_login.account_ips`: one identity fails from at least `AUTH_FAILURE_ACCOUNT_IP_THRESHOLD` distinct client IPs.

`AUTH_FAILURE_MONITOR_ENABLED=false` disables the in-process monitor for trusted internal deployments. Production startup currently writes matching events through the `onAuthFailureAnomaly(event)` observer as `[auth-anomaly]` structured logs; later deployments should forward them into metrics, alerts, and Admin security views.

The security event collector stores normalized events from `RATE_LIMITED`, `BODY_TOO_LARGE`, and auth anomaly hooks. Prisma-backed deployments mirror those events into the durable `security_events` table while retaining the in-process collector as a local/test fallback. `GET /admin/security/events` exposes those events to operators with audit access. `SECURITY_EVENT_MAX_ITEMS` caps only the fallback collector.

Security alert aggregation reads the same event stream and emits `security.event.rate_limit.spike`, `security.event.body_rejected.spike`, and `security.event.auth_failure_anomaly.spike` alerts when configured thresholds are crossed. It also reads failed `security.alert.dispatch` audit events and emits `security.alert.delivery_failed.spike` when external security alert delivery fails repeatedly. New Prisma-backed alerts create deduped unread station notifications for `admin:audit:read` users and can dispatch to webhook, Slack, and email operations channels. Alert listing, samples, and exports require `admin:audit:read`; acknowledgement, silence, and unsilence require `security:alerts:manage`. Dispatch results are written as `security.alert.dispatch` audit events without storing configured URLs or secrets.

## Current Implementation Contract

The front-end contract types live in `src/services/contracts.ts`. Keep service request and response types in that file first, then mirror stable shapes into OpenAPI.

### Envelope

Current client parsing expects every API response to use:

```ts
type ApiEnvelope<T> = {
  data: T
  meta?: unknown
  error?: {
    code: string
    message: string
    details?: unknown
  }
}
```

### Demo Auth

`POST /auth/login` currently accepts a demo account handle:

```ts
type LoginRequest = {
  handle: string
}
```

It returns:

```ts
type SessionResponse = {
  accessToken: string
  refreshToken: string
  user: ApiAccount
}
```

`GET /me` returns `ApiAccount`. Front-end permissions are read from `user.permissions`.

### Tasks

`POST /tasks` requires `task:create` and currently accepts:

```ts
type CreateTaskRequest = {
  title: string
  category: string
  description: string
  acceptanceRules: string
  rewardAmount?: number | null
  rewardCurrency?: string | null
  pointsReward: number
  deadlineAt?: string | null
  visibility?: string
  attachmentIds?: string[]
}
```

`POST /tasks/:id/submissions` requires `task:submit`:

```ts
type SubmitTaskRequest = {
  content: string
  assetIds: string[]
  rightsNote: string
}
```

`POST /tasks/:id/review` requires `task:review`:

```ts
type ReviewTaskRequest = {
  decision: 'approve' | 'reject' | 'request_changes'
  reviewNote: string
  acceptanceChecklist?: Array<{
    label: string
    checked: boolean
  }>
}
```

`POST /tasks/:id/disputes` requires `task:submit` and accepts `{ reason: string }`.

`POST /tasks/stale-submissions/sweep` requires `task:moderate` and accepts `{ olderThanHours?: number; limit?: number; taskId?: string | null }`.

### Community And Library

`POST /posts/:id/comments` requires `comment:create`:

```ts
type CreateCommentRequest = {
  body: string
  parentId?: string | null
}
```

`POST /posts/:id/convert-to-task` and `POST /library/items/:id/convert-to-task` require `task:create`:

```ts
type ConvertToTaskRequest = {
  acceptanceRules: string
  pointsReward: number
  rewardAmount?: number | null
  deadlineAt?: string | null
}
```

`POST /library/items` saves a reusable inspiration item:

```ts
type CreateLibraryItemRequest = {
  title: string
  text: string
  type: string
  source: string
  sourceId?: string | null
  metadata?: unknown
}
```

### Admin

`GET /admin/audit` requires `admin:audit:read` and returns `AuditEventDto[]`.

```ts
type AdminAuditQuery = {
  action?: string
  resourceType?: string
  actorId?: string
  cursor?: string
  limit?: number // 1..100, default 20
}
```

`GET /admin/audit/:id` requires `admin:audit:read` and returns a single `AuditEventDto`.
It is intended for copied audit links and notification deep links so operators can open a specific event even when it is not present on the current audit list page.

`GET /admin/audit/export` requires `admin:audit:read` and returns a JSON export artifact for the current audit filters.
It accepts the same filter fields as `GET /admin/audit`, defaults `limit` to `100`, and returns `{ exportedAt, query, count, events }`.

`GET /admin/security/events` requires `admin:audit:read` and returns normalized security events from durable storage when available, or from the in-process fallback collector in local/test mode.

`GET /admin/security/alerts` requires `admin:audit:read` and returns threshold-crossing security alert summaries.

`GET /admin/security/alerts/:id/events` and `GET /admin/security/alerts/:id/export` require `admin:audit:read`. `POST /admin/security/alerts/:id/acknowledge`, `POST /admin/security/alerts/:id/silence`, and `POST /admin/security/alerts/:id/unsilence` require `security:alerts:manage`.

```ts
type AdminSecurityEventQuery = {
  type?: string
  source?: 'rate_limit' | 'body_size' | 'auth_failure' | string
  severity?: string
  cursor?: string
  limit?: number // 1..100, default 20
}

type AdminSecurityAlertDto = {
  id: string
  type: 'security.event.rate_limit.spike' | 'security.event.body_rejected.spike' | 'security.event.auth_failure_anomaly.spike' | 'security.alert.delivery_failed.spike' | string
  state: 'active' | 'acknowledged' | 'silenced'
  severity: 'warning' | 'critical' | string
  title: string
  summary: string
  count: number
  threshold: number
  windowMinutes: number
  resourceType: 'security_event' | 'security_alert_dispatch'
  resourceId: null
  metadata: {
    source: 'rate_limit' | 'body_size' | 'auth_failure' | 'alert_dispatch'
    recentEventIds: string[]
    recentClientKeys: string[]
    recentIdentities: string[]
    recentPaths: string[]
    recentChannels?: string[]
    recentStatuses?: string[]
    recentAlertTypes?: string[]
    recentErrors?: string[]
  }
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  acknowledgementNote: string | null
  silencedUntil: string | null
  silencedBy: string | null
  silenceNote: string | null
  createdAt: string
}
```
