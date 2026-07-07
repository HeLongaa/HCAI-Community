# Provider Cost Metadata And Budget Alarms

This document closes the fourth real-provider preflight task: define provider cost metadata, safe Admin visibility, budget thresholds, anomaly alerts, and metrics/audit mapping before any paid provider adapter is allowed to run.

The repository remains mock-provider only. This document does not add a real provider adapter, provider billing reconciliation, subscription management, invoice management, checkout/payment flows, or production paid-provider enforcement. Later staging-adapter tasks added a mocked Replicate client contract, local fail-closed budget guard tests, and a route-level fixture path that requires explicit test injection. They still do not add a default route execution path, real SDK, network client, or production real-provider calls.

## Source Context

The first staging-only provider candidate remains Replicate. Replicate's public docs describe prediction lifecycle, async prediction creation, webhooks, and official models with predictable pricing. Replicate also describes billing in terms of prediction processing time and hardware/model pricing. These public docs are useful for schema design, but concrete prices must not be hard-coded because they can change outside this repository.

fal.ai remains a secondary comparison point because its platform exposes pricing/usage APIs and cost estimation concepts. Those are useful for designing provider-agnostic metadata fields, but this preflight task does not select fal.ai or implement a fal adapter.

## Goals

- Store enough provider cost metadata to explain each generation's expected and final cost.
- Keep product creative credits separate from provider spend and external billing.
- Let Admin history show safe cost status without leaking provider secrets or raw provider payloads.
- Define budget alert events before spend starts.
- Define metrics names and labels without exposing unsafe high-cardinality provider/user data.
- Keep all enforcement fail-closed when cost metadata is missing or uncertain.

## Non-Goals

- Real provider billing reconciliation.
- Payment provider refunds.
- Subscription, invoice, package, or checkout management.
- Real provider adapter calls.
- Provider account balance scraping.
- Production paid-provider enablement.

## Metadata Schema

Provider cost metadata should be attached to the durable generation record as a safe structured object under a provider/accounting namespace. It should also be copied into audit events when an accounting decision is made.

```json
{
  "providerCost": {
    "schemaVersion": "provider-cost-v1",
    "providerId": "replicate",
    "providerAccountRef": "staging",
    "model": {
      "providerModelId": "owner/model",
      "providerModelVersion": "version-or-null",
      "displayName": "Provider model display name",
      "family": "image",
      "pricingSource": "provider_public_pricing",
      "pricingSnapshotAt": "2026-07-06T00:00:00.000Z"
    },
    "job": {
      "providerRequestId": "safe-request-id",
      "providerJobId": "safe-job-id",
      "region": "provider-region-or-null",
      "startedAt": "2026-07-06T00:00:00.000Z",
      "completedAt": "2026-07-06T00:00:10.000Z"
    },
    "usage": {
      "unit": "prediction_seconds",
      "quantity": 10,
      "hardwareClass": "gpu-class-or-null",
      "outputCount": 1,
      "inputTokenCount": null,
      "outputTokenCount": null,
      "rawProviderUsageHash": "sha256-of-provider-usage-payload"
    },
    "estimate": {
      "currency": "USD",
      "amount": 0.05,
      "source": "pre_dispatch_estimate",
      "confidence": "estimated",
      "calculatedAt": "2026-07-06T00:00:00.000Z"
    },
    "actual": {
      "currency": "USD",
      "amount": 0.04,
      "source": "provider_result_metadata",
      "confidence": "provider_reported",
      "settledAt": "2026-07-06T00:00:12.000Z"
    },
    "budget": {
      "budgetScope": "staging:replicate:image",
      "dailyCapCurrency": "USD",
      "dailyCapAmount": 25,
      "thresholdPercent": 80,
      "status": "within_budget"
    },
    "risk": {
      "costKnown": true,
      "costExceededEstimate": false,
      "providerUsageMissing": false,
      "billingReconciliationRequired": false
    }
  }
}
```

### Required Fields

Minimum metadata before provider dispatch:

- `schemaVersion`
- `providerId`
- `providerAccountRef`
- `model.providerModelId`
- `model.family`
- `model.pricingSource`
- `estimate.currency`
- `estimate.amount`
- `estimate.source`
- `estimate.confidence`
- `budget.budgetScope`
- `budget.dailyCapCurrency`
- `budget.dailyCapAmount`

Minimum metadata after provider completion:

- every pre-dispatch field
- `job.providerJobId` or a provider-safe request id
- `job.startedAt`
- `job.completedAt` when known
- `usage.unit`
- `usage.quantity`
- `actual.currency`
- `actual.amount` if provider-reported cost is available
- `actual.confidence`
- `risk.costKnown`
- `risk.providerUsageMissing`

### Confidence Values

