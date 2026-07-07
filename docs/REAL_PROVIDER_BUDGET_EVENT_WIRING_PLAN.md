# Real Provider Budget Event Wiring Plan

This plan defines how the fixture-only provider budget event plan should later connect to durable audit records, notifications, Admin operations metrics, and Prometheus-compatible metrics.

Current decision: **audit persistence foundation implemented; fan-out still deferred**. The repository has `server/src/creative/providerBudgetEvents.js`, which builds pure event plans from normalized provider cost metadata, and `server/src/creative/providerBudgetAuditPersistence.js`, which persists safe audit records through an injected repository boundary. This document does not add notification fan-out, external alert delivery, Admin mutation controls, real provider SDKs, default HTTP clients, or provider network calls.

## Current Fixture Baseline

Available today:

- `buildProviderBudgetThresholdEvents`
- `buildProviderBudgetDispatchBlockedEvent`
- `buildProviderCostAnomalyEvents`
- `buildProviderBudgetEventPlan`

These helpers produce:

- safe audit event payloads
- threshold alert summaries
- idempotency keys
- low-cardinality metadata only

They do not:

- create notifications
- update Admin operations metrics
- expose Prometheus metrics
- send Slack, webhook, or email alerts
- create or poll real provider jobs

Audit persistence now exists as an explicit helper/repository boundary and is not automatically wired to real provider dispatch.

## Wiring Principles

- Keep provider spend accounting separate from product creative credits.
- Treat `providerBudgetEvents` output as a plan, not a side effect.
- Persist audit events before creating notifications or metrics samples.
- Use stable idempotency keys for every threshold, dispatch block, and anomaly.
- Keep provider job ids and generation ids in audit detail only; never use them as metric labels.
- Do not store provider tokens, raw prompts, raw provider payloads, raw output URLs, or full provider error bodies.
- Keep Admin generation history read-only.

## Phase 1: Audit Persistence

Status: **implemented as a foundation**. Event-plan audit events can now be persisted through a small repository boundary.

Implemented repository surface:

```js
repositories.providerBudgetAudit.recordMany(records, actor)
```

Implemented helper:

```js
persistProviderBudgetAuditEvents({
  plan,
  repositories,
  actor,
})
```

Persistence rules:

- Store events in the existing audit event table.
- Use `action` from the plan.
- Use `resourceType=creative_provider_budget`.
- Use `resourceId` as the budget scope or the event idempotency key, depending on the action.
- Store the idempotency key inside metadata.
- Add a stable `sourceKey` derived from the event idempotency key.
- Suppress duplicates by action + resource type + resource id + metadata source key.
- Return created and duplicate counts so callers can safely retry.
- Return an explicit failed result for invalid events or repository failures.

Initial actions:

| Action | Persist first? | Notes |
| --- | --- | --- |
| `creative.provider_budget.dispatch_blocked` | Yes | Highest priority because it proves fail-closed behavior. |
| `creative.provider_budget.threshold_crossed` | Yes | Persist only when crossing 50/80/100/120 thresholds. |
| `creative.provider_cost.anomaly_detected` | Yes | Persist missing usage, estimate exceeded, currency mismatch, and zero-cost anomalies. |

Still deferred:

- `creative.provider_cost.estimated`
- `creative.provider_cost.reported`
- `creative.provider_cost.corrected`
- `creative.provider_error.spike_detected`

## Phase 2: Notification Routing

Notifications should be derived from persisted audit events, not from raw provider responses.

Recommended first routing:

| Event | Recipients | User-facing? | Severity |
| --- | --- | --- | --- |
| `threshold_50` | Creative ops / audit readers | No | Info |
| `threshold_80` | Creative ops / audit readers | No | Warning |
| `threshold_100` | Creative ops / audit readers | No | Critical |
| `threshold_120` | Creative ops / audit readers | No | Critical |
| `dispatch_blocked` | Creative ops / audit readers | No | Warning or critical by reason |
| `anomaly_detected` | Creative ops / audit readers | No | Warning or critical by reason |

Notification rules:

- Deduplicate by idempotency key and recipient.
- Do not notify the generation owner until a user-visible product outcome exists.
- Do not include provider job ids, raw URLs, raw prompt text, or provider error bodies.
- Link to Admin generation history or audit detail when available.
- Keep notification payloads readable but operational, for example "Provider budget dispatch blocked for staging:replicate:image".

Future role option:

- A later permissions task may add `creative:provider_budget:read` or a dedicated creative operations role.
- Until then, use `admin:audit:read` readers for internal budget visibility.

