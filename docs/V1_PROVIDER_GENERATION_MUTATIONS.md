# V1 Provider Generation Mutations

Task: V1-08

## Scope

V1-08 adds application-side cancellation, retry, and reviewed manual Provider lifecycle replay. It does not enable a real Provider mutation client, paid Provider request, real-money refund, payment, or withdrawal.

## Endpoints

- `POST /api/creative/generations/:id/cancel`
- `POST /api/creative/generations/:id/retry`
- `POST /api/admin/creative/generations/:id/cancel`
- `POST /api/admin/creative/generations/:id/retry-requests`
- `POST /api/admin/creative/generations/:id/manual-replay-requests`
- `POST /api/admin/reviews/:id/actions` for manual replay approval or rejection

Every mutation requires an idempotency key and writes `creative_generation_mutations`. The Admin routes use dedicated `admin:creative:cancel`, `admin:creative:retry`, and `admin:creative:replay` permissions.

## Cancellation

- Only `queued` or `running` generations are cancellable.
- Users can cancel only their own generation; dedicated Admin permission bypasses ownership.
- A generation with a Provider job id requires an explicitly injected cancellation adapter.
- No default adapter performs network traffic.
- Credits and quota are refunded/released only when no Provider charge is confirmed.
- Duplicate idempotency keys return the original mutation outcome.

## Retry

- Only `failed` or `cancelled` generations are retryable.
- The original terminal generation is never reopened.
- Retry creates a child generation with `retryOfId` and an incremented `attemptNumber`.
- The owner must resubmit the complete request. Prompt hash, workspace, mode, Provider, input assets, and parameter keys must match the original safe record.
- Raw prompts are not added to durable generation or mutation records.
- Admin retry creates a one-time authorization; it cannot reconstruct or submit the user's prompt.

## Manual Replay

- Manual replay accepts only allowlisted lifecycle identifiers and normalized status.
- Raw prompts, Provider payloads/responses, output URLs, and secret-bearing fields are rejected.
- The request enters `creative_provider_replay` review and cannot be approved by its requester.
- Approval writes through the existing Provider replay ledger before side effects run.
- A `completed` replay is accepted only when output assets are already durably persisted.
- Terminal generations are not reopened.

## Notifications

- Successful cancellation notifies the generation owner once; an idempotent duplicate does not create another unread notification.
- Retry completion or failure notifies the owner of the child attempt.
- Admin retry authorization notifies the original generation owner that user confirmation is still required.
- Manual replay request and review outcomes notify the generation owner; approval, rejection, and execution results also notify the operator who requested the review.
- Notification metadata contains only generation, mutation, review, workspace, and safe navigation identifiers. It never includes raw prompts or Provider payloads.

## Runtime Boundary

Tests inject fixture adapters where Provider behavior must be simulated. Production defaults register no Provider cancellation client and make no new outbound Provider request. Existing callback and polling gates remain independently default-off.

## Verification

- Repository tests cover mutation idempotency and retry relations.
- Service tests cover ownership, accounting release, default-disabled Provider cancellation, input matching, child attempt allocation, and failed retry notification.
- Creative route tests cover user cancel/retry, duplicate suppression, and owner notifications.
- Admin route tests cover dedicated permissions, retry authorization, owner notification, manual replay self-approval denial, approved/rejected replay execution, and owner/requester notifications.
- OpenAPI, frontend contracts, Admin controls, runtime inventory, Prisma schema, and migration are checked by the standard PR gate.
