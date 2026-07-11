# Real Provider Readiness Closeout Gate

This document closes the real-provider preflight package and defines the gate that must pass before any guarded staging-only real image provider adapter PR can begin.

Current go/no-go conclusion: **conditional go for a staging-only adapter planning branch, no-go for production enablement**.

The repository remains mock-provider only for outbound generation. V1-06 implements an app-side staging callback route and V1-07 implements a dedicated read-only status client/polling worker, each behind default-off kill switches. This closeout gate still does not approve a real provider adapter, external API call, Provider webhook target/delivery, enabled real polling, Admin mutation endpoint, payment refund flow, provider billing reconciliation, or production paid-provider path.

The callback/polling prerequisite closeout, `docs/V1_PROVIDER_CALLBACK_API.md`, and `docs/V1_PROVIDER_POLLING_AND_RECOVERY.md` cover app-side safety only. They do not approve real Provider webhook registration/delivery, real provider polling, manual replay endpoints, or Admin lifecycle mutations.

## Current Gate Interpretation

After the PR #82 through PR #89 closeout sequence, this gate should be read narrowly:

- **Allowed:** staging adapter planning, documentation consistency work, metadata-only smoke readiness work, and fixture-only Replicate image adapter hardening with mocked or injected clients.
- **Still blocked:** additional real provider SDK installation, product-route network client registration, real provider job creation, provider output download, outbound external alert delivery, real Provider callback delivery, polling worker enablement for real status reads, manual replay endpoints, Admin generation mutation controls, and production paid-provider mode.
- **Approval required:** the first real external-call rehearsal needs the separate approval package in `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md`, a current Notion record in Chinese, explicit user approval for the exact run, a provider-side spending cap, an app-side budget cap, a maximum provider call count, approval expiry, token rotation owner, kill-switch owner, and rollback owner.

Ordinary continuation language such as "continue", "next", or "ship it" is not enough to cross from fixture-only hardening into a real external-call rehearsal.

## Completed Preflight Package

| Step | Status | Artifact |
| --- | --- | --- |
| Provider adapter contract tests | Complete, PR #25 | `server/src/creative/providerAdapterContract.js`, `server/src/creative/providerAdapterContract.test.js` |
| Staging-only provider selection and secrets strategy | Complete, PR #26 | `docs/REAL_PROVIDER_STAGING_STRATEGY.md` |
| Admin generation mutation requirements | Complete, PR #27 | `docs/REAL_PROVIDER_ADMIN_MUTATION_REQUIREMENTS.md` |
| Provider cost metadata and budget alarms | Complete, PR #28 | `docs/REAL_PROVIDER_COST_METADATA_AND_BUDGET_ALARMS.md` |
| Staging smoke runbook and adapter closeout gate | Complete after this package merges | `docs/REAL_PROVIDER_STAGING_SMOKE_RUNBOOK.md` |
| External-call go/no-go approval package | Complete after this package merges | `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md` |
| Callback/polling prerequisite plan | Complete after this package merges | `docs/REAL_PROVIDER_CALLBACK_POLLING_PREREQUISITES.md` |
| Final closeout gate | Complete after this package merges | `docs/REAL_PROVIDER_READINESS_CLOSEOUT_GATE.md` |

## Completed Post-Closeout Hardening

| Area | Status | Boundary |
| --- | --- | --- |
| Quota ledger closeout, PR #82 | Complete | Idempotent commit/release behavior and redacted quota release audit metadata. |
| Credit ledger closeout, PR #83 | Complete | Idempotent settle/refund behavior and allowlisted/redacted credit metadata. |
| Admin generation history closeout, PR #84 | Complete | Read-side allowlist/redaction coverage for unsafe historical generation evidence. |
| Provider readiness consistency review, PR #85 | Complete | Evidence index across durable accounting, Admin history, replay, staging shell, and budget operations. |
| Replicate staging failure closeout, PR #86 | Complete | Fixture-only failure mapping and safe provider evidence. |
| Replicate staging cancellation closeout, PR #87 | Complete | Fixture-only cancellation boundary evidence. |
| Replicate staging observability closeout, PR #88 | Complete | Safe read-only observability evidence for the staging shell. |
| Provider budget read-side closeout, PR #89 | Complete | Sanitized budget event, audit, notification, external-alert dry-run, and dispatch audit evidence. |