| Value | Meaning | Example |
| --- | --- | --- |
| `estimated` | Calculated from local pricing snapshot before provider dispatch | Pre-dispatch guard |
| `provider_reported` | Returned by provider job/result metadata | Provider result includes cost or billable usage |
| `derived` | Derived from provider usage units and local price snapshot | Provider returns seconds/tokens but no final charge |
| `unknown` | Provider usage/cost missing or cannot be safely parsed | Fail-closed for new paid work if budget status cannot be determined |

### Cost Units

Supported first-stage units:

- `prediction_seconds`
- `hardware_seconds`
- `image_output`
- `input_token`
- `output_token`
- `request`
- `unknown`

For Replicate staging, use `prediction_seconds` or `hardware_seconds` when provider lifecycle/usage metadata exposes billable runtime; use `image_output` only for official models with per-output pricing. Keep a raw provider usage hash, not raw payload text, for audit correlation.

## Admin Visibility Boundary

Safe for Admin generation history:

- provider id
- provider account ref such as `staging`, not account email or token id
- model id and version
- pricing snapshot timestamp
- estimated amount and currency
- actual amount and currency, when known
- confidence
- budget scope
- threshold status
- safe provider request/job ids
- usage unit and quantity
- output count
- cost anomaly flags

Server-only or redacted:

- provider API tokens
- provider billing account ids if they identify a real payment account
- raw provider request payload
- raw provider response payload
- raw provider usage payload
- credit card/payment method data
- invoice ids or subscription ids
- provider dashboard URLs that embed account secrets or signed tokens

Prompt safety remains unchanged: Admin surfaces should continue to show prompt hash and short preview only.

## Budget Scopes

Budget scopes should be explicit and low-cardinality:

| Scope level | Example | Use |
| --- | --- | --- |
| Environment/provider/workspace | `staging:replicate:image` | Default first-stage budget |
| Environment/provider/model family | `staging:replicate:image:flux` | Optional model-family cap |
| Environment/provider/user tier | `staging:replicate:image:internal_testers` | Optional controlled beta cap |

Avoid user id, prompt hash, provider job id, or media asset id as metric labels. Use those only in audit records or Admin detail views.

## Budget Alert Policy

### Threshold Alerts

| Alert | Trigger | Severity | Action |
| --- | --- | --- | --- |
| `creative.provider_budget.threshold_50` | spend reaches 50% of daily cap | info | Notify creative ops |
| `creative.provider_budget.threshold_80` | spend reaches 80% of daily cap | warning | Notify creative ops and finance |
| `creative.provider_budget.threshold_100` | spend reaches or exceeds daily cap | critical | Disable new paid provider dispatch for the scope |
| `creative.provider_budget.threshold_120` | spend exceeds cap by 20% | critical | Page ops, keep kill switch active |

Thresholds should be idempotent per budget scope and UTC day. Repeated evaluations should update the same active alert until the day rolls over or an operator acknowledges/resolves it.

### Daily Cap

First staging recommendation:

- provider: Replicate
- scope: `staging:replicate:image`
- cap: low fixed daily USD amount set in environment or provider console
- hard action: deny new paid provider dispatch once cap is reached
- soft action: warn at 50% and 80%

The daily cap must be enforced before dispatch when estimates are available. If actual provider cost arrives after dispatch and crosses the cap, the system should block subsequent dispatches and record the overage.

### Cost Anomaly Alerts

| Alert | Trigger | Severity | Action |
| --- | --- | --- | --- |
| `creative.provider_cost.missing_usage` | completed provider job has no parseable usage/cost metadata | warning | Mark cost confidence `unknown`; review adapter parser |
| `creative.provider_cost.estimate_exceeded` | actual cost exceeds estimate by configured ratio | warning/critical by ratio | Review model/version and input parameters |
| `creative.provider_cost.spend_spike` | spend in current window exceeds historical baseline by configured ratio | warning | Review recent jobs and provider status |
| `creative.provider_cost.zero_cost_anomaly` | actual cost is zero where billable work is expected | warning | Check provider reporting and cost parser |
| `creative.provider_cost.currency_mismatch` | actual currency differs from expected budget currency | critical | Block settlement until normalized |

Initial staging ratios:

- warn when actual cost is at least 2x estimate
- critical when actual cost is at least 5x estimate
- warn when 60-minute spend exceeds 3x trailing 7-day same-hour average, once enough data exists

### Provider Error Spike Alerts

Cost alarms should include provider failure signals because repeated failed paid attempts can burn budget or hide retry loops.

