# Admin Generation Mutation Requirements

This document closes the third real-provider preflight task: define the requirements, permissions, audit events, notifications, idempotency rules, and rollback semantics for future Admin creative generation mutations.

The current Admin generation history surface remains read-only. This document does not add mutation endpoints, Admin UI controls, provider API calls, payment-provider refunds, retry workers, polling routes, or webhook handlers.

## Current Boundary

Available today:

- `GET /api/admin/creative/generations`
- `GET /api/admin/creative/generations/:id`
- read-only Admin Center generation history
- prompt hash and short preview only
- quota, credit, safety, policy, provider, media, and audit drill-down metadata

Still deferred:

- Admin retry
- Admin cancel
- Admin force-review
- Admin refund
- Admin manual settlement
- provider-specific retry/cancel API calls
- payment-provider refunds or subscription balance reconciliation

## Proposed Permission Model

Read-only generation history can continue to use `admin:audit:read`.

Future mutations must not reuse `admin:audit:read`, `admin:queue:review`, or `points:adjust`. They should use dedicated creative-generation permissions so operators can be granted inspection access without economic or provider-side control.

| Proposed permission | Purpose | Allowed actions | Notes |
| --- | --- | --- | --- |
| `admin:creative:retry` | Start a controlled retry after a failed or timed-out provider attempt | Retry generation | Must not include refund/settlement authority |
| `admin:creative:cancel` | Stop queued/running provider work where cancellation is supported | Cancel generation | Requires provider capability metadata before implementation |
| `admin:creative:review` | Move output into manual review without changing accounting | Force review | Similar risk class to media review, but scoped to generation lifecycle |
| `admin:creative:credits:adjust` | Apply internal creative-credit refund/correction | Refund | Does not grant task points adjustment or payment-provider refund access |
| `admin:creative:settlement:manage` | Resolve stuck provider/accounting state | Manual settlement | Highest risk; should require explicit reason and optional second approval later |

Recommended initial role grants:

- `admin`: all proposed permissions after implementation.
- `moderator`: `admin:creative:review` only, if media governance owns the operational review queue.
- `finops`: `admin:creative:credits:adjust` and `admin:creative:settlement:manage`, if the role remains responsible for economic corrections.
- No default grants for `member`, `publisher`, or `creator`.

## Mutation Requirements

### Retry Generation

Trigger conditions:

- Original generation is `failed` because of retryable provider failure, timeout, transient storage failure, or webhook/polling replay gap.
- Original generation has no usable output assets, or all linked output assets remain unusable.
- The provider adapter contract marks the failure retryable with safe metadata.
- The operator provides a reason code and notes.

Disallowed:

- Completed or review-required generations with usable outputs.
- Generations that are currently `queued` or `running`.
- Moderation-blocked prompts.
- Policy-blocked prompts.
- Retries that would exceed configured retry attempt count.

State and accounting:

- Prefer creating a new child generation attempt linked to the original generation instead of mutating the original record into a second run.
- Reserve quota and credits for the retry only when the retry will call a provider.
- If the previous attempt was refunded, the retry starts with a new reservation.
- If the previous attempt settled and the retry is goodwill/no-charge, the no-charge decision must be explicit in audit metadata.

Audit event:

- `creative_generation.retry_requested`
- Resource type: `creative_generation`
- Metadata: source generation id, new attempt id if created, provider id, workspace, mode, actor id, retry reason, retryable error code, previous credit status, previous quota status, idempotency key.

Notification:

- Notify the original user when a retry is started and when it completes/fails, unless the retry is purely internal diagnostics.
- Notify creative operations if retry creation fails after accounting reservation.

Idempotency:

- Use a stable key such as `admin_retry:{sourceGenerationId}:{reasonCode}:{operatorRequestId}`.
- Duplicate requests must return the same child attempt or a safe already-processed response.

Rollback:

- If retry creation fails before provider dispatch, release quota and cancel/refund credit reservation.
- If provider dispatch succeeds, do not delete the attempt; finish through normal provider failure/completion lifecycle.

