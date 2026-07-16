# AI Generation Operations Admin

`AI-ADMIN-01` completes the personal-account generation operations surface across Image, Chat, Video, and Music.

## Read model

Operators with `admin:audit:read` can filter, sort, paginate, inspect, and summarize durable generation history. Export remains separately protected by `admin:audit:export`. API projections omit credentials, raw Provider payloads, private URLs, storage keys, execution idempotency keys, and execution payload hashes.

## Disposition

Single-record cancellation and retry authorization retain their dedicated permissions. Batch disposition supports only cancellation and retry authorization, with no batch manual Provider replay.

Every batch is limited to 50 unique generation IDs. Preview classifies each target as eligible, blocked, or missing and returns a stable SHA-256 target hash plus an exact confirmation phrase. Execution requires that hash, phrase, and an explicit root idempotency key. It rechecks current state and derives a separate idempotency key per target. Partial results are bounded and aggregate audit evidence contains only action, counts, target hash, and reason code.

## Recovery

The Admin UI lists `recovery_required` execution claims without request payloads or Provider identifiers. An operator with `admin:creative:retry` may mark a reviewed abandoned claim failed with bounded reason and error codes. Recovery never redispatches automatically; users still initiate a distinct Retry flow.

## Provider boundary

No real Provider client is enabled by this task. Existing legal, evaluation, deployment, budget, credential-owner, kill-switch, rollback-owner, and scoped approval gates remain authoritative. Batch manual replay is intentionally unavailable because each Provider replay requires independent evidence review.
