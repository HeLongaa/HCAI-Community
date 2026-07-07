# Real Provider Boundary Closeout

This closeout is the current handoff point for real-provider work after the fixture-safe polling worker wiring. It summarizes what is available, what is still disabled, and what must happen before any real paid provider call is attempted.

Current decision: **no-go for real provider external calls, provider callbacks, default provider status polling, manual replay endpoints, Admin generation mutations, and production paid-provider enablement**.

This document does not approve an external call by itself. A real external-call rehearsal still requires the approval record in `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md`, current Notion task evidence in Chinese, and explicit user approval for the exact staging run.

## Completed Safe Foundation

The repository has enough fixture-safe lifecycle foundation to continue planning and testing without contacting a paid provider:

- Durable creative generation records.
- Cross-instance creative quota ledger.
- Creative credit reservation, settlement, and refund ledger.
- Read-only Admin generation history.
- Provider adapter contract and safe failure mapping tests.
- Staging-only Replicate provider shell metadata with `networkCallsEnabled=false`.
- Cost metadata and budget alarm planning.
- Durable replay ledger schema and repository foundation.
- Pure provider lifecycle reducer for queued, running, completed, failed, cancelled, duplicate, stale, and mismatch decisions.
- Provider callback auth/parser pure functions.
- Provider polling lease and stop-condition pure functions.
- Lifecycle side-effect plan/executor pure functions.
- Fixture replay-ledger integration helpers.
- Mocked injected provider-status client contract.
- Source-keyed provider lifecycle notification/audit repository wiring.
- Manual replay authorization/parser pure functions.
- Fixture-safe polling worker interval skeleton.
- Fixture-only provider budget event plan for safe threshold-crossed, dispatch-blocked, and cost-anomaly audit/alert summaries.

The polling worker skeleton is disabled by default. It requires `CREATIVE_PROVIDER_POLLING_WORKER_ENABLED=true`, `CREATIVE_PROVIDER_POLLING_ENABLED=true`, and an injected mocked status client in tests. There is no default provider-status HTTP client.

## Current Usable Paths

| Path | Status | Notes |
| --- | --- | --- |
| Image Studio generation | Usable through mock provider | Durable generation, quota, credit, media, and Admin history paths are exercised. |
| `GET /api/creative/providers` | Usable safe metadata | `replicate_staging` remains unavailable/default-disabled with `networkCallsEnabled=false`. |
| `POST /api/creative/generations` | Usable mock route | Does not dispatch to Replicate or any paid provider. |
| Admin generation history | Usable read-only | No retry, cancel, refund, force-review, or manual settlement controls. |
| Creative staging smoke | Usable metadata-only | Validates env gates and safe provider metadata only. |
| Provider lifecycle replay tests | Usable fixtures | Uses mocked data and injected clients only. |

## Still Disabled Or Unimplemented

The following remain intentionally unavailable:

- Real provider SDK or package integration.
- Default provider HTTP client.
- Real provider network calls.
- Provider callback route.
- Provider webhook target handling.
- Manual replay endpoint or Admin replay control.
- Enabled real status polling against a provider API.
- Provider output download from external URLs.
- Production paid-provider mode.
- Admin retry, cancel, refund, force-review, or manual settlement mutations.
- Payment-provider billing reconciliation.
- Video, music, chat, batch, or public beta provider traffic.

## Approval Boundary

Ordinary continuation language is not approval for a paid provider call. The following phrases are insufficient:

- "continue"
- "looks good"
- "ship it"
- "next"
- "go on"

Before the first staging external-call rehearsal, the approval record must explicitly say:

- Decision is `Go for one staging external-call rehearsal`.
- Provider is Replicate image generation or another named image provider.
- Environment is a dedicated staging environment.
- Maximum provider call count is recorded.
- Provider-side spending cap is recorded.
- App-side budget cap is recorded.
- Token rotation owner and deadline are recorded.
- Kill-switch and rollback owners are recorded.
- Approval expires after the run or within 24 hours.
- Production paid-provider enablement remains no.

## Source Of Truth Map

| Question | Source |
| --- | --- |
| Can the first external-call staging rehearsal run? | `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md` |
| Can callbacks, polling, or manual replay be enabled? | `docs/REAL_PROVIDER_CALLBACK_POLLING_PREREQUISITES.md` |
| How is metadata-only staging smoke run? | `docs/REAL_PROVIDER_STAGING_SMOKE_RUNBOOK.md` |
| Can a staging adapter planning branch start? | `docs/REAL_PROVIDER_READINESS_CLOSEOUT_GATE.md` |
| Are Admin mutations allowed? | `docs/REAL_PROVIDER_ADMIN_MUTATION_REQUIREMENTS.md` |
| How are provider spend and product credits separated? | `docs/REAL_PROVIDER_COST_METADATA_AND_BUDGET_ALARMS.md` |
| How should provider budget events connect to audit, notifications, and metrics? | `docs/REAL_PROVIDER_BUDGET_EVENT_WIRING_PLAN.md` |

## Next Allowed Work

Allowed without real-provider approval:

1. Documentation closeout and consistency updates.
2. Fixture-only tests for lifecycle reducers, replay ledgers, side-effect plans, and mocked provider-status clients.
3. Metadata-only staging smoke improvements.
4. Read-only Admin history refinements.
5. Budget/cost guard implementation that does not dispatch externally.
6. Fixture-only provider budget event planning that does not persist or send alerts externally.

Requires explicit external-call approval:

1. Any real provider SDK or HTTP client that can make a paid network call.
2. Any route or worker that can dispatch to a provider API.
3. Any staging run that creates a provider job.
4. Any callback/polling/manual replay path that can apply lifecycle side effects from provider data.

Requires a separate production phase:

1. Production paid-provider enablement.
2. Public beta provider traffic.
3. Multiple provider families or non-image provider workflows.
4. Admin mutation controls for retry, cancel, refund, force-review, or settlement.

## Validation For This Closeout

Documentation-only changes should pass:

```bash
git diff --check
npm run check:quick
```

If the closeout touches quality gates, README runtime behavior, smoke scripts, server routes, or package scripts, also run:

```bash
npm run check:deploy
```

No validation command should require real provider credentials.
