# Data Model And Auth Design

## Core Entities

### `users`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `email` | text | Unique, nullable for OAuth-only providers |
| `display_name` | text | Shown in app chrome |
| `avatar_url` | text | Nullable |
| `role` | enum | `member`, `creator`, `publisher`, `moderator`, `admin` |
| `status` | enum | `active`, `suspended`, `deleted` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `auth_accounts`

Stores login provider identities.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `user_id` | uuid | FK users |
| `provider` | enum | `email`, `google`, `apple`, `wechat` |
| `provider_user_id` | text | Unique with provider |
| `password_hash` | text | Only for email auth |

### `refresh_tokens`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `user_id` | uuid | FK users |
| `token_hash` | text | Never store raw token |
| `expires_at` | timestamptz | |
| `revoked_at` | timestamptz | Nullable |

### `profiles`

| Field | Type | Notes |
| --- | --- | --- |
| `user_id` | uuid | Primary key, FK users |
| `handle` | text | Unique |
| `bio` | text | |
| `lane` | enum | `maker`, `publisher`, `both` |
| `skills` | text[] | |
| `languages` | text[] | |
| `portfolio` | jsonb | Normalization can happen later |
| `stats` | jsonb | Derived stats cache |

### `tasks`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `title` | text | |
| `category` | text | Indexed |
| `description` | text | |
| `acceptance_rules` | text | |
| `reward_amount` | numeric | Nullable |
| `reward_currency` | text | Nullable |
| `points_reward` | integer | |
| `status` | enum | See task state machine |
| `publisher_id` | uuid | FK users |
| `assignee_id` | uuid | FK users, nullable |
| `visibility` | enum | `public`, `community`, `invite_only` |
| `deadline_at` | timestamptz | Nullable |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `task_proposals`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `task_id` | uuid | FK tasks |
| `proposer_id` | uuid | FK users |
| `cover_letter` | text | |
| `estimate` | text | Nullable |
| `status` | enum | `pending`, `accepted`, `rejected`, `withdrawn` |
| `metadata` | jsonb | Nullable extension point |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `task_submissions`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `task_id` | uuid | FK tasks |
| `submitter_id` | uuid | FK users |
| `content` | text | |
| `asset_ids` | text[] | Uploaded/persisted asset references |
| `rights_note` | text | |
| `status` | enum | `pending_review`, `revision_requested`, `stale`, `disputed`, `approved`, `rejected` |
| `review_note` | text | Nullable |
| `reviewed_by_id` | uuid | FK users, nullable |
| `reviewed_at` | timestamptz | Nullable |
| `metadata` | jsonb | Nullable extension point |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `task_events`

Append-only audit log.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `task_id` | uuid | FK tasks |
| `actor_id` | uuid | FK users |
| `event_type` | text | `published`, `claimed`, `submitted`, `approved`, `rejected` |
| `from_status` | text | Nullable |
| `to_status` | text | Nullable |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |

### `posts`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `author_id` | uuid | FK users |
| `title` | text | |
| `body` | text | |
| `category` | text | |
| `tag` | text | |
| `solved` | boolean | |
| `views_count` | integer | |
| `likes_count` | integer | Derived/cache |
| `created_at` | timestamptz | |

### `comments`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `post_id` | uuid | FK posts |
| `author_id` | uuid | FK users |
| `parent_id` | uuid | Self FK, nullable |
| `body` | text | |
| `created_at` | timestamptz | |

### `library_items`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `user_id` | uuid | FK users |
| `source_type` | enum | `post`, `prompt`, `tutorial`, `template`, `external` |
| `source_id` | uuid | Nullable |
| `title` | text | |
| `content` | text | |
| `metadata` | jsonb | |

### `point_ledger`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `user_id` | uuid | FK users |
| `source_type` | text | `task`, `post`, `admin_adjustment`, `redemption` |
| `source_id` | uuid | Nullable |
| `delta` | integer | Positive or negative |
| `balance_after` | integer | Snapshot |
| `status` | enum | `pending`, `settled`, `cancelled` |
| `created_at` | timestamptz | |

### `audit_events`

Privileged/system event log used by admin audit views.

Admin operations metrics reuse `audit_events` for security alert dispositions, alert delivery failures, scan history archive writes, and scan history prune summaries. Prisma schema indexes `created_at`, `(action, created_at)`, and `(resource_type, created_at)` for time-window operations queries.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `actor_type` | enum | `user`, `system` |
| `actor_id` | uuid | Nullable for system actions |
| `action` | text | Stable action key |
| `resource_type` | text | |
| `resource_id` | uuid/text | Nullable |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |

### `admin_reviews`

Operations review queue used by the admin center.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `queue` | text | `tasks`, `submissions`, `community`, etc. |
| `status` | text | Human-visible review state |
| `title` | text | |
| `owner` | text | Source owner handle/name |
| `note` | text | Reviewer note or queue context |
| `decision` | enum | `approve`, `reject`, nullable |
| `reviewed_by_id` | uuid | FK users, nullable |
| `reviewed_at` | timestamptz | Nullable |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Point adjustment review metadata uses:

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | text | `point_adjustment` |
| `userHandle` | text | Target user |
| `delta` | integer | Requested point delta |
| `reason` | text | Operator reason |
| `reasonCode` | text | Nullable reason category |
| `requestedBy` | text | Requesting operator handle |
| `threshold` | integer | Direct adjustment limit at request time |
| `balanceBefore` | integer | Balance before approval |
| `projectedBalance` | integer | Balance after approval |
| `ledgerEntryId` | text | Filled after approval |

