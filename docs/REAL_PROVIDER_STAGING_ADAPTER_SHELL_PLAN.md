# Real Provider Staging Adapter Shell Plan

This plan defines the next safe implementation boundary for the Replicate image staging adapter shell.

Current decision: **go for fixture-only staging adapter shell hardening, no-go for real provider network calls**.

The repository remains mock-provider by default. This plan does not approve a provider SDK, default HTTP client, external provider job creation, output download from provider URLs, provider callback route, enabled real provider polling, manual replay endpoint, Admin mutation control, payment-provider refund flow, or production paid-provider enablement.

## Purpose

The goal of the staging adapter shell phase is to make the future first external-call rehearsal boring:

- request construction is deterministic and testable before a provider client exists
- provider status and failure mapping is covered with injected fixtures
- provider spend metadata and budget guards fail closed before dispatch
- production remains denied by environment validation and smoke checks
- the default route continues to use mock or disabled provider behavior
- all external-call approval evidence is ready before a real network-capable client is introduced

## Current Implementation Inventory

| Surface | Current status | Boundary |
| --- | --- | --- |
| Provider registry metadata | Available safe metadata | `replicate-staging` is configured only in staging mode, remains `enabled=false`, `default=false`, `adapterImplemented=false`, and `networkCallsEnabled=false`. |
| Environment validation | Available | `CREATIVE_PROVIDER_MODE=replicate_staging` requires staging runtime, Replicate candidate, token presence, and `staging-only` confirmation; production rejects staging token usage. |
| Request construction | Available fixture-safe | `buildReplicateImagePredictionPayload` maps image `text_to_image` requests to a Replicate-like payload without making network calls, and allowlists provider-facing parameters before an injected client can see them. |
| Provider cost metadata | Available fixture-safe | Cost estimate, daily cap, spend, threshold, budget scope, and account reference are normalized into safe low-cardinality metadata. |
| Budget guard | Available fixture-safe | Missing estimate, missing cap, unsafe metadata, invalid threshold, or projected over-budget spend blocks before an injected client can dispatch. |
| Generation mapping | Available fixture-safe | Replicate-like prediction statuses map to internal generation states with safe failure previews. |
| Status polling client contract | Available injected only | Status reads require an injected `getPrediction` client; no default HTTP client exists. |
| Prediction creation contract | Available injected only | Prediction creation requires an injected `createPrediction` client; no SDK or network-capable client exists. |
| Lifecycle replay helpers | Available fixture-safe | Replicate-like lifecycle events map into replay reducer decisions with output digests, duplicate suppression, and job mismatch rejection. |
| Route-level fixture path | Available through injected adapters | Policy, quota, credit, generation records, and media persistence can be exercised with fixture adapters only. |
| Fixture output evidence | Available fixture-safe | Completed Replicate fixture outputs are persisted behind media-governed download paths; raw provider output URLs are not returned from creative generation responses, stored in media artifact metadata, or exposed through read-only Admin generation evidence. |
| Staging smoke | Available metadata-only | Validates env gates and safe catalog metadata; it does not call Replicate. |

## Allowed Shell Work

The next implementation PRs may do the following without external-call approval:

1. Add or harden tests around `buildReplicateImagePredictionPayload`, including supported parameters and rejected non-image modes.
2. Add fixture tests for safe failure mapping, timeout/rate-limit mapping, and redacted error previews.
3. Add fixture tests for cost estimate, daily budget cap, threshold, budget scope, and provider account reference guards.
4. Add fixture tests proving route-level policy, quota, credit reservation, generation record, and media persistence run before or around injected provider work.
5. Add fixture tests that status reads and prediction creation fail closed unless a test explicitly injects a client.
6. Improve metadata-only smoke assertions while keeping `networkCallsEnabled=false`.
7. Improve read-only Admin history display of provider cost, budget, and replay evidence when backed by fixture records.
8. Update docs, OpenAPI descriptions, or runbooks when they describe the existing mock/fixture boundary.

These tasks can be split into multiple small PRs. Each task must keep CI independent from provider credentials.

## Not Approved By This Plan

This plan does not approve:

- Installing or importing a real Replicate SDK.
- Adding a default provider HTTP client.
- Creating a provider prediction/job from app code.
- Reading provider status from a real provider API.
- Downloading provider output URLs.
- Enabling callback/webhook routes.
- Enabling real provider polling.
- Adding manual replay endpoints or Admin replay buttons.
- Adding Admin retry, cancel, refund, force-review, or manual settlement controls.
- Storing raw provider payloads, raw provider responses, raw prompts, raw error bodies, output URLs, tokens, or secrets.
- Enabling production paid-provider execution.

## Required Shell Contracts

Every staging shell PR must preserve these contracts:

- Default local and CI mode remains mock unless a test deliberately passes staging fixture env.
- `GET /api/creative/providers` may expose safe staging metadata but must keep `replicate-staging` unavailable by default.
- `POST /api/creative/generations` must not dispatch to Replicate unless the test injects a fixture adapter.
- Missing or unsafe budget metadata must fail before injected provider dispatch.
- Provider request payloads must exclude app secrets, raw internal audit metadata, payment data, and user credentials.
- Provider-facing request parameters and returned generation parameters must be allowlisted so unsupported provider-like fields such as API keys, authorization values, callback URLs, raw payload markers, or raw response hints cannot be echoed through fixture paths.
- Provider responses must store only safe ids, hashes, counts, status names, cost metadata, and redacted previews.
- Completed fixture outputs must still flow through media persistence and scan-governance boundaries before user download.
- Replicate fixture output URLs must remain provider-private evidence: user/API/Admin surfaces may expose only the media asset download path and safe storage ids after persistence.
- Quota and creative credit reservation/settlement/refund behavior must remain idempotent.
- Production smoke must keep creative provider mode `mock` or `disabled`.

## Suggested Task Sequence

1. **Shell contract coverage**
   - Expand unit tests for request construction, status mapping, failure mapping, and budget guard outcomes.
   - Confirm no default client can dispatch.

2. **Route fixture hardening**
   - Exercise `POST /api/creative/generations` with an injected staging fixture adapter.
   - Prove moderation and quota happen before provider work.
   - Prove quota release and credit refund behavior stay idempotent on fixture failures.

3. **Cost and budget observability**
   - Persist and surface safe provider cost metadata in read-only Admin generation history.
   - Keep provider spend separate from product creative credits and external billing.
   - Current fixture-safe status: Admin generation history sanitizes `usage.providerCost` through an allowlist before returning list/detail records, and the Admin UI shows read-only provider cost and budget summaries. Tests prove raw provider payload fields, output URLs, billing-account traces, and other unknown provider metadata are not exposed.

4. **Metadata smoke closeout**
   - Keep `networkCallsEnabled=false` and `adapterImplemented=false` until a separately approved PR intentionally changes the closeout state.
   - Record smoke results in Notion in Chinese.

5. **External-call approval preparation**
   - Complete the approval record in `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md`.
   - Require explicit user approval naming provider, staging environment, maximum call count, budget cap, expiry, token rotation owner, kill-switch owner, and production no-go.

6. **Single staging external-call rehearsal**
   - Only after approval, introduce a network-capable client in a narrow PR or operator-run branch.
   - Keep the rehearsal limited to the approved maximum call count.

Callback/polling route/client work remains later than the first external-call rehearsal unless separately approved through `docs/REAL_PROVIDER_CALLBACK_POLLING_PREREQUISITES.md`.

## Validation

Every shell planning or fixture-hardening PR should pass:

```bash
git diff --check
npm run check:quick
npm run check:deploy
```

Targeted tests should be added when code changes touch:

- `server/src/creative/replicateStagingProvider.js`
- `server/src/creative/providerRegistry.js`
- `server/src/creative/generationService.js`
- `server/src/modules/creative/routes.js`
- `server/src/config/env.js`
- `scripts/smoke-creative-staging.mjs`

No validation command should require a real provider credential.

## Handoff To External-Call Work

Before any real external call, the operator must verify:

- This shell plan is still current.
- `docs/REAL_PROVIDER_BOUNDARY_CLOSEOUT.md` still marks real provider network calls no-go unless explicitly approved.
- `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md` has a complete approval record in Notion.
- `docs/REAL_PROVIDER_STAGING_SMOKE_RUNBOOK.md` preflight and adapter-shell smoke evidence is recorded.
- `docs/REAL_PROVIDER_CALLBACK_POLLING_PREREQUISITES.md` remains no-go for callbacks, real polling, and manual replay unless separately approved.
- Production paid-provider enablement remains no.