### Cancel Generation

Trigger conditions:

- Generation is `queued` or `running`.
- Provider adapter declares cancellation support for the current provider job.
- Provider job id is present and safe to expose internally.
- Operator provides a reason code.

Disallowed:

- Completed, failed, refunded, or already cancelled generations.
- Generations without provider cancellation support.
- Generations whose provider work has already produced final output.

State and accounting:

- Introduce an intermediate `cancel_requested` operational marker in metadata if provider cancellation is asynchronous.
- Final generation status becomes `cancelled` only after provider confirms cancellation or the system reaches a deterministic local cancel boundary.
- Release quota only if provider work did not consume billable capacity.
- Refund or cancel creative credits only if provider work is not billable.
- If the provider charged despite cancellation, settle credits and record provider cost metadata.

Audit events:

- `creative_generation.cancel_requested`
- `creative_generation.cancel_confirmed`
- `creative_generation.cancel_failed`

Notification:

- Notify the original user when cancellation changes the visible generation state.
- Notify creative operations if provider cancellation fails or times out.

Idempotency:

- Use `admin_cancel:{generationId}:{providerJobId}`.
- Replayed cancellation requests should return the current cancellation state.

Rollback:

- If provider cancellation fails, leave the generation in `running` or `failed` based on provider status and record `cancel_failed`.
- Never delete provider job ids or output asset links during rollback.

### Force Review

Trigger conditions:

- Generation is `completed`.
- At least one output asset exists.
- Operator identifies a safety, policy, ownership, or abuse concern.

Disallowed:

- Generations already in `review_required`.
- Failed or cancelled generations with no output.
- Raw prompt disclosure as a reason; use safe prompt hash/preview only.

State and accounting:

- Set generation status to `review_required` or attach a review-required policy override while preserving original completion metadata.
- Move linked media assets into the existing media governance review path when possible.
- Do not change quota or credit status; provider work completed.

Audit event:

- `creative_generation.force_review_requested`
- Metadata: generation id, output asset ids, reason code, policy/safety references, previous media statuses.

Notification:

- Notify media queue operators.
- Notify the original user only if the output becomes unavailable or delayed.

Idempotency:

- Use `admin_force_review:{generationId}:{reasonCode}`.
- Repeated force-review actions should not duplicate media review queue entries.

Rollback:

- Release/reject media through the media governance queue.
- A rollback to completed state must require `admin:creative:review` and preserve audit history.

### Refund Creative Credits

Trigger conditions:

- Generation credit state is `settled`.
- Output is unusable because of provider failure, media persistence failure, policy reversal, duplicate provider charge, or confirmed operator incident.
- Operator provides a reason code and refund amount.

Disallowed:

- Payment-provider refunds.
- Task marketplace point adjustments.
- Refunds for unsettled reservations; those should use cancellation/refund of reservation state.
- Refunds that exceed settled creative credits.

State and accounting:

- Create an idempotent creative credit refund entry tied to the generation and original settlement.
- Keep quota committed by default if provider work occurred.
- Do not remove output assets; use media governance to gate visibility.
- Partial refunds must record amount, currency/credit unit, and reason.

Audit event:

- `creative_generation.credit_refunded`
- Metadata: generation id, original credit ledger id, refund ledger id, amount, reason code, provider id, provider job id, previous credit status.

Notification:

- Notify the original user when user-visible balance changes.
- Notify finance/ops channel for high-value refunds after budget alarm requirements exist.

Idempotency:

- Use `admin_credit_refund:{generationId}:{settlementLedgerId}:{refundAmount}:{reasonCode}`.
- Duplicate requests must not double-refund.

Rollback:

- A refund reversal is a separate compensating credit settlement/correction, not deletion of the refund ledger entry.
- Reversal requires `admin:creative:credits:adjust` and a new audit event.

### Manual Settlement

Trigger conditions:

- Provider result is known, but automatic settlement/refund/cancel did not complete.
- Webhook/polling replay found a stuck reservation.
- Admin generation history shows inconsistent generation, quota, credit, or media state.
- Operator has provider evidence and internal audit context.

Disallowed:

- Guessing settlement without provider evidence.
- Settlement for moderation-blocked requests that never reached provider work.
- External payment-provider reconciliation.

State and accounting:

- Manual settlement must choose exactly one economic outcome: settle, refund, cancel/no-charge, or mark provider-disputed.
- Quota outcome must be explicit: commit, release, or leave unchanged.
- Media outcome must be explicit: keep gated, move to review, or no output.
- Provider cost metadata should be attached when known, but later cost metadata schema work will define exact fields.

Audit events:

- `creative_generation.manual_settlement_requested`
- `creative_generation.manual_settlement_applied`
- `creative_generation.manual_settlement_rejected`

Notification:

- Notify original user only when visible status or credit balance changes.
- Notify finance/creative operations when settlement changes credit or cost state.

Idempotency:

- Use `admin_manual_settlement:{generationId}:{targetOutcome}:{operatorRequestId}`.
- Store before/after state snapshots with safe metadata only.

Rollback:

- Use compensating ledger entries and status transitions.
- Never hard-delete generation, quota, credit, or media records.
- Manual settlement rollback should be available only after the cost metadata and budget alarm task defines cost correction rules.

## Audit Metadata Requirements

All future mutation endpoints must record:

- actor id and role
- required permission
- generation id
- provider id and safe provider job id
- workspace and mode
- previous generation status
- target generation status
- previous quota state and target quota state
- previous credit state and target credit state
- linked media asset ids
- reason code
- operator notes preview or note hash
- idempotency key
- provider evidence reference, if applicable
- notification ids, if created

Do not record:

- full raw prompt text
- provider API tokens
- webhook secrets
- bearer tokens
- full provider request/response payloads containing credentials or user-sensitive data
- payment method data

## Notification Inventory

| Event | Recipient | User-visible by default | Notes |
| --- | --- | --- | --- |
| Retry started | Original user, creative ops | Yes | Suppress user notification for internal diagnostics-only retries |
| Retry completed/failed | Original user, creative ops on failure | Yes | Link to generation result when safe |
| Cancel requested/confirmed | Original user, creative ops | Yes | Use provider-neutral copy |
| Cancel failed | Creative ops | No | User state should remain stable until final outcome |
| Force review | Media queue operators; original user only if output becomes unavailable | Conditional | Reuse media governance review workflow |
| Credit refund | Original user, finance/ops for high value | Yes | Must show internal credit amount only |
| Manual settlement | Finance/creative ops; original user only if visible state changes | Conditional | Requires detailed audit context |

## First Staging Phase Recommendation

For the first real-provider staging adapter, keep all mutation controls disabled.

Allowed in first staging phase:

- read-only Admin generation history
- provider adapter contract tests
- staging-only provider preflight
- provider callback/polling replay tests
- internal logs/audit events

Still disabled in first staging phase:

- retry button
- cancel button
- force-review button
- refund button
- manual settlement button
- payment-provider refunds

The earliest safe mutation to implement later is force-review, because it does not change quota or credit accounting and can reuse media governance. Retry, cancel, refund, and manual settlement should wait until provider cost metadata and budget alarms are defined.

## Acceptance Checklist For Implementation Later

Before any mutation endpoint is implemented:

- Add executable permissions to `server/src/auth/permissions.js`.
- Update `docs/PERMISSION_MATRIX.md`.
- Update OpenAPI paths and protected-route verification.
- Add request parsers with explicit reason codes and idempotency keys.
- Add repository methods with atomic state transitions.
- Add audit events and notification tests.
- Add conflict tests for duplicate/replayed mutation requests.
- Add failure tests for quota/credit/media partial updates.
- Keep Admin UI controls hidden until backend guards and tests exist.