## Phase 3: Admin Operations Metrics

Admin operations metrics should aggregate persisted audit events in the selected window.

Recommended fields under `metrics.creativeProviderBudget`:

```js
{
  thresholdAlerts: {
    total,
    bySeverity,
    byBudgetScope,
  },
  dispatchBlocked: {
    total,
    byReason,
    byBudgetScope,
  },
  costAnomalies: {
    total,
    byReason,
    bySeverity,
  },
  spend: {
    estimatedAmount,
    actualAmount,
    currency,
  },
}
```

Admin handoff hints:

- Critical dispatch blocks should generate a handoff hint to keep the provider kill switch active.
- Threshold 100/120 should recommend checking the app-side cap and provider-side cap.
- Currency mismatch should recommend blocking settlement until normalized.

Sample drill-downs:

- `creativeProviderThresholds`
- `creativeProviderDispatchBlocks`
- `creativeProviderCostAnomalies`

## Phase 4: Prometheus Exporter

Prometheus-compatible metrics should be derived from Admin operations metrics.

Recommended metric families:

- `newchat_creative_provider_budget_alerts_total{provider,workspace,severity,type}`
- `newchat_creative_provider_budget_dispatch_blocked_total{provider,workspace,reason}`
- `newchat_creative_provider_cost_anomalies_total{provider,workspace,type,severity}`
- `newchat_creative_provider_cost_estimated_total{provider,workspace,currency,confidence}`
- `newchat_creative_provider_cost_actual_total{provider,workspace,currency,confidence}`

Label rules:

- Allowed labels: provider, workspace, severity, type, reason, currency, confidence.
- Optional label: budget scope only if it stays low-cardinality and is passed through `safeMetricLabel`.
- Forbidden labels: user id, generation id, provider job id, prompt hash, media asset id, raw error text, raw model version.

## Phase 5: External Alert Delivery

External alert delivery remains deferred.

Before adding Slack, webhook, or email delivery:

- Audit persistence must exist.
- Notification dedupe must exist.
- Admin metrics must expose delivery failure samples.
- A separate env and smoke plan must be written for `CREATIVE_PROVIDER_ALERT_*`.
- Delivery failures must not block provider budget kill switches.

Do not reuse media scan alert secrets or security alert secrets for provider budget alerts.

## Testing Matrix

Implemented audit persistence tests:

- Creates one audit event per unique idempotency key.
- Suppresses duplicate threshold events.
- Suppresses duplicate dispatch-blocked events.
- Stores only safe metadata.
- Keeps provider job ids out of metric-facing metadata.
- Returns explicit failure when the audit repository is unavailable.
- Rejects unsupported or non-idempotent audit events before writing.

Notification tests:

- Sends warning/critical notifications to audit readers.
- Deduplicates per recipient and idempotency key.
- Does not notify ordinary generation owners.
- Does not include raw prompt, raw provider payload, token, or output URL.

Metrics tests:

- Aggregates threshold, dispatch-blocked, and anomaly events by safe labels.
- Exports Prometheus metrics with safe label fallback.
- Does not expose generation ids or provider job ids as labels.
- Adds operations handoff hints for critical budget events.

Smoke and deploy tests:

- Fixture checks pass without provider credentials.
- Production smoke still requires `CREATIVE_PROVIDER_MODE=mock` or `disabled`.
- No new external alert env is required until a later explicit alert-delivery phase.

## Recommended PR Order

1. **Audit persistence**: add repository boundary and seed/Prisma parity tests.
2. **Notification routing**: create internal creative ops notifications from persisted events.
3. **Admin operations metrics**: aggregate provider budget events and expose drill-down filters.
4. **Prometheus exporter**: add safe metric families from operations metrics.
5. **External alert delivery**: separate phase only after explicit approval.

## No-Go Conditions

No-go for implementation if any are true:

- Event metadata requires raw provider payloads.
- Notification copy includes raw prompt or provider output URL.
- Metrics need high-cardinality labels.
- External alert delivery is required before audit persistence exists.
- A real provider call is needed to test the wiring.
- Admin mutation controls are required for recovery.
- The Notion task is missing or stale.

## Next Suggested Implementation

The safest next implementation is **notification routing from persisted audit events**:

- create internal creative ops notifications from persisted budget audit events
- deduplicate per recipient and audit `sourceKey`
- keep notification payloads safe and operational
- keep Admin metrics, Prometheus metrics, external alert delivery, and real provider calls deferred

The durable audit source of truth now exists, so notification fan-out can build on persisted evidence instead of raw provider payloads.
