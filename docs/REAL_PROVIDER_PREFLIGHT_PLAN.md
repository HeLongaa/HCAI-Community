# Real Provider Preflight Plan

This plan starts after provider-readiness closeout. Its purpose is to prepare for a guarded staging-only real provider adapter without accidentally connecting a paid provider in local, CI, or production environments.

The current runtime remains mock-provider only. No real provider credentials, external API calls, async polling/webhook integration, or Admin retry/cancel/refund mutation controls are introduced by this plan.

## Scope

Preflight work should answer five questions before any real provider adapter PR:

1. What contract must every provider adapter satisfy?
2. Which provider can be enabled in staging only, and how are its secrets protected?
3. Which Admin mutation controls are allowed, which permissions guard them, and which stay deferred?
4. What cost metadata and budget alarms are required before provider spend?
5. What closeout gate must pass before a staging provider can be enabled?

## Task List

### 1. Provider Adapter Contract Tests

Status: complete in PR #25.

Deliverables:

- `server/src/creative/providerAdapterContract.js`
- `server/src/creative/providerAdapterContract.test.js`
- mock-provider execution path validates its output against the same contract

Contract requirements:

- Provider generation results must use known lifecycle statuses.
- `completed` and `review_required` results must include at least one output.
- `queued` and `running` async placeholders may omit outputs but must still preserve generation identity.
- Failed generations must include safe `errorCode` and `errorMessagePreview` metadata.
- Provider identity, workspace, and mode must match the original request.
- Provider, usage, safety, policy, output storage, and output source metadata must not expose secret-like keys.
- Provider failures must be mapped to safe rate-limit, timeout, or generic failure metadata with redacted messages.

Non-goals:

- Real provider adapter implementation.
- Real provider credential handling.
- Webhook or polling route implementation.

### 2. Staging-Only Provider Selection And Secrets Strategy

Status: complete in PR #26.

Deliverables:

- `docs/REAL_PROVIDER_STAGING_STRATEGY.md`
- first provider candidate and selection rationale
- environment flag strategy
- secret storage and rotation checklist
- CI/local/production protections to prevent paid calls
- staging smoke requirements

Current decision:

- First candidate: Replicate image generation through its Predictions API.
- Preflight is metadata-only and fail-closed: staging can validate secret presence only while `CREATIVE_PROVIDER_MODE=disabled`.

Non-goals:

- implementing provider API calls
- enabling provider calls in production

### 3. Admin Generation Mutation Requirements

Status: complete in PR #27.

Deliverables:

- `docs/REAL_PROVIDER_ADMIN_MUTATION_REQUIREMENTS.md`
- retry, cancel, force-review, refund, and manual settlement requirements
- permission matrix proposal
- audit event and notification inventory
- idempotency and rollback semantics

Current recommendation:

- Keep every Admin generation mutation disabled in the first real-provider staging phase.
- Use dedicated future permissions instead of reusing `admin:audit:read`, `admin:queue:review`, or `points:adjust`.
- Implement force-review first later, because it does not mutate quota or credit accounting.

Non-goals:

- mutation endpoints
- Admin mutation UI
- payment-provider refunds

### 4. Provider Cost Metadata And Budget Alarms

Status: complete in PR #28.

Deliverables:

- `docs/REAL_PROVIDER_COST_METADATA_AND_BUDGET_ALARMS.md`
- provider cost metadata schema
- safe Admin visibility boundary
- budget threshold and anomaly alert policy
- metrics and audit mapping

Current recommendation:

- Keep product creative credits separate from provider spend metadata.
- Store estimate/actual cost with confidence, usage unit, pricing snapshot, and budget scope.
- Fail closed before paid dispatch when estimate, currency, budget scope, or cap state is missing.

Non-goals:

- external billing reconciliation
- subscription or invoice management

### 5. Real-Provider Readiness Closeout Gate

Status: in progress.

Deliverables:

- `docs/REAL_PROVIDER_READINESS_CLOSEOUT_GATE.md`
- final go/no-go checklist
- required validation commands
- staging-only environment checklist
- rollback and kill-switch checklist
- Notion/README/docs status sync

Current recommendation:

- Conditional go for a guarded staging-only Replicate image adapter phase after this closeout gate merges.
- No-go for production paid-provider enablement.
- Keep video, music, chat, production, and Admin mutation controls out of the first staging adapter phase.

Non-goals:

- real provider adapter implementation
- production enablement

## Quality Gate

Every preflight PR should pass:

```bash
git diff --check
npm run check:quick
npm run check:deploy
```

Provider-specific external checks should only be added after a staging-only provider is selected and guarded by explicit environment flags.
