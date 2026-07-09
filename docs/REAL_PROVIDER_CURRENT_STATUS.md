# Real Provider Current Status

This is the first decision page to read before starting any real-provider work. It compresses the current provider readiness state into one handoff: what is usable now, what is fixture-only, what remains deferred, and what requires explicit approval.

Current decision: **the repository is provider-ready, not real-provider-connected**. Mock-provider generation, durable accounting, read-only Admin history, provider budget observability, and fixture-safe lifecycle foundations are available. Real paid-provider calls, external provider alert delivery, callback routes, real polling, manual replay endpoints, Admin generation mutations, and production paid-provider enablement remain no-go.

Ordinary continuation language such as "continue", "next", "looks good", or "ship it" is not approval for real provider calls or outbound provider alerts.

## Final Go/No-Go Position

As of PR #89, the post-readiness fixture and read-side closeout package is complete enough to prepare a final staging decision record. The decision remains:

- **Conditional go** for documentation updates, metadata-only smoke evidence, and fixture-only Replicate image staging adapter hardening with mocked or injected clients.
- **No-go** for the first real provider external-call rehearsal until the approval record in `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md` is complete in Notion and the user explicitly approves the exact staging run.
- **No-go** for production paid-provider enablement.

Completed evidence through PR #89:

| Area | Evidence |
| --- | --- |
| Quota ledger closeout | PR #82 added idempotent quota commit/release coverage and redacted quota release reasons. |
| Credit ledger closeout | PR #83 added idempotent settle/refund coverage and allowlisted/redacted credit metadata. |
| Admin generation history closeout | PR #84 added read-side allowlist/redaction coverage over unsafe historical records. |
| Provider readiness review | PR #85 added a consistency review across durable records, quota, credit, Admin history, replay, staging shell, and budget operations. |
| Replicate staging failure/cancellation/observability | PRs #86, #87, and #88 hardened fixture-only failure mapping, cancellation boundaries, and observability evidence. |
| Provider budget read-side chain | PR #89 added end-to-end sanitized evidence coverage from budget event planning through audit persistence, notifications, external-alert dry-run payloads, and dispatch audit rows. |

## At A Glance

| Category | Current Status | Practical Meaning |
| --- | --- | --- |
| Product generation path | Usable with mock provider | Image Studio can create stored generated assets through the creative API and durable accounting path. |
| Provider catalog | Safe metadata only | `replicate_staging` can appear as unavailable/default-disabled metadata with `networkCallsEnabled=false`. |
| Durable accounting | Usable | Generation records, quota windows/reservations, credit reservation/settlement/refund, and media governance are wired. |
| Admin generation history | Usable read-only | Operators can inspect sanitized generation, cost, budget, quota, credit, safety, policy, media, audit, and replay evidence. |
| Provider lifecycle foundation | Fixture-only | Replay ledger, lifecycle reducer, side-effect plan, callback parser helpers, polling plan, and worker skeleton exist without real provider side effects. |
| Provider budget operations | Usable read-only / fixture-only | Audit persistence, internal notifications, Admin operations metrics, exporter metrics, and fixture dry-run dispatch audit rows exist. |
| Staging adapter shell | Fixture-only | Mocked/injected-client hardening may continue; no default SDK or network client is available. PRs #86-#89 improved the fixture-only evidence chain, but did not approve real provider calls. |
| First real external-call rehearsal | No-go until explicit approval | Requires the go/no-go approval package, Notion evidence in Chinese, call count, budget cap, expiry, token/rollback owners, and production no-go. |
| Production paid-provider enablement | No-go | Requires a later production phase after staging proves safety, spend caps, rollback, and operations runbooks. |

## Usable Now

These paths are available without real-provider approval:

- `GET /api/creative/providers` returns safe provider capability metadata.
- `POST /api/creative/generations` runs the deterministic mock provider only.
- Image Studio uses the creative API path for stored image outputs.
- Durable generation history records prompt hash/preview, provider ids, usage, quota, credit, safety, policy, lifecycle timestamps, and linked output media assets.
- Durable quota and credit ledgers reserve, commit, release, settle, refund, and dedupe accounting decisions.
- Media scan governance gates generated asset downloads.
- Admin generation history provides read-only filters and details.
- Admin generation history exposes sanitized provider cost/budget summaries and safe provider replay evidence.
- Admin operations metrics and Prometheus-compatible exporter expose low-cardinality provider budget and cost observability.
- Internal provider budget notifications route to audit readers from persisted safe audit rows.

