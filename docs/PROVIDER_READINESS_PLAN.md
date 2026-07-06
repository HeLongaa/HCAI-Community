# Provider Readiness Plan

This document defines the follow-up phase after Phase 3 Track C closeout. The goal is to make the creative generation system ready for real provider integration without connecting any paid external provider yet.

The current Track C baseline already has a creative provider abstraction, mock provider, Image Studio integration, generated media assets, scan/download governance, quota policy, moderation blocks, and policy review routing. Provider readiness adds the durable records and ledgers required before a real provider can safely spend money or run long-lived jobs.

## Objective

Create a reliable accounting and operations foundation for creative generation:

- every generation has a durable, queryable record
- quota is enforced across API instances
- credits can be reserved, settled, refunded, and audited
- generation status and failure states are explicit
- Admin users can inspect generation history and linked assets

This phase should leave the mock provider path working exactly as it does today while replacing process-local accounting with durable repository-backed state.

## Non-Goals

Provider readiness must stay narrow. It should not include:

- real paid provider credentials or API calls
- provider-specific infrastructure templates
- real payment, subscription, invoice, or checkout flows
- full plan/package management
- replacing Music Studio, Video Studio, Chat, Explore, or catalog demo surfaces
- async video/music provider polling or webhook integration
- bypassing media scan or private download governance
- manual Admin retry/cancel/refund controls before the read-only history surface exists

## Current Baseline

The current creative flow is:

1. Image Studio calls `POST /api/creative/generations`.
2. The backend validates workspace, mode, provider availability, quota, moderation, and review policy.
3. The mock provider returns deterministic output descriptors.
4. Outputs are persisted as media assets through storage and scan governance.
5. The frontend displays provider/mock state, generated media asset id, scan status, usage, quota, and gated download state.

Current limitations:

- generation state is not represented by a durable generation table
- quota counters are process-local and reset on process restart
- quota is not safe for horizontally scaled API instances
- credits are metadata only; there is no reservation, settlement, or refund lifecycle
- provider failure states are not modeled beyond request errors
- Admin users can review generated media assets but cannot inspect generation history as a first-class object

## Design Principles

- **Durable before paid:** no real provider should be connected until durable records and ledgers exist.
- **One source of truth per concern:** generation record owns lifecycle state, quota ledger owns limit consumption, credit ledger owns economic outcome, media assets own stored output and scan state.
- **Idempotent by default:** each reservation, settlement, refund, and provider result should have a stable source id to prevent duplicate accounting.
- **Safe metadata only:** prompt previews and hashes may be stored; full raw prompts and provider secrets should not be exposed in Admin or public responses.
- **Mock-compatible:** the mock provider must exercise the same generation, quota, credit, and Admin history paths.
- **Repository parity:** seed repository and Prisma repository should expose the same behavior, even if seed uses in-memory structures.
- **Review stays media-governed:** generated outputs that require review continue to use media scan/review governance before download.

## Domain Model

### Creative Generation

Purpose: durable lifecycle record for a creative generation request.

Suggested fields:

| Field | Purpose |
| --- | --- |
| `id` | Stable generation id returned by API |
| `actorId` / `actorHandle` | Request owner |
| `workspace` | `image`, `video`, `music`, or `chat` |
| `mode` | Provider mode such as `text_to_image` |
| `providerId` / `providerMode` | Safe provider identity and mode |
| `status` | Lifecycle status |
| `promptHash` | Full prompt hash for dedupe/audit without raw prompt exposure |
| `promptPreview` | Short safe preview for Admin and support |
| `inputAssetIds` | Linked source media assets |
| `parameterKeys` | Safe parameter key list |
| `outputAssetIds` | Linked generated media assets |
| `usage` | Estimated credits, provider cost metadata, cost model |
| `quota` | Quota window and accounting result |
| `safety` | Moderation and review metadata |
| `policy` | Policy version and enforced gates |
| `providerRequestId` | Optional future provider request id |
| `providerJobId` | Optional future provider async job id |
| `errorCode` / `errorMessagePreview` | Safe failure metadata |
| `createdAt`, `startedAt`, `completedAt`, `failedAt`, `updatedAt` | Lifecycle timestamps |

Suggested statuses:

- `queued`: durable record created, work not started
- `running`: provider execution or persistence in progress
- `completed`: outputs persisted and generation finished
- `review_required`: outputs exist but one or more assets require manual review
- `failed`: provider execution, persistence, or policy accounting failed
- `cancelled`: user/system cancellation before completion

