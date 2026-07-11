# Real Provider Current Status

This is the first decision page to read before starting any real-provider work. It compresses the current provider readiness state into one handoff: what is usable now, what is fixture-only, what remains deferred, and what requires explicit approval.

Current decision: **the repository is provider-ready, not real-provider-connected**. Mock-provider generation, durable accounting, Admin generation history, internal mutation controls, Provider budget observability, the V1-11 fail-closed Provider control plane, and the V1-12 shared error/durable retry policy are available. The callback API and dedicated polling worker remain default-disabled. Real paid-provider calls, real Provider webhook delivery, external Provider alert delivery, enabled real polling, real Provider mutation clients, real cap readers/probes, and production paid-provider enablement remain no-go.

V1-04 now records conditional implementation-planning decisions for all four modalities in
`docs/V1_PROVIDER_DECISION_MATRIX.md` and `config/v1-provider-matrix.json`. These selections define primary/backup
providers, public-list-price budgets, app concurrency caps, legal/data/SLA conditions, failover rules, and replacement
triggers. They do not approve credentials, network clients, real jobs, or production traffic.

V1-15 freezes the Image model/mode/parameter contract in `server/src/creative/imageCapabilityContract.js` and
`docs/V1_IMAGE_CAPABILITY_CONTRACT.md`. Image Studio now consumes the safe Provider catalog and disables generation when
the contract is unavailable. This is still deterministic mock execution, not a real Image Provider connection.

V1-44 freezes the corresponding four-modality content safety baseline in
`docs/V1_CONTENT_SAFETY_POLICY_MATRIX.md` and `config/v1-content-safety-policy.json`. It defines 20 risk categories,
prohibited/block/review/allow decisions, the five-stage responsibility chain, all eight Provider policy mappings,
review/appeal behavior, user messages, and safety-event audit fields. Enforcement remains incomplete and real traffic
remains no-go.

V1-45 freezes the cross-product data baseline in `docs/V1_DATA_GOVERNANCE_BASELINE.md` and
`config/v1-data-governance.json`. It classifies every Prisma model plus raw inputs, Provider payloads, telemetry,
backups, exports, and secrets; bounds retention and flows; and defines export/deletion, processor, legal-hold, and
redaction contracts. Runtime rights/deletion automation and production approval remain incomplete.

Ordinary continuation language such as "continue", "next", "looks good", or "ship it" is not approval for real provider calls or outbound provider alerts.

## Final Go/No-Go Position

As of PR #89, the post-readiness fixture and read-side closeout package is complete enough to prepare a final staging decision record. The decision remains:

- **Conditional go** for documentation updates, metadata-only smoke evidence, fixture-only Replicate image staging adapter
  hardening, and default-disabled HTTP client contract tests with injected fetch implementations.
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
| V1-05 Provider HTTP boundary | A fixed-endpoint, minimum-payload Replicate client factory reads only deployment secrets, rejects unknown Providers, and remains disabled/unregistered by default. |
| V1-06 Provider callback boundary | `docs/V1_PROVIDER_CALLBACK_API.md` records the staging-only signed route, strict payload projection, nonce/job binding, atomic replay claim, safe audits, and no-real-traffic boundary. |
| V1-07 Provider polling boundary | `docs/V1_PROVIDER_POLLING_AND_RECOVERY.md` records the read-only status client, strict response projection, oldest-first worker sweep, retry audit, idempotent timeout recovery, and no-real-traffic boundary. |

## V1-04 Conditional Provider Decisions

| Modality | Conditional primary | Approval-gated backup | Main unresolved condition |
| --- | --- | --- | --- |
| Image | OpenAI GPT Image 2 | Replicate FLUX 1.1 Pro | Confirm OpenAI production geography, GPT Image 2 residency/ZDR, and contracted support posture; approve FLUX model terms separately. |
| Chat | OpenAI GPT-5.6 Terra | Anthropic Claude Sonnet 5 | Configure retention controls, approve supported-country access, and accept or contract Anthropic US storage. |
| Video | Google Veo 3.1 Fast | Runway Gen-4.5 | Confirm Veo model-specific SLA/indemnity; Runway is blocked until enterprise no-training and retention terms exist. |
| Music | ElevenLabs Music v2 Enterprise | Google Lyria 3 Pro Preview | Obtain Enterprise Music platform/reseller/media rights; explicitly accept Lyria Preview no-SLA/no-indemnity risk. |

The launch budget envelope is USD 63/day and USD 1,550/month across all four modalities. It is a fail-closed guardrail,
not a spending approval. Provider credit auto-reload is disabled, backup budgets are independent, and budget exhaustion
never causes silent backup or mock fallback.

