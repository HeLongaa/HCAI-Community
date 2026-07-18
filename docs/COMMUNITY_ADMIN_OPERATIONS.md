# Community Admin Operations

COMM-03 provides bounded administrative CRUD for posts and comments, soft-delete/restore workflows, aggregate interaction metrics, and confirmation-bound idempotent bulk operations.

## Lifecycle Boundary

Owner and Admin deletion is represented by `Post.status/deletedAt` or `Comment.deletedAt`. Trust and Safety decisions remain represented only by `moderationState`, `moderationVersion`, and append-only `CommunityModerationAction` facts. Restoring deleted content never changes Trust moderation state, so content that remains `hidden` is not made public by an Admin restore.

Every mutation requires `expectedVersion`, a stable reason code, and optional bounded note. PostgreSQL applies the mutation and sanitized audit event in one Serializable transaction. Raw post/comment text is not written into audit metadata or aggregate metrics.

## Bulk Operations

Bulk delete and restore support posts or comments, up to 50 unique targets. Operators must preview first, submit the returned SHA-256 target hash and exact confirmation phrase, and use an idempotency key. Per-target state changes are CAS-protected; concurrent or ineligible targets are returned as explicit skips. `CommunityAdminBulkOperation.result` is schema-versioned immutable evidence.

## Permissions

- `admin:community:read`: list/detail and aggregate metrics.
- `admin:community:manage`: update, delete, restore, and bulk operations.
- `admin:community:export`: aggregate metrics export.

Moderator defaults receive read access. Admin defaults receive read, manage, and export access.