| Alert | Trigger | Severity |
| --- | --- | --- |
| `creative.provider_error.rate_limit_spike` | rate-limit failures exceed threshold in window | warning |
| `creative.provider_error.timeout_spike` | timeout failures exceed threshold in window | warning |
| `creative.provider_error.billable_failure_spike` | failed jobs with actual cost exceed threshold | critical |
| `creative.provider_error.callback_replay_spike` | duplicate webhook/polling callbacks exceed threshold | warning |

## Audit Event Mapping

Recommended audit events:

- `creative.provider_cost.estimated`
- `creative.provider_cost.reported`
- `creative.provider_cost.corrected`
- `creative.provider_budget.threshold_crossed`
- `creative.provider_budget.dispatch_blocked`
- `creative.provider_cost.anomaly_detected`
- `creative.provider_error.spike_detected`

Minimum metadata:

- generation id
- provider id
- provider account ref
- workspace and mode
- model id/version
- budget scope
- currency
- estimated amount
- actual amount when known
- confidence
- threshold/cap values
- anomaly reason code
- provider job id or request id
- idempotency key

Do not store raw provider payloads or secrets in audit metadata.

Current fixture status: `server/src/creative/providerBudgetEvents.js` now builds a pure event plan for `creative.provider_budget.threshold_crossed`, `creative.provider_budget.dispatch_blocked`, and `creative.provider_cost.anomaly_detected`. It emits safe audit-event metadata, threshold alert summaries, and idempotency keys only. It does not write to the audit repository, send notifications, call external alert channels, or enable real provider dispatch.

## Metrics Mapping

Future Prometheus-compatible metric families:

- `newchat_creative_provider_cost_estimated_total{provider,workspace,currency,confidence}`
- `newchat_creative_provider_cost_actual_total{provider,workspace,currency,confidence}`
- `newchat_creative_provider_budget_usage_ratio{provider,workspace,budget_scope}`
- `newchat_creative_provider_budget_alerts_total{provider,workspace,severity,type}`
- `newchat_creative_provider_cost_anomalies_total{provider,workspace,type,severity}`
- `newchat_creative_provider_billable_failures_total{provider,workspace,error_code}`
- `newchat_creative_provider_usage_units_total{provider,workspace,unit}`

Label rules:

- Use provider ids, workspace names, currency, severity, confidence, unit, and coarse error codes only.
- Do not use user id, generation id, provider job id, model version, prompt hash, media asset id, or raw error text as metric labels.
- Put high-cardinality values in Admin detail/audit samples, not metric labels.

Admin operations metrics should surface:

- current window estimated spend
- current window actual spend
- daily cap usage ratio by budget scope
- active budget alert counts
- cost anomaly counts
- billable provider failure counts
- sample audit event links for threshold crossings and anomalies

## Relationship To Creative Credits

Creative credits are product accounting. Provider cost metadata is operational/provider spend accounting.

Rules:

- A generation can settle product creative credits while provider cost remains estimated or unknown.
- A generation can incur provider cost even if product credits are later refunded.
- Product credit refunds do not imply provider refunds.
- Provider cost corrections should not rewrite credit ledger history.
- Manual settlement must explicitly choose both product-credit outcome and provider-cost outcome.

## Enforcement Rules Before Paid Dispatch

The first real adapter implementation should fail closed when:

- pricing snapshot is missing
- estimate amount cannot be calculated
- budget scope is missing
- budget scope or provider account reference is not a safe low-cardinality identifier
- currency is unsupported
- daily cap is reached or unknown
- budget threshold is configured outside the supported range
- provider usage parser is disabled
- provider cost confidence is `unknown` for the previous completed jobs above a configured threshold

Allowed exceptions must be explicit staging-only overrides with audit events and low spending caps.

## Open Questions For Implementation

- Where should pricing snapshots live: environment, database policy, or checked-in fixture plus deployment override?
- Should budget scope caps be role-managed through Admin policy history, similar to point policy?
- Which provider cost alert channel should be used first: existing security alert channel, media alert channel, or a new creative operations channel?
- Should staging require provider-side spending limits in addition to app-side caps?
- Should cost correction require second approval once Admin mutation permissions are implemented?

## Implementation Checklist Later

Before adding real paid provider calls:

- Add provider cost metadata to generation record DTOs and persistence transforms.
- Add parser tests for provider usage and cost metadata.
- Add budget policy config and fail-closed dispatch guard.
- Keep budget scope, provider account references, alert labels, and error metadata low-cardinality and free of provider secrets or raw payloads.
- Add budget threshold and anomaly alert event generation. Fixture-only pure event planning exists; future work still needs repository persistence, notification routing, and metrics exporter wiring.
- Add operations metrics snapshot and Prometheus exporter fields with safe labels.
- Add Admin generation history cost fields behind the safe visibility boundary.
- Add audit event and notification tests.
- Add staging smoke that proves the cost guard blocks when budget metadata is missing.