OpenAI Sora 2 is explicitly rejected as the V1 video backup because OpenAI has announced removal of the Videos API and
Sora 2 models on 2026-09-24 without a recommended replacement.

## At A Glance

| Category | Current Status | Practical Meaning |
| --- | --- | --- |
| Product generation path | Usable with mock provider | Image Studio can create stored generated assets through the creative API and durable accounting path. |
| Provider catalog | Safe metadata only | Image capabilities include contract version, all four declared modes, per-mode availability, parameter definitions, and guarded runtime flags; `replicate_staging` remains unavailable/default-disabled. |
| Durable accounting | Usable | Generation records, quota windows/reservations, credit reservation/settlement/refund, and media governance are wired. |
| Admin generation history | Usable read-only | Operators can inspect sanitized generation, cost, budget, quota, credit, safety, policy, media, audit, and replay evidence. |
| Provider lifecycle foundation | Implemented / default-disabled | Replay ledger, lifecycle reducer, side-effect plan, callback route, polling plan, and dedicated polling worker exist without approved real Provider traffic. |
| Provider budget operations | Usable read-only / fixture-only | Audit persistence, internal notifications, Admin operations metrics, exporter metrics, and fixture dry-run dispatch audit rows exist. |
| Provider HTTP client boundary | Implemented / default-disabled | A fixed Replicate client factory and deployment-secret boundary exist. No product route registers it; V1-07 supplies only a read-only status wrapper to the separately gated worker. No external call is approved. |
| Provider callback API | Implemented / default-disabled | The staging-only route verifies exact-body HMAC, timestamp, nonce, strict payload fields, job binding, replay dedupe, and atomic side-effect ownership. No Provider webhook target is configured. |
| Provider polling worker | Implemented / default-disabled | The dedicated worker uses strict status projection, oldest-first candidates, durable due-time/attempt-budget retry state, timeout recovery, safe audits, and replay-ledger side effects. Both polling switches remain off. |
| Provider output ingestion | Implemented / default-unregistered | Source-keyed ingestion, claim leases, URL/DNS/redirect/size/MIME/SHA-256 validation, deterministic object storage, scanner gating, and safe Admin summaries exist. No product runtime registers a real output fetch client. |
| Provider control plane | Implemented / fixture dispatch only | Versioned global/provider/workspace/model controls, expiring cap evidence, explicit circuits, one-claim probes, emergency disable, two-person recovery, Admin views, and safe metrics exist. Real Provider dispatch, cap readers, and probes remain unregistered. |
| Provider error and retry policy | Implemented / real traffic disabled | Shared categories, safe envelopes, bounded `Retry-After`, deterministic backoff, CAS attempt budgets, hash-only failure dedupe, user-confirmed retry eligibility, Admin evidence, and low-cardinality metrics exist. Real clients and traffic remain unregistered. |
| Provider lifecycle observability | Usable internally / fixture-only | Catalog-driven owner/operations notifications, audit allowlists, Admin list/export/detail parity, lifecycle metrics, safe samples, and handoff hints exist. External lifecycle delivery remains disabled. |
| Staging adapter shell | Fixture-only | Mocked/injected-client hardening may continue. PRs #86-#89 improved the fixture-only evidence chain, but did not approve real provider calls. |
| V1 provider decision matrix | Conditional planning evidence | Four primary/backup pairs, budgets, legal/data/SLA conditions, and replacement triggers are machine-verified; no provider is production-approved. |
| V1 content safety matrix | Frozen implementation policy | Four modality partitions, Provider policy mappings, review/appeal, and audit contracts are machine-verified; downstream enforcement is not complete. |
| V1 data governance baseline | Frozen implementation policy | Data inventory, retention, flows, processors, export/deletion, holds, and redaction are machine-verified; runtime automation is not complete. |
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
- Admin generation history provides filters, details, dedicated cancel/retry/replay permissions, and safe mutation evidence.
- Admin generation history exposes sanitized provider cost/budget summaries and safe provider replay evidence.
- Admin operations metrics and Prometheus-compatible exporter expose low-cardinality provider budget, cost, retry, and lifecycle observability.
- Internal provider budget notifications route to audit readers from persisted safe audit rows.
- The Provider callback route can be exercised with signed fixtures behind its independent staging-only kill switch without making an outbound Provider request.
- The Provider polling worker can be exercised with injected status fixtures or injected `fetch` behind independent staging-only kill switches without making an external Provider request.
- User and Admin generation cancellation, user-confirmed child retries, and two-person manual lifecycle replay can be exercised without a default Provider mutation client.
- Cancellation, retry authorization/outcomes, and reviewed manual replay transitions create safe in-app notifications for affected users and requesters.
- Provider output bytes can be exercised through an injected fixture fetcher, durable ingestion ledger, deterministic media asset, and scanner without retaining the Provider URL.
- Provider cost can be exercised through immutable fixture pricing snapshots, a durable atomic budget window/cost ledger, callback/polling closeout, and safe Admin/metrics evidence without enabling real pricing or dispatch.
- Provider controls can block new fixture dispatch before budget reservation while callbacks, polling, replay, and output ingestion continue draining existing jobs; recovery requires a second operator.