For the current mock path, the normal flow can be `queued -> running -> completed` or `queued -> running -> review_required` when safety review is required.

### Creative Quota Ledger

Purpose: cross-instance quota accounting for generation attempts.

Suggested key:

- `actorId`
- `workspace`
- `windowType`, initially `daily`
- `windowStart`
- `windowEnd`

Suggested counters:

- `limit`
- `reserved`
- `used`
- `released`
- `remaining`

Suggested operations:

- `reserveQuota(generationId, actor, workspace, costUnits, window)`
- `commitQuota(generationId)`
- `releaseQuota(generationId, reason)`
- `getQuotaWindow(actor, workspace, now)`

Concurrency requirement:

- Prisma implementation must update quota atomically inside a transaction or use an equivalent compare/update strategy.
- Two concurrent generation requests for the same actor/workspace/window must not both pass when only one quota unit remains.

### Creative Credit Ledger

Purpose: economic accounting for creative generation credits independent from task marketplace reward settlement.

Recommended posture:

- Do not overload task reward settlement semantics.
- Either create a dedicated creative credit ledger now or create a dedicated source type boundary in the existing point ledger only if the data model can preserve reservation/refund clarity.
- Keep external payments and subscription packages out of this phase.

Suggested lifecycle:

1. `reserved`: request passed validation, quota, and moderation; credits are held.
2. `settled`: generation completed and provider work should be charged.
3. `refunded`: provider/persistence failed or output could not be used.
4. `cancelled` / `no_charge`: validation, auth, quota, or moderation blocked before provider work.

Suggested fields:

| Field | Purpose |
| --- | --- |
| `id` | Ledger row id |
| `generationId` | Stable source id for idempotency |
| `actorId` / `actorHandle` | Account owner |
| `workspace` / `mode` | Source context |
| `reservationAmount` | Credits reserved |
| `settledAmount` | Credits finally charged |
| `refundedAmount` | Credits returned |
| `status` | `reserved`, `settled`, `refunded`, `cancelled` |
| `reasonCode` | `generation_completed`, `provider_failed`, `moderation_blocked`, etc. |
| `metadata` | Safe cost and provider metadata |
| `createdAt`, `settledAt`, `refundedAt` | Accounting timestamps |

Idempotency requirement:

- `generationId + action` should be unique enough that retrying settlement or refund cannot double-charge or double-refund.
- Provider callbacks and request retries must resolve to the same generation record before mutating credit state.

### Admin Generation History

Purpose: read-only operational visibility for generation records.

Backend API candidates:

- `GET /api/admin/creative/generations`
- `GET /api/admin/creative/generations/:id`

Filters:

- `userHandle`
- `workspace`
- `mode`
- `providerId`
- `status`
- `reviewRequired`
- `mediaAssetId`
- `dateFrom` / `dateTo`
- `search`

Detail response should include:

- generation summary
- quota ledger summary
- credit ledger summary
- linked media assets and scan statuses
- safe prompt preview/hash
- moderation reasons
- provider safe metadata
- audit event ids where available

Permission options:

- list/detail should require `admin:queue:read` or `admin:audit:read`
- any future retry/refund/cancel action should require a stricter permission and a separate planning slice

## Lifecycle

### Successful Generation

1. Authenticate actor.
2. Parse and validate generation request.
3. Create creative generation record with `queued`.
4. Run moderation policy.
5. Reserve quota.
6. Reserve credits.
7. Mark generation `running`.
8. Execute provider adapter.
9. Persist outputs as media assets.
10. Link output asset ids to generation.
11. Set generation `completed` or `review_required`.
12. Commit quota.
13. Settle credits.
14. Return generation response.

### Moderation Block

1. Authenticate and validate request.
2. Create generation record only if the product wants blocked attempts visible to Admin; otherwise record audit event only.
3. Run moderation policy.
4. Return `CREATIVE_MODERATION_BLOCKED`.
5. Do not reserve quota or credits.

Recommended first implementation: create a minimal failed/blocked generation record only after the durable generation model is present, but keep full prompt out of metadata.

### Quota Exceeded

1. Authenticate and validate request.
2. Run moderation policy.
3. Attempt quota reservation.
4. If the ledger denies reservation, return `CREATIVE_QUOTA_EXCEEDED`.
5. Do not reserve credits or execute provider.

### Provider Or Persistence Failure

1. Generation is already `running`.
2. Provider or persistence fails.
3. Set generation `failed` with safe error metadata.
4. Release quota reservation if no provider work should count against quota; otherwise commit quota depending on policy.
5. Refund credit reservation.
6. Return stable error response.

