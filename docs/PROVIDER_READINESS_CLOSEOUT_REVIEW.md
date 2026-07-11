# Provider Readiness Closeout Review

This review records the final provider-readiness consistency pass after the durable generation, quota ledger, credit ledger, and Admin generation history closeout slices.

Review date: 2026-07-09.

Current conclusion: **provider readiness is closed out for fixture CI and handoff purposes, but the repository remains
provider-ready, not real-provider-connected**. V1-05 adds a default-disabled HTTP client and deployment-secret boundary;
real paid-provider calls, default route/worker registration, real Provider SDKs, callback routes, enabled real polling,
manual replay endpoints, Admin retry/cancel/refund mutations, external Provider alert delivery, and production
paid-provider enablement remain no-go.

## Source Of Truth

Start future provider work from these documents:

1. `docs/REAL_PROVIDER_CURRENT_STATUS.md`
2. `docs/PROVIDER_READINESS_CLOSEOUT.md`
3. `docs/REAL_PROVIDER_BOUNDARY_CLOSEOUT.md`
4. `docs/REAL_PROVIDER_READINESS_CLOSEOUT_GATE.md`
5. `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md`

Ordinary continuation language such as "continue", "next", "looks good", or "ship it" is not approval for a real provider call.

## Review Matrix

| Area | Current Closeout Boundary | Evidence | Review Result |
| --- | --- | --- | --- |
| Durable generation records | Store prompt hash/preview, lifecycle status, safe provider ids, usage, quota, credit, safety, policy, and linked media ids. Do not store raw full prompt in Admin history. | `server/src/repositories/creativeGenerations.test.js`, `server/src/creative/providerAdapterContract.test.js`, `server/src/modules/admin/routes.test.js` | Aligned. Failure previews are redacted and Admin history omits raw `prompt`. |
| Quota ledger | Reserve before provider work; commit on completed work; release on non-billable failure; repeat commit/release is idempotent. | `server/src/repositories/creativeQuota.test.js`, `server/src/modules/creative/routes.test.js` | Aligned. Quota audit metadata is limited to safe identifiers and redacted reason text. |
| Credit ledger | Reserve product creative credits, settle on completed/review-required outputs, refund on failure, and dedupe repeated settle/refund. | `server/src/repositories/creativeCredits.test.js`, `server/src/modules/creative/routes.test.js`, `server/src/creative/providerSideEffectPlan.test.js` | Aligned. Credit metadata is allowlisted; reason text and string metadata are redacted. |
| Admin generation history | Read-only list/detail surface with safe filters and safe replay evidence. No mutation controls. | `server/src/modules/admin/routes.test.js`, `docs/REAL_PROVIDER_ADMIN_MUTATION_REQUIREMENTS.md` | Aligned. Read-side sanitizer covers usage/provider cost, credit, quota, safety, policy, provider ids, failure previews, and replay summaries. |
| Provider replay foundation | Fixture-only replay ledger, lifecycle reducer, side-effect plan, and integration helpers. No callback route, default status client, or manual replay endpoint. | `server/src/creative/providerReplayIntegration.test.js`, `server/src/creative/providerSideEffectPlan.test.js`, `server/src/creative/providerPollingWorker.test.js` | Aligned. Duplicate/stale replay behavior is idempotent and evidence remains safe. |
| Staging provider shell | Replicate staging shell exposes safe metadata and injected fixture behavior; V1-05 adds a separate default-disabled HTTP client without route registration. | `server/src/creative/replicateStagingProvider.test.js`, `server/src/creative/providerHttpClient.test.js`, `server/src/creative/generationService.test.js`, `scripts/smoke-creative-staging.mjs` | Aligned. Smoke validates metadata-only preflight, implemented client metadata, and disabled adapter/network state. |
| Provider budget operations | Safe read-side audit, notification, metrics, exporter, fixture dry-run, and Admin cost/budget summaries. No real external alert delivery. | `server/src/creative/providerBudget*.test.js`, `docs/REAL_PROVIDER_BUDGET_OPERATIONS_READSIDE_CLOSEOUT.md` | Aligned. Payloads and dispatch audit records avoid raw prompts, provider payloads, output URLs, tokens, secrets, and high-cardinality routing keys. |
| Real-provider handoff | Conditional go only for a guarded staging-only adapter planning branch; external-call rehearsal requires explicit approval package. | `docs/REAL_PROVIDER_CURRENT_STATUS.md`, `docs/REAL_PROVIDER_BOUNDARY_CLOSEOUT.md`, `docs/REAL_PROVIDER_READINESS_CLOSEOUT_GATE.md`, `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md` | Aligned. Production paid-provider enablement remains no-go. |

## Safety Invariants

The closeout is considered consistent only while all of these remain true:

- Real provider credentials stay out of the repository, local fixture env, CI fixture env, logs, PR bodies, screenshots, and Notion.
- Admin generation history remains read-only until retry/cancel/refund/manual settlement requirements and permissions are implemented separately.
- Provider output URLs remain hidden behind media-governed download paths.
- Raw prompts, raw provider request payloads, raw provider responses, raw provider errors, tokens, secrets, output URLs, and billing payloads do not appear in generation DTOs, Admin history, audit metadata, provider replay summaries, notifications, metrics labels, or Notion records.
- Product creative credit refunds remain separate from provider spend, provider billing, payment-provider refunds, checkout, invoices, subscriptions, and external reconciliation.
- Callback, polling, and manual replay work stays fixture-only until `docs/REAL_PROVIDER_CALLBACK_POLLING_PREREQUISITES.md` is satisfied and an explicit later task approves enablement.

## Validation Commands

Targeted provider-readiness review should include:

```bash
node --test server/src/repositories/creativeGenerations.test.js server/src/repositories/creativeQuota.test.js server/src/repositories/creativeCredits.test.js server/src/modules/admin/routes.test.js server/src/modules/creative/routes.test.js server/src/creative/providerReplayIntegration.test.js server/src/creative/providerSideEffectPlan.test.js server/src/creative/providerPollingWorker.test.js server/src/creative/replicateStagingProvider.test.js server/src/creative/providerAdapterContract.test.js server/src/creative/generationService.test.js
npm run smoke:creative-staging
git diff --check
npm run check:quick
npm run check:deploy
```

No validation command may require real provider credentials or make a paid provider call.

## Next Recommendation

The next implementation phase should be separate from Phase 3 and provider-readiness. A suitable name is `Real Provider Staging Adapter: Replicate Image`.

Before any implementation starts:

1. Create a Notion task in Chinese.
2. Re-read `docs/REAL_PROVIDER_CURRENT_STATUS.md`.
3. Re-read `docs/REAL_PROVIDER_READINESS_CLOSEOUT_GATE.md`.
4. Keep the first branch fixture-only and injected-client-first unless the user explicitly approves the external-call rehearsal package.
5. Keep production paid-provider enablement out of scope.
