# Task Lifecycle Recovery

TASK-02 closes cancellation, deadline expiry, escrow release, duplicate request, and abnormal recovery behavior for personal accounts.

## State policy

- A publisher may cancel only an owned `draft` or `open` task.
- The registered `task-expiry-sweep` job expires due `open`, `assigned`, `in_progress`, or `rejected` tasks in bounded batches.
- Cancellation and expiry commit the task CAS transition, escrow release, immutable lifecycle mutation, and audit event in one serializable transaction.
- Every external mutation requires an idempotency key. Reusing a key with the same payload returns prior evidence; reusing it with a different payload is rejected.
- `expired` and `cancelled` are terminal public states.

## Recovery policy

The only registered recovery action is `release_escrow`. It is restricted to cancelled or expired tasks and reconciles missing or repeated escrow-release work idempotently. It cannot assign an arbitrary task status.

## Runtime configuration

- `TASK_EXPIRY_WORKER_ENABLED`
- `TASK_EXPIRY_WORKER_INTERVAL_SECONDS`
- `TASK_EXPIRY_SWEEP_LIMIT`

Production worker execution still follows the shared JOB-02 lease, retry, DLQ, pause, and manual-rerun controls.
