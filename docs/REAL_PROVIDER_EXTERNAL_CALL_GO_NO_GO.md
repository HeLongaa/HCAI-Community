# Real Provider External Call Go/No-Go Package

This package defines the approval evidence required before the first real provider external-call staging rehearsal. It does not approve an external call by itself.

Current decision: **no-go until the approval record is completed in Notion and the user explicitly approves the first external-call staging run**.

The current real-provider boundary handoff is summarized in `docs/REAL_PROVIDER_BOUNDARY_CLOSEOUT.md`. If that document and this approval package disagree, treat the safer no-go interpretation as authoritative until both documents and the Notion task are updated.

This document does not add a real provider SDK, provider HTTP client, webhook endpoint, polling worker, provider job creation, production paid-provider path, or Admin generation mutation control.

## Current Evidence Position

PRs #82 through #89 completed the fixture-only and read-side hardening needed to prepare a final staging decision record. That evidence improves the safety case, but it does not approve a real external call.

Use the current evidence as follows:

- PR #82 proves quota commit/release idempotency and redacted quota release audit metadata.
- PR #83 proves creative credit settle/refund idempotency and allowlisted/redacted credit metadata.
- PR #84 proves Admin generation history remains read-side allowlisted/redacted over unsafe historical records.
- PR #85 indexes provider-readiness consistency evidence across durable accounting, Admin history, replay, staging shell, and budget operations.
- PRs #86, #87, and #88 prove fixture-only Replicate staging failure, cancellation, and observability boundaries.
- PR #89 proves provider budget read-side evidence stays sanitized across event planning, audit persistence, internal notifications, external-alert dry-run payloads, and dispatch audit rows.

Even with this evidence, the decision remains no-go unless the approval record names the exact provider, staging environment, maximum provider call count, provider-side spending cap, app-side budget cap, approval expiry, token rotation owner, kill-switch owner, rollback owner, and production no-go boundary.

Ordinary continuation language such as "continue", "next", "looks good", or "ship it" must be treated as no-go for real provider calls.

## Scope

The first external-call rehearsal may be considered only for:

- Replicate image generation candidate.
- Dedicated staging environment only.
- One controlled internal test request.
- Low provider-side spending cap.
- App-side budget fail-closed guard.
- Safe provider request/response redaction.
- Read-only Admin generation history.

Still out of scope:

- Production paid-provider enablement.
- Video, music, chat, or batch generation providers.
- Public beta traffic.
- Provider webhooks or polling workers.
- Admin retry, cancel, refund, force-review, or manual settlement controls.
- Payment-provider refunds, invoices, subscriptions, or provider billing reconciliation.

## Approval Record

Create or update a Notion task in Chinese before any external-call staging run. The record must include:

| Field | Required content |
| --- | --- |
| Approval decision | `No-go`, `Conditional go`, or `Go for one staging external-call rehearsal` |
| Approver | User or owner who explicitly approved the run |
| Approved scope | Provider, workspace, mode, model family, expected output count |
| Environment | Dedicated GitHub Environment name |
| Branch or PR | Branch/PR that contains the adapter code |
| Spending cap evidence | Provider-side cap and app-side budget cap |
| Smoke evidence | GitHub creative-staging smoke run URL and safe summary |
| Token plan | Token creation date, rotation owner, post-run rotation requirement |
| Kill switch owner | Person responsible for immediate provider/app rollback |
| Rollback owner | Person responsible for record/accounting/media follow-up |
| No real production enablement statement | Explicit yes/no statement |
| External call count | Maximum number of provider calls permitted in the rehearsal |
| Expiry | Approval expires after the run or within 24 hours, whichever comes first |

Approval text must be explicit. Phrases like "continue", "looks good", or "ship it" are not enough to approve a real paid provider call.

The same rule applies to CLI, chat, PR, and Notion notes. If the approval text does not name the provider, staging environment, maximum provider call count, spending cap, expiry, and production no-go boundary, the decision remains no-go.

## Required Evidence Before Approval

### Environment And Secret Evidence

- Dedicated staging GitHub Environment exists.
- `CREATIVE_PROVIDER_RUNTIME_ENV=staging`.
- `CREATIVE_PROVIDER_MODE=disabled` for preflight smoke.
- `CREATIVE_PROVIDER_MODE=replicate_staging` only for adapter-shell metadata smoke.
- `CREATIVE_STAGING_IMAGE_PROVIDER=replicate`.
- `CREATIVE_STAGING_PROVIDER_CONFIRMATION=staging-only`.
- `CREATIVE_STAGING_PROVIDER_API_TOKEN` is stored only as a GitHub Environment secret or deployment secret.
- Production does not contain `CREATIVE_STAGING_PROVIDER_API_TOKEN`.
- Local `.env` files do not contain the provider token.

### Smoke Evidence

Required GitHub workflow runs:

- `smoke_profile=creative-staging`, `CREATIVE_STAGING_SMOKE_MODE=preflight`.
- `smoke_profile=creative-staging`, `CREATIVE_STAGING_SMOKE_MODE=adapter-shell`.

Required local commands:

```bash
git diff --check
npm run smoke:creative-staging
npm run check:quick
npm run check:deploy
```

Required result notes:

- Smoke output prints only booleans, provider modes, provider ids, and counts.
- `networkCallsEnabled=false` in metadata-only smoke.
- `adapterImplemented=false` until the adapter PR intentionally changes that value.
- No token value appears in smoke output, logs, PR body, screenshots, or Notion.

### Spending Evidence

Provider-side:

- Dedicated staging token or account.
- Provider-side spending cap set to a low fixed amount.
- Provider-side spending cap screenshot or console note stored outside the repository.
- Provider-side kill switch known: token revoke, cap to `0`, webhook disabled, model access disabled when supported.

App-side:

- Budget scope is low-cardinality, for example `staging:replicate:image`.
- Daily cap is configured before dispatch.
- Estimate and cap metadata are required before dispatch.
- Missing estimate, missing cap, currency mismatch, or projected cap exceedance blocks dispatch.
- Budget cap can be set to `0` as an immediate kill switch.

### Adapter Code Evidence

Before a PR can make a real external call, it must prove:

- The default route remains mock-only unless the staging adapter mode is explicitly selected.
- Production env validation rejects `replicate_staging`.
- Provider request payloads exclude secrets and raw internal-only data.
- Provider response mapping stores safe provider job ids and redacted failure previews only.
- Provider adapter contract tests pass.
- Cost metadata and budget guard tests pass.
- Route-level policy, quota, credit, generation record, and media persistence tests pass with a mocked client.
- There is no CI requirement for real provider credentials.

## Go Checklist

Go for one external-call staging rehearsal only when all are true:

- Notion approval record is complete in Chinese.
- User explicitly approves the first external-call staging run.
- The approved scope is image-only and staging-only.
- GitHub creative-staging preflight smoke passed.
- GitHub creative-staging adapter-shell smoke passed.
- Local fixture smoke passed.
- Provider-side spending cap exists and is recorded.
- App-side budget guard blocks missing or over-budget dispatch.
- Token rotation owner and timing are recorded.
- Kill switch owner and rollback owner are recorded.
- Provider webhook targets remain disabled unless webhook idempotency work has been separately approved.
- Admin generation mutation controls remain disabled.
- Production smoke still rejects staging preflight and provider tokens.

## No-Go Checklist

No-go if any are true:

- Approval is implied rather than explicit.
- Notion record is missing or stale.
- Provider token is present in local `.env`, repository files, CI fixture profile, PR body, screenshots, logs, or Notion.
- Production environment contains the staging token or staging preflight flag.
- Provider-side spending cap is missing or unverified.
- App-side budget cap, currency, or estimate metadata is missing.
- Provider output can bypass media scan governance.
- Provider request/response redaction tests are missing.
- Callback or polling replay idempotency is needed for the run but untested.
- Admin retry/cancel/refund/manual settlement is required to recover from the run.
- CI requires real provider credentials.
- The external-call rehearsal would involve more than one provider call without a separate approval.

## First External-Call Rehearsal Template

Use this template in Notion and in the PR closeout section:

```text
Decision: No-go / Conditional go / Go for one staging external-call rehearsal
Approver:
Approval timestamp:
Approval expiry:
Provider: Replicate
Workspace/mode: image / text_to_image
Environment:
Branch or PR:
Maximum provider calls:
Provider-side spending cap:
App-side budget scope:
App-side daily cap:
Creative-staging preflight smoke URL:
Creative-staging adapter-shell smoke URL:
Production smoke result:
Token rotation owner:
Token rotation deadline:
Kill switch owner:
Rollback owner:
Admin mutation controls disabled: yes/no
Webhook/polling disabled: yes/no
Production paid-provider enablement: no
Notes:
```

## Callback And Polling Prerequisite Plan

The full callback/polling prerequisite checklist lives in `docs/REAL_PROVIDER_CALLBACK_POLLING_PREREQUISITES.md`.

Before enabling provider webhooks or polling workers:

1. Add callback or polling replay tests for queued, running, succeeded, failed, cancelled, duplicate terminal, duplicate non-terminal, stale event, and provider job id mismatch cases.
2. Prove replay idempotency suppresses duplicate output persistence, duplicate credit settlement, duplicate refunds, and duplicate media records.
3. Define a provider callback signing or polling authentication boundary.
4. Add a worker kill switch separate from provider dispatch.
5. Add audit events for callback accepted, callback rejected, replay no-op, provider mismatch, and lifecycle side-effect applied.
6. Keep Admin mutation controls read-only until separate permissions and idempotent mutation endpoints exist.

The first external-call rehearsal should prefer synchronous or manually inspected provider result handling unless the callback/polling prerequisite plan is completed and approved.

## Rollback And Kill Switch Evidence

Before the run, confirm the operator can:

- Set `CREATIVE_PROVIDER_MODE=disabled`.
- Set `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=false`.
- Remove or rotate `CREATIVE_STAGING_PROVIDER_API_TOKEN`.
- Set app-side budget cap to `0`.
- Revoke the provider staging token.
- Lower provider-side spending cap to `0`.
- Disable provider webhook targets.
- Preserve generation, quota, credit, media, and audit records.

After a failed or unsafe run:

- Do not delete provider job ids or media asset ids.
- Do not refund product creative credits unless the idempotent credit ledger path applies.
- Do not release quota if provider work consumed billable capacity.
- Keep provider spend metadata separate from product credits.
- Record incident notes and next action in Notion.

## Production Enablement

Production paid-provider enablement remains no-go after this package.

Production can be considered only after:

- Multiple staging rehearsals pass within cap.
- Provider cost metadata is visible in read-only Admin history.
- Budget alerts and anomaly alerts are implemented and tested.
- Callback/polling replay idempotency is proven if async lifecycle is enabled.
- Kill switch and rollback are rehearsed.
- Admin mutation requirements are implemented or consciously deferred with safe recovery paths.
- User explicitly approves a separate production paid-provider phase.