Recommended default: provider/persistence failure refunds credits. Whether quota is released or committed should be explicit in policy metadata.

### Review Required

1. Provider completes and output is persisted.
2. Safety policy or scanner marks output `review`.
3. Generation becomes `review_required`.
4. Quota commits.
5. Credits settle by default because provider work completed.
6. Download remains gated by media governance.

## Repository API Shape

Provider readiness should add repository methods before widening routes:

```js
repositories.creativeGenerations.create(payload, actor)
repositories.creativeGenerations.markRunning(id, patch, actor)
repositories.creativeGenerations.complete(id, patch, actor)
repositories.creativeGenerations.fail(id, patch, actor)
repositories.creativeGenerations.linkOutputAssets(id, assetIds, actor)
repositories.creativeGenerations.list(options, actor)
repositories.creativeGenerations.find(id, actor)

repositories.creativeQuota.reserve(payload, actor)
repositories.creativeQuota.commit(generationId, actor)
repositories.creativeQuota.release(generationId, reason, actor)

repositories.creativeCredits.reserve(payload, actor)
repositories.creativeCredits.settle(generationId, payload, actor)
repositories.creativeCredits.refund(generationId, payload, actor)
```

Seed repository can use in-memory maps with the same DTO shape. Prisma repository should use real tables and transactions.

## Suggested PR Slices

### 0. Scope And Architecture Plan

Current slice.

Deliverables:

- `docs/PROVIDER_READINESS_PLAN.md`
- README and Phase 3 plan links
- Notion provider-readiness task list

Validation:

- `git diff --check`
- `npm run check:quick`

### 1. Durable Generation Record

Deliverables:

- Prisma model and migration
- seed repository map
- creative generation repository methods
- route/service integration for current mock flow
- linked output asset ids
- tests for create, complete, failed, review-required records

Validation:

- Prisma validation
- route/service/repository tests
- `npm run check:deploy`

### 2. Cross-Instance Quota Ledger

Deliverables:

- durable quota table
- quota repository methods
- replace process-local quota counter in policy path
- concurrent reservation tests
- quota release/commit behavior for failures

Validation:

- quota accounting tests
- route tests for exceeded quota and releases
- `npm run check:deploy`

### 3. Credit Reservation Lifecycle

Deliverables:

- creative credit ledger or dedicated source boundary
- reserve/settle/refund/cancel operations
- integration with generation success/failure/review paths
- idempotency tests

Validation:

- reservation and settlement tests
- refund and replay tests
- failure route tests
- `npm run check:deploy`

### 4. Admin Generation History Backend

Deliverables:

- admin list/detail routes
- filters and pagination
- safe detail DTO with linked media, quota, credit, and safety metadata
- permission matrix and OpenAPI updates

Validation:

- permission tests
- pagination/filter tests
- detail tests
- API contract drift checks
- `npm run check:deploy`

### 5. Admin Generation History UI

Deliverables:

- typed frontend service
- Admin Center read-only generation history surface
- filters for user/workspace/provider/status/review/date
- linked media asset display
- feature simulation or focused browser coverage

Validation:

- lint/build
- simulation checks
- focused E2E where practical
- `npm run check:deploy`

### 6. Provider Readiness Closeout

Deliverables:

- closeout document
- README/Phase docs updates
- Notion task status updates
- explicit boundary for real provider integration

Validation:

- `git diff --check`
- `npm run check:quick`
- `npm run check:deploy`

## Open Decisions

These decisions should be made in the first implementation PR before schema is finalized:

1. **Dedicated credit ledger or point ledger extension:** recommended default is a dedicated creative credit ledger to avoid mixing task reward semantics with provider cost accounting.
2. **Blocked generation records:** decide whether moderation/quota blocked attempts create generation records or audit events only.
3. **Quota release policy:** decide whether provider failures release quota or count against daily usage. Recommended default: release quota on provider/persistence failure, commit quota on completed or review-required output.
4. **Credit settlement on review-required output:** recommended default: settle credits because provider work completed, while download remains gated by media governance.
5. **Admin permissions:** decide whether read-only generation history uses `admin:queue:read`, `admin:audit:read`, or a new creative admin permission.
6. **Prompt retention:** recommended default: prompt hash and short preview only; no full prompt in Admin list or media metadata.

## Quality Gate

Every provider-readiness PR should pass:

```bash
git diff --check
npm run check:quick
npm run check:deploy
```

Real provider checks should not be added until a separate real-provider phase exists.