## Gate Decision

### Staging Adapter

Conditional go for fixture-only and planning work.

A future first real image provider adapter implementation branch may start only if it is:

- image-only
- staging-only
- guarded behind explicit environment flags
- default-disabled in production
- covered by provider adapter contract tests
- covered by cost metadata/budget guard tests
- covered by the durable replay ledger and lifecycle reducer foundation, with callback/polling route and worker tests before async execution is enabled
- documented in Notion before implementation starts
- free of real network calls until the external-call approval package is completed

### Production Enablement

No-go.

Production paid-provider calls remain blocked until a later phase proves:

- staging adapter success with budget caps
- provider cost metadata in Admin history
- budget threshold and anomaly alerts
- rollback and kill-switch rehearsal
- documented provider incident runbook
- explicit user approval to enable production paid-provider path

## Required Local Validation

Every future staging adapter PR must pass the repository gate:

```bash
git diff --check
npm run check:quick
npm run check:deploy
```

Adapter-specific local tests must also include:

```bash
npm --prefix server test -- src/creative/providerAdapterContract.test.js
```

When provider-specific code exists, add targeted tests for:

- safe provider failure mapping and redaction
- queued/running/completed/failed/review-required lifecycle mapping
- provider request/job id safe storage
- duplicate callback or polling replay idempotency
- quota reservation/commit/release behavior
- creative credit reservation/settlement/refund behavior
- media asset persistence and scan governance
- provider cost estimate/actual/confidence mapping
- budget cap fail-closed dispatch behavior

## Required CI Validation

Before merge:

- GitHub `PR Quality Gate` must pass.
- The fixture deployment gate must keep the creative provider in `mock` or `disabled`.
- The production smoke summary must not include real provider tokens.
- `Deployment Environment Smoke` may remain skipped on ordinary PRs unless manually dispatched for a selected environment.

Before any staging external-call test:

- Run the real environment smoke against a dedicated staging GitHub Environment.
- Run the creative staging smoke in `docs/REAL_PROVIDER_STAGING_SMOKE_RUNBOOK.md` with `smoke_profile=creative-staging`.
- Confirm the smoke output prints only safe booleans, counts, provider modes, and provider ids.
- Attach or summarize the smoke result in Notion.
- Complete the approval record in `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md`.
- Record the maximum provider call count and approval expiry in Notion.

## Staging-Only Environment Checklist

Dedicated staging environment:

- `NODE_ENV=production` may be used for runtime parity.
- `CREATIVE_PROVIDER_RUNTIME_ENV=staging`.
- `CREATIVE_PROVIDER_MODE=disabled` for preflight-only checks.
- The adapter phase may introduce a separate explicit real-provider mode, but it must be staging-only and production-denied until a later approval gate.
- `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=true` only in staging preflight.
- `CREATIVE_STAGING_IMAGE_PROVIDER=replicate`.
- `CREATIVE_STAGING_PROVIDER_API_TOKEN` stored only as a GitHub Secret or deployment secret.
- `CREATIVE_STAGING_PROVIDER_CONFIRMATION=staging-only`.
- Provider-side account has a low spending limit.
- App-side budget cap is configured before provider dispatch.
- Cost metadata pricing snapshot source is configured before provider dispatch.
- Alert delivery channel for creative/provider budget alerts is selected before spend.

Forbidden:

- Real provider token in local `.env`.
- Real provider token in CI fixture.
- Real provider token in production environment.
- Production `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=true`.
- Production provider dispatch while this gate remains the latest closeout.
- Raw provider request/response payloads in logs, Notion, or audit metadata.

## Kill Switches

Immediate kill switches:

- Set provider execution mode back to `mock` or `disabled`.
- Set `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=false`.
- Remove or rotate `CREATIVE_STAGING_PROVIDER_API_TOKEN`.
- Set app-side provider budget cap to `0`.
- Disable provider dispatch at the adapter registry layer.
- Disable provider callback/polling workers if introduced later.

Provider-side kill switches:

- Revoke staging provider token.
- Lower provider account spending limit to `0`.
- Disable provider webhook target.
- Disable provider model access if provider console supports it.