### `system_settings`

General product configuration store for admin-managed policies.

| Field | Type | Notes |
| --- | --- | --- |
| `key` | text | Primary key, e.g. `point_adjustment_policy`, `media_governance_policy` |
| `value` | jsonb | Policy payload |
| `updated_at` | timestamptz | |

### `notifications`

Internal product notification inbox.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `recipient_id` | uuid | FK users |
| `type` | text | Stable notification key, e.g. `points.adjustment.requested` |
| `title` | text | Human-readable title |
| `body` | text | Human-readable body |
| `resource_type` | text | Target domain object type |
| `resource_id` | uuid/text | Nullable target object id |
| `metadata` | jsonb | Optional workflow context |
| `read_at` | timestamptz | Nullable |
| `created_at` | timestamptz | |

Notification workflow metadata may include a `target` object with `{ page, admin }` deep-link hints. The frontend currently uses this to open Admin Center review/finance/security/media contexts, task workspaces, or the points ledger from task and operations notifications.

Task lifecycle notification types currently include `task.proposal_submitted`, `task.proposal_accepted`, `task.proposal_rejected`, `task.submission_submitted`, `task.submission_resubmitted`, `task.revision_requested`, `task.submission_approved`, `task.submission_rejected`, `task.reward_settled`, `task.submission_stale`, `task.dispute_opened`, and `task.dispute_received`.

### `permissions`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | text | Primary key, e.g. `task:create` |
| `description` | text | Nullable |
| `created_at` | timestamptz | |

### `role_permissions`

| Field | Type | Notes |
| --- | --- | --- |
| `role` | enum | FK-like `UserRole` value |
| `permission_id` | text | FK permissions |

Primary key: `(role, permission_id)`.

### `media_assets`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key |
| `owner_id` | uuid | FK users |
| `file_name` | text | Original client filename |
| `storage_key` | text | Object storage key |
| `content_type` | text | |
| `size_bytes` | integer | |
| `purpose` | enum | `task_attachment`, `submission_asset`, `profile_portfolio`, `library_asset` |
| `status` | enum | `pending`, `uploaded`, `rejected` |
| `metadata` | jsonb | Nullable upload context, checksum, and compatibility security scan projection |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

`metadata.security` keeps upload governance compatibility fields such as `declaredContentType`, `detectedContentType`, `checksum`, `completedAt`, `scanProvider`, `scanStatus`, `scanNote`, `scanRequestedAt`, `externalScanId`, `callbackReceivedAt`, `scanJobStatus`, `scanAttempts`, `scanTimeoutAt`, `nextRetryAt`, `scanRequestAdapter`, `failedAt`, and `rejectionReason`. The Admin media review queue filters this projection by scan state while `status` keeps the broader asset lifecycle (`pending`, `uploaded`, `rejected`). Durable asynchronous scan history lives in `media_scan_jobs`.

### `media_scan_jobs`

Durable scanner job records for asynchronous media governance, retries, callbacks, and SLA sweeps.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid/text | Primary key |
| `asset_id` | uuid/text | FK media_assets |
| `provider` | text | Scanner provider key, e.g. `webhook` |
| `status` | enum | `queued`, `retrying`, `completed`, `failed` |
| `scan_status` | text | Scanner result state, e.g. `scanning`, `clean`, `review`, `rejected` |
| `external_scan_id` | text | Nullable provider/job id |
| `attempts` | integer | Attempt count for the asset scan workflow |
| `requested_at` | timestamptz | Nullable request timestamp |
| `timeout_at` | timestamptz | Nullable timeout/SLA deadline |
| `next_retry_at` | timestamptz | Nullable scheduled retry hint |
| `callback_at` | timestamptz | Nullable callback receipt timestamp |
| `failed_at` | timestamptz | Nullable terminal failure timestamp |
| `reviewed_by_id` | uuid/text | FK users, nullable |
| `reviewed_at` | timestamptz | Nullable manual review timestamp |
| `note` | text | Nullable scanner/operator note |
| `rejection_reason` | text | Nullable machine-readable reason |
| `metadata` | jsonb | Nullable provider payload snapshot, request adapter, and dispatch result |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

`GET /api/media/scan-jobs` and the sweep worker read this table in Prisma-backed mode. `MediaAssetDto.metadata.security` is still populated from the latest scan job so existing frontend flows remain stable. `GET /api/media/scan-jobs/archive` exports a paginated cold-archive candidate manifest using the same retention boundary as pruning, and `POST /api/media/scan-jobs/archive` writes that manifest through the configured object storage backend before deletion. The sweep worker prunes inactive history according to `MEDIA_SCAN_HISTORY_RETENTION_DAYS` and `MEDIA_SCAN_HISTORY_RETENTION_MAX_PER_ASSET`; active `queued`, `retrying`, and derived `timed_out` rows are retained.

