# Task Admin Operations

TASK-01 adds a personal-account task operations surface without bypassing the existing publisher, creator, review, dispute, and point escrow lifecycle.

## Permissions

- `admin:tasks:read` reads safe task operations projections and summary counts.
- `admin:tasks:manage` edits eligible tasks and performs archive, restore, status, and bulk operations.

## Mutation boundaries

Every single-task mutation requires `expectedVersion`, a stable `reasonCode`, and an optional bounded note. Business fields are editable only while a task is `draft` or `open`. Status changes are limited to `draft -> open` and `draft|open -> cancelled`. Cancellation releases a pending publisher point escrow in the same repository transaction.

Archive is a reversible visibility operation. It never hard-deletes a task or rewrites its business status. Active fulfillment tasks cannot be archived, and archived tasks are excluded from every public task lifecycle path.

## Bulk disposition

Bulk archive and cancellation are capped at 50 unique task IDs. The client must preview first, preserve the returned target hash, provide the registered confirmation phrase, and execute with an idempotency key. Eligibility is recomputed during execution. Missing, ineligible, or concurrently changed tasks are returned as explicit skipped results.

`TaskAdminBulkAction` stores immutable result evidence. Individual successful changes and the aggregate completion are written to the audit log.

## Deferred behavior

Automatic cancellation, deadline expiry, and abnormal lifecycle recovery belong to TASK-02. TASK-01 does not expose arbitrary status patching or hard deletion.