Operational kill-switch verification:

1. Run the smoke profile after environment changes.
2. Confirm `GET /api/creative/providers` reports no real provider as enabled.
3. Confirm `POST /api/creative/generations` cannot dispatch to a paid provider.
4. Confirm no provider token appears in logs, smoke output, audit events, or Notion.

## Rollback Checklist

If a staging adapter causes unsafe behavior:

1. Activate the kill switches above.
2. Stop provider callback/polling workers if they exist.
3. Preserve generation, quota, credit, media, and audit records.
4. Do not delete provider job ids or output asset ids.
5. Mark affected generations failed, cancelled, or review-required through normal lifecycle rules only.
6. Release quota only when provider work did not consume billable capacity.
7. Refund product creative credits only through idempotent creative credit ledger rules.
8. Keep provider spend metadata separate from product credit refunds.
9. Record `creative.provider_budget.dispatch_blocked` or the relevant future audit event.
10. Update Notion with incident notes and next-action status.

## Documentation Sync Checklist

Before starting a staging adapter PR:

- Notion task for the adapter phase exists in Chinese.
- `docs/REAL_PROVIDER_PREFLIGHT_PLAN.md` points to the closeout gate.
- `docs/REAL_PROVIDER_STAGING_ADAPTER_SHELL_PLAN.md` has been reviewed for fixture-only shell scope before any SDK or network-capable client is proposed.
- `docs/REAL_PROVIDER_STAGING_SMOKE_RUNBOOK.md` has been reviewed for the adapter scope.
- `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md` has been reviewed before any external-call rehearsal.
- `docs/REAL_PROVIDER_CALLBACK_POLLING_PREREQUISITES.md` has been reviewed before any callback, polling worker, or manual lifecycle replay work.
- `README.md` lists every real-provider preflight artifact.
- `docs/GITHUB_ENVIRONMENT.md` documents any new provider env/secrets.
- `docs/QUALITY_GATES.md` documents any new validation command.
- `docs/PERMISSION_MATRIX.md` remains accurate if permissions change.
- `docs/API_DESIGN.md` and OpenAPI docs are updated only when routes are added.
- Admin UI docs explicitly state whether controls are read-only or mutating.

## Go/No-Go Checklist

Go for a staging-only adapter when all are true:

- Provider adapter contract tests exist and pass.
- Staging-only provider and secret strategy is documented.
- Dedicated staging provider token exists outside the repository.
- Production smoke rejects staging preflight and provider tokens.
- Admin mutation requirements are documented and mutation controls remain disabled.
- Provider cost metadata and budget alarm schema is documented.
- Budget cap and kill-switch plan are documented.
- External-call approval record is complete when a real provider call is proposed.
- Notion task list is current.
- User explicitly approves starting the staging adapter implementation.

No-go if any are true:

- Real provider token would be committed or stored locally.
- Production environment would contain staging provider token or preflight flag.
- Provider dispatch could run without cost estimate and budget scope.
- Provider output could bypass media scan governance.
- Retry/cancel/refund/manual settlement controls are required before their permissions and tests exist.
- Provider callback/polling replay idempotency is untested.
- CI fixture requires real provider credentials.
- User has not explicitly approved moving from preflight to adapter implementation.
- The external-call rehearsal scope or call count is not explicitly approved.

## Next Recommended Phase

The next phase should be named separately from Phase 3 and provider-readiness, for example:

`Real Provider Staging Adapter: Replicate Image`

Recommended first implementation scope:

1. Continue the staging-only provider adapter shell under `docs/REAL_PROVIDER_STAGING_ADAPTER_SHELL_PLAN.md`.
2. Keep production denied by env validation.
3. Harden request construction and safe failure mapping with mocked provider client tests first.
4. Add or preserve cost metadata mapping and budget fail-closed checks before any external dispatch.
5. Satisfy `docs/REAL_PROVIDER_CALLBACK_POLLING_PREREQUISITES.md` and add callback/polling idempotency tests before enabling async provider lifecycle.
6. Run metadata-only staging smoke before any explicit external-call approval.

Do not broaden to video, music, chat, production, or Admin mutation controls during the first staging adapter phase.