Scanner governance writes privileged audit events for operations traceability:

| Action | Resource type | Notes |
| --- | --- | --- |
| `media.scan.callback_denied` | `media_asset` | Rejected scanner callback authentication/signature attempts; metadata records denial reason and header presence without secret values |
| `media.scan.history_archived` | `media_scan_jobs` | Scan history archive manifest write result; metadata records storage provider, storage key, byte size, and candidate counts |
| `media.scan.history_pruned` | `media_asset` | Scan history retention sweep summaries |
| `media.scan.alert.dispatch` | `media_scan_alert` | External scanner-health alert delivery result; metadata records alert type, severity, channel (`webhook`/`slack`/`email`), status, status code, and safe error text |
| `media.scan.alert.acknowledged` | `media_scan_alert` | Operator acknowledgement for a scanner-health alert; metadata records alert type, severity, actor handle, and note |
| `media.scan.alert.silenced` | `media_scan_alert` | Operator silence window for a scanner-health alert; metadata records alert type, severity, actor handle, note, and `silencedUntil` |
| `media.scan.alert.unsilenced` | `media_scan_alert` | Operator removal of a scanner-health alert silence; metadata records alert type, severity, actor handle, and note |
| `media.governance_policy.updated` | `media_governance_policy` | Admin-managed numeric media governance policy update; metadata records previous and next policy values without secret material |

## Task State Machine

```text
draft
  -> open
  -> assigned
  -> in_progress
  -> submitted
  -> pending_review
  -> completed
  -> rejected
  -> cancelled
```

Rules:

- `publisher_id` can move `draft -> open`.
- eligible makers can create proposals while task is `open`.
- publisher or automated matching can move `open -> assigned`.
- assignee can move `assigned -> in_progress -> submitted`.
- publisher can move `submitted -> completed`, `submitted -> rejected`, or request changes before final acceptance.
- creator can move rejected or stale submissions into `disputed`, which opens a task dispute admin-review item.
- moderators can mark long-pending submissions as `stale` through the stale submission sweep.
- admin can move most non-terminal states to `cancelled` or `rejected`.
- point ledger settlement happens in the same transaction as `completed`.

## Roles

| Role | Purpose |
| --- | --- |
| `member` | Basic authenticated user |
| `creator` | Can submit proposals and deliver tasks |
| `publisher` | Can publish and review tasks |
| `moderator` | Can moderate posts and reports |
| `admin` | Can access admin center and system actions |

## Permissions

Permissions should be action-based:

Current implementation coverage and test status are tracked in `docs/PERMISSION_MATRIX.md`.

Current storage model:

- `Permission` stores the permission catalog.
- `RolePermission` maps `UserRole` values to granted permission IDs.
- `server/src/auth/permissions.js` remains the fallback policy and seed source.
- Prisma-backed accounts read permissions from `RolePermission`; seed/demo accounts use the fallback policy directly.

| Permission | Roles | Extra rule |
| --- | --- | --- |
| `task:create` | `member`, `publisher`, `admin` | User must be active |
| `task:propose` | `creator`, `admin` | Cannot propose own task |
| `task:claim` | `creator`, `admin` | Task must be open |
| `task:submit` | `creator`, `admin` | User must be assignee |
| `task:review` | `publisher`, `admin` | User must be publisher unless admin |
| `task:moderate` | `moderator`, `admin` | |
| `post:create` | `member`, `creator`, `publisher`, `admin` | |
| `comment:create` | authenticated users | |
| `post:moderate` | `moderator`, `admin` | |
| `points:read` | authenticated users | Own ledger unless admin |
| `points:adjust` | `admin` | Requires audit reason; points queue approval also requires `admin:queue:review` |
| `admin:access` | `admin`, `moderator` | Opens admin shell only; data routes use narrower permissions |
| `admin:audit:read` | `admin`, `moderator` | Read privileged audit log |
| `admin:queue:read` | `admin`, `moderator` | Read operations review queues |
| `admin:queue:review` | `admin`, `moderator` | Perform queue review actions |
| `admin:permissions:manage` | `admin` | Edit role permission grants; protected on `admin` role |

## Auth Flow

```text
login
  -> validate provider credentials
  -> create access token
  -> create refresh token row
  -> return user + tokens
```

Access token claims:

```ts
{
  sub: string
  role: Role
  permissions: string[]
  exp: number
}
```

Refresh token requirements:

- Store only token hash.
- Rotate refresh token on every refresh.
- Revoke on logout.
- Revoke all user tokens on password reset or admin suspension.

## Authorization Pattern

Backend handlers should check:

1. Is the user authenticated?
2. Does the role grant the permission?
3. Does the resource ownership/state allow the action?
4. Does the action require an audit event?

Protected grants:

- `admin` must keep `admin:permissions:manage`; the backend rejects updates that remove it.

Example:

```ts
canReviewTask(user, task) {
  if (user.role === 'admin') return true
  return hasPermission(user, 'task:review') && task.publisherId === user.id
}
```