## Fixture-Only Foundations

These pieces are implemented for tests, planning, and safe dry-runs only:

- provider adapter contract tests
- Replicate staging shell metadata and fixture adapter tests
- default-disabled Replicate HTTP client tests with fixed endpoint, minimum payload, secret isolation, and injected fetch
- provider budget event planning and fail-closed budget guard tests
- provider callback route, signature/parser, nonce, audit, and concurrent replay-claim tests
- provider polling lease and stop-condition helpers
- provider lifecycle replay reducer
- provider side-effect plan/executor helpers
- provider replay ledger integration tests
- default-disabled read-only Provider status client with strict response projection and injected-fetch tests
- mocked/injected provider-status client contract
- source-keyed lifecycle notification/audit repository wiring
- disabled-by-default polling worker with oldest-first sweeps, retry isolation, and timeout recovery
- default-unregistered Provider output fetcher with SSRF, redirect, timeout, byte-limit, magic-MIME, checksum, idempotency, and recovery tests
- provider budget external alert payload builder
- injected-only provider alert dispatcher boundary
- disabled webhook, Slack, and email provider alert client shells
- fixture-only provider alert dry-run harness
- Provider-independent four-workspace pricing calculator contract and durable budget ledger fixtures
- fail-closed Provider control-plane contracts and fixture-dispatch integration

Fixture-only means no enabled route, worker, or default client contacts a real provider or external alert channel during CI or ordinary development.

## Still Deferred

These are intentionally unavailable:

- real provider SDK or package integration
- default product-route registration for the Provider HTTP client
- real provider network calls
- real Provider webhook target registration or callback delivery
- enabled real provider status polling
- real Provider cancel/retry client registration
- Admin refund, force-review, or manual settlement mutations
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
| What HTTP client and secret boundary exists? | `docs/V1_PROVIDER_HTTP_AND_SECRETS_BOUNDARY.md` |
| What polling, retry, and timeout boundary exists? | `docs/V1_PROVIDER_POLLING_AND_RECOVERY.md` |
| Can a staging adapter planning branch start? | `docs/REAL_PROVIDER_READINESS_CLOSEOUT_GATE.md` |
| What fixture-only staging shell work is allowed? | `docs/REAL_PROVIDER_STAGING_ADAPTER_SHELL_PLAN.md` |
| What must happen before an external provider call? | `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md` |
| Which providers are selected and under what conditions? | `docs/V1_PROVIDER_DECISION_MATRIX.md` |
| What content policy and review contract must adapters implement? | `docs/V1_CONTENT_SAFETY_POLICY_MATRIX.md` |
| What data, retention, flow, export/delete, and redaction contract applies? | `docs/V1_DATA_GOVERNANCE_BASELINE.md` |
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

1. Additional real Provider SDKs/HTTP clients or default registration/enabling of the V1-05 client.
2. Real provider network calls.
3. Real outbound provider budget alerts.
4. Real callback delivery, enabled real polling, or any manual replay based on live Provider traffic.
5. Real Provider mutation clients or broader Admin refund/settlement controls.
6. Production paid-provider enablement.

## Validation Gate

Documentation-only current-status updates should pass:

```bash
git diff --check
npm run check:quick
```

`npm run check:quick` includes `npm run test:v1-providers`, `npm run test:v1-safety-policy`,
`npm run test:v1-data-governance`, and `npm run test:v1-compliance`. Together they verify all four primary/backup decisions, official source references,
budgets, lifecycle bounds, safety taxonomy, Provider policy/data mappings, review/appeal, retention, flows,
export/deletion, redaction, user disclosures, exact-version consent, support entry points, fail-closed behavior, and unresolved production conditions.

If an update touches smoke scripts, runtime behavior, routes, package scripts, quality gates, README runtime text, or provider configuration, also run:

```bash
npm run check:deploy
```

No validation command should require real provider credentials, real provider jobs, or real outbound provider alert channels.