## Fixture-Only Foundations

These pieces are implemented for tests, planning, and safe dry-runs only:

- provider adapter contract tests
- Replicate staging shell metadata and fixture adapter tests
- provider budget event planning and fail-closed budget guard tests
- provider callback signature/parser helpers
- provider polling lease and stop-condition helpers
- provider lifecycle replay reducer
- provider side-effect plan/executor helpers
- provider replay ledger integration tests
- mocked/injected provider-status client contract
- source-keyed lifecycle notification/audit repository wiring
- disabled-by-default polling worker skeleton
- provider budget external alert payload builder
- injected-only provider alert dispatcher boundary
- disabled webhook, Slack, and email provider alert client shells
- fixture-only provider alert dry-run harness

Fixture-only means no route, worker, or default client should contact a real provider or external alert channel.

## Still Deferred

These are intentionally unavailable:

- real provider SDK or package integration
- default provider HTTP client
- real provider network calls
- provider callback route
- webhook target handling for provider lifecycle
- enabled real provider status polling
- manual replay endpoint
- Admin retry, cancel, refund, force-review, replay, recovery, or settlement mutations
- real external Slack, webhook, or email delivery for provider budget alerts
- provider billing reconciliation, invoice matching, checkout, subscription, or payment-provider refund flow
- production paid-provider mode
- video, music, chat, batch, or public beta provider traffic

## Explicit Approval Required

Before the first real provider external-call staging rehearsal, all of the following must be true:

1. `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md` has a completed approval record.
2. The matching Notion task is current and written in Chinese.
3. The user explicitly approves the exact staging run.
4. The approval names the provider and staging environment.
5. Maximum provider call count is recorded.
6. Provider-side spending cap is recorded.
7. App-side budget cap is recorded.
8. Approval expiry is recorded.
9. Token rotation owner and deadline are recorded.
10. Kill-switch and rollback owners are recorded.
11. Production paid-provider enablement remains no.

Without those details, the decision remains no-go.

## Required Reading By Question

| Question | Start Here |
| --- | --- |
| What is the current overall status? | `docs/REAL_PROVIDER_CURRENT_STATUS.md` |
| What is the real-provider handoff boundary? | `docs/REAL_PROVIDER_BOUNDARY_CLOSEOUT.md` |
| Can a staging adapter planning branch start? | `docs/REAL_PROVIDER_READINESS_CLOSEOUT_GATE.md` |
| What fixture-only staging shell work is allowed? | `docs/REAL_PROVIDER_STAGING_ADAPTER_SHELL_PLAN.md` |
| What must happen before an external provider call? | `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md` |
| Is metadata-only staging smoke ready to run? | `docs/REAL_PROVIDER_STAGING_SMOKE_READINESS.md` |
| What smoke checks apply to staging provider metadata? | `docs/REAL_PROVIDER_STAGING_SMOKE_RUNBOOK.md` |
| Can callbacks, polling, or manual replay be enabled? | `docs/REAL_PROVIDER_CALLBACK_POLLING_PREREQUISITES.md` |
| Are Admin mutations allowed? | `docs/REAL_PROVIDER_ADMIN_MUTATION_REQUIREMENTS.md` |
| How are provider spend and product credits separated? | `docs/REAL_PROVIDER_COST_METADATA_AND_BUDGET_ALARMS.md` |
| What provider budget read-side surfaces exist? | `docs/REAL_PROVIDER_BUDGET_OPERATIONS_READSIDE_CLOSEOUT.md` |

## Next Recommended Work

Allowed next:

1. Documentation consistency updates.
2. Metadata-only staging smoke improvements and readiness evidence updates.
3. Fixture-only staging adapter shell hardening with mocked/injected clients.
4. Fixture-only tests for request construction, safe failure mapping, cost metadata, budget guards, lifecycle replay, and read-only Admin evidence.

Not allowed without explicit approval:

1. Real provider SDKs or HTTP clients.
2. Real provider network calls.
3. Real outbound provider budget alerts.
4. Callback route, real polling, or manual replay endpoint.
5. Admin mutation controls.
6. Production paid-provider enablement.

## Validation Gate

Documentation-only current-status updates should pass:

```bash
git diff --check
npm run check:quick
```

If an update touches smoke scripts, runtime behavior, routes, package scripts, quality gates, README runtime text, or provider configuration, also run:

```bash
npm run check:deploy
```

No validation command should require real provider credentials, real provider jobs, or real outbound provider alert channels.
