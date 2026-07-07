# Real Provider Budget Event Wiring Plan

This plan defines how the fixture-only provider budget event plan should later connect to durable audit records, notifications, Admin operations metrics, and Prometheus-compatible metrics.

Current decision: **audit persistence, internal notification routing, Admin operations metrics, Prometheus-compatible exporter metrics, external alert env/smoke readiness, pure external alert payload building, an injected mock dispatcher boundary, and safe dispatch audit persistence are implemented; external alert delivery remains deferred**. The repository has `server/src/creative/providerBudgetEvents.js`, which builds pure event plans from normalized provider cost metadata, `server/src/creative/providerBudgetAuditPersistence.js`, which persists safe audit records through an injected repository boundary, `server/src/repositories/providerBudgetNotificationWiring.js`, which derives safe internal notification payloads from persisted audit events, `server/src/operations/metrics.js`, which aggregates safe provider budget audit events into Admin operations metrics, `server/src/operations/metricsExporter.js`, which derives a safe external Prometheus subset from those aggregates, `server/src/config/env.js` plus `scripts/smoke-production.mjs`, which parse and smoke-gate `CREATIVE_PROVIDER_ALERT_*` configuration without sending messages, and `server/src/creative/providerBudgetExternalAlerts.js`, which derives channel-neutral external alert payloads, can dispatch only through explicitly injected test clients, can map per-channel dispatch results into safe audit record candidates, and can persist those candidates through `repositories.providerBudgetAudit.recordMany`. This document does not add external alert delivery, Admin mutation controls, real provider SDKs, default HTTP clients, or provider network calls.

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

- send Slack, webhook, or email alerts
- create or poll real provider jobs

Audit persistence and internal notification routing now exist as explicit helper/repository boundaries and are not automatically wired to real provider dispatch.

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

Status: **implemented for internal station notifications**. Notifications are derived from persisted audit events, not from raw provider responses.

Implemented repository surface:

```js
repositories.providerBudgetNotifications.createFromAuditEvents(auditEvents, actor)
```

Implemented first routing:

| Event | Recipients | User-facing? | Severity |
| --- | --- | --- | --- |
| `threshold_50` | Creative ops / audit readers | No | Info |
| `threshold_80` | Creative ops / audit readers | No | Warning |
| `threshold_100` | Creative ops / audit readers | No | Critical |
| `threshold_120` | Creative ops / audit readers | No | Critical |
| `dispatch_blocked` | Creative ops / audit readers | No | Warning or critical by reason |
| `anomaly_detected` | Creative ops / audit readers | No | Warning or critical by reason |

Notification rules:

- Deduplicate by audit `sourceKey` and recipient.
- Do not notify the generation owner until a user-visible product outcome exists.
- Do not include provider job ids, raw URLs, raw prompt text, or provider error bodies.
- Link metadata to Admin audit detail through `metadata.target.admin.auditEventId`.
- Keep notification payloads readable but operational, for example "Provider budget dispatch blocked for staging:replicate:image".

Future role option:

- A later permissions task may add `creative:provider_budget:read` or a dedicated creative operations role.
- Until then, use `admin:audit:read` readers for internal budget visibility.

## Phase 3: Admin Operations Metrics

Status: **implemented for read-only Admin visibility**. Admin operations metrics now aggregate persisted provider budget audit events inside the selected metrics window.

Implemented fields under `metrics.creativeProviderBudget`:

```ts
{
  thresholdAlerts: {
    total,
    bySeverity,
    byBudgetScope,
    byProvider,
    byWorkspace,
    byThreshold,
    latestAt,
  },
  dispatchBlocked: {
    total,
    bySeverity,
    byReason,
    byBudgetScope,
    byProvider,
    byWorkspace,
    latestAt,
  },
  costAnomalies: {
    total,
    byReason,
    bySeverity,
    byBudgetScope,
    byProvider,
    byWorkspace,
    latestAt,
  },
  spend: {
    estimatedAmount,
    actualAmount,
    projectedSpendAmount,
    byCurrency,
  },
  providerAlertDispatches: {
    total,
    succeeded,
    failed,
    skipped,
    byChannel,
    byStatus,
    byReason,
    byProvider,
    byWorkspace,
    latestAt,
    failureSpike: {
      active,
      threshold,
      failures,
      byChannel,
      byReason,
      latestAt,
    },
  },
}
```

Implemented Admin handoff hints:

- Critical dispatch blocks should generate a handoff hint to keep the provider kill switch active.
- Threshold 100/120 should recommend checking the app-side cap and provider-side cap.
- Currency mismatch should recommend blocking settlement until normalized.
- Failed provider alert dispatch audit records should recommend reviewing channel readiness only after the configured failure threshold is reached.

Implemented sample drill-downs:

- `creativeProviderBudgetThresholds`
- `creativeProviderBudgetDispatchBlocks`
- `creativeProviderCostAnomalies`
- `creativeProviderAlertDispatches`

Admin UI exposure:

- summary cards for Provider budget threshold alerts and observed spend signals
- breakdown rows for Provider dispatch blocks and Provider cost anomalies
- breakdown row for Provider alert dispatches, including audit filtering and recent samples
- audit filter buttons for threshold, dispatch-blocked, and anomaly events
- recent sample panels that keep provider job ids and raw provider payloads out of metric-facing labels

Still deferred:

- external alert delivery
- Admin mutation controls for replay, settlement, or provider recovery
- real provider SDK/HTTP calls

## Phase 4: Prometheus Exporter

Status: **implemented as a safe external subset**. Prometheus-compatible metrics are derived from Admin operations metrics, not from raw provider payloads.

Implemented metric families:

- `newchat_creative_provider_budget_alerts_total`
- `newchat_creative_provider_budget_alerts_by_severity_total{severity}`
- `newchat_creative_provider_budget_alerts_by_provider_total{provider}`
- `newchat_creative_provider_budget_alerts_by_workspace_total{workspace}`
- `newchat_creative_provider_budget_alerts_by_threshold_total{threshold}`
- `newchat_creative_provider_budget_dispatch_blocked_total`
- `newchat_creative_provider_budget_dispatch_blocked_by_severity_total{severity}`
- `newchat_creative_provider_budget_dispatch_blocked_by_provider_total{provider}`
- `newchat_creative_provider_budget_dispatch_blocked_by_workspace_total{workspace}`
- `newchat_creative_provider_budget_dispatch_blocked_by_reason_total{reason}`
- `newchat_creative_provider_cost_anomalies_total`
- `newchat_creative_provider_cost_anomalies_by_severity_total{severity}`
- `newchat_creative_provider_cost_anomalies_by_provider_total{provider}`
- `newchat_creative_provider_cost_anomalies_by_workspace_total{workspace}`
- `newchat_creative_provider_cost_anomalies_by_reason_total{reason}`
- `newchat_creative_provider_cost_estimated_total{currency,confidence}`
- `newchat_creative_provider_cost_actual_total{currency,confidence}`
- `newchat_creative_provider_cost_projected_total{currency,confidence}`
- `newchat_creative_provider_cost_observations_by_currency_total{currency}`

Label rules:

- Allowed labels: provider, workspace, severity, type, reason, currency, confidence.
- Budget scope remains out of exporter labels to avoid accidental cardinality growth.
- Forbidden labels: user id, generation id, provider job id, prompt hash, media asset id, raw error text, raw model version.

## Phase 5: External Alert Delivery

Status: **dispatch-audit-plan-ready; delivery implementation still deferred**. `CREATIVE_PROVIDER_ALERT_*` config is parsed into safe summaries, validated, documented, and gated by production smoke only when `CREATIVE_PROVIDER_ALERTS_ENABLED=true`. A pure channel-neutral payload builder derives safe alert payloads from persisted provider budget audit events, the dispatcher boundary only calls explicitly injected test clients, and dispatch results can be mapped into safe audit record candidates. The remaining implementation checklist is maintained in `docs/REAL_PROVIDER_BUDGET_EXTERNAL_ALERT_DELIVERY_PLAN.md`.

External alert delivery remains an explicit approval boundary because it creates outbound side effects.

Before adding Slack, webhook, or email delivery:

- Audit persistence must exist.
- Notification dedupe must exist.
- Admin metrics must expose delivery failure samples before outbound delivery can be considered production-ready.
- The `CREATIVE_PROVIDER_ALERT_*` env and smoke plan must stay aligned with `docs/REAL_PROVIDER_BUDGET_EXTERNAL_ALERT_DELIVERY_PLAN.md`.
- Delivery failures must not block provider budget kill switches.

Do not reuse media scan alert secrets or security alert secrets for provider budget alerts.

Implemented external alert env prefix:

- `CREATIVE_PROVIDER_ALERTS_ENABLED`
- `CREATIVE_PROVIDER_ALERT_CHANNELS`
- `CREATIVE_PROVIDER_ALERT_WEBHOOK_*`
- `CREATIVE_PROVIDER_ALERT_SLACK_*`
- `CREATIVE_PROVIDER_ALERT_EMAIL_*`

Future implementation must record safe dispatch audit events, suppress duplicate channel sends by audit `sourceKey`, and keep provider tokens, raw prompts, output URLs, provider job ids, and raw provider payloads out of alert payloads.

Implemented payload helper:

```js
buildProviderBudgetExternalAlertPayload(auditEvent)
buildProviderBudgetExternalAlertPayloads(auditEvents)
buildProviderBudgetExternalAlertDispatchPlan({ payloads, channels })
buildProviderBudgetExternalAlertClientAdapters({ channels, clients })
dispatchProviderBudgetExternalAlerts({ payloads, channels, clients })
buildProviderBudgetExternalAlertDispatchAuditRecords({ results, now })
persistProviderBudgetExternalAlertDispatchAuditEvents({ dispatch, results, records, repositories, actor, now })
```

The dispatch persistence helper writes only `creative.provider_alert.dispatch` records with `creative_provider_budget_alert` resource type and safe metadata. It reuses the provider budget audit repository for durable source-key dedupe and does not introduce real outbound channel clients.

The helper emits no default outbound side effects. Dispatch only succeeds when a caller explicitly injects a mocked or future-approved channel client. The approved webhook, Slack, and email adapter shells are disabled by default and fail closed with `provider_alert_client_disabled`; there are still no built-in Slack webhook, webhook delivery, email relay, or HTTP clients. Dispatch audit candidates can be persisted through the existing provider budget audit repository after passing the dedicated safe-record validator.

## Testing Matrix

Implemented audit persistence tests:

- Creates one audit event per unique idempotency key.
- Suppresses duplicate threshold events.
- Suppresses duplicate dispatch-blocked events.
- Stores only safe metadata.
- Keeps provider job ids out of metric-facing metadata.
- Returns explicit failure when the audit repository is unavailable.
- Rejects unsupported or non-idempotent audit events before writing.

Implemented notification tests:

- Sends warning/critical notifications to audit readers.
- Deduplicates per recipient and audit `sourceKey`.
- Does not notify ordinary generation owners.
- Does not notify the actor who triggered the internal routing operation.
- Does not include raw prompt, raw provider payload, token, output URL, or provider job id.

Implemented metrics tests:

- Aggregates threshold, dispatch-blocked, and anomaly events by safe labels.
- Does not expose generation ids or provider job ids as labels.
- Adds operations handoff hints for critical budget events.
- Exports Prometheus metrics with safe label fallback.
- Keeps provider job ids, prompt hashes, unsafe workspace values, tokens, and unsupported reason codes out of exporter labels.

Smoke and deploy tests:

- Fixture checks pass without provider credentials.
- Production smoke still requires `CREATIVE_PROVIDER_MODE=mock` or `disabled`.
- Provider alert channel env is optional by default and required only when `CREATIVE_PROVIDER_ALERTS_ENABLED=true`.
- External provider alert payload, injected dispatcher, and dispatch-audit-planning tests cover threshold, dispatch-blocked, anomaly, missing-client, success, and redacted-failure paths without real outbound sends.
- Disabled channel adapter shell tests cover webhook, Slack, and email shells, preserve explicitly injected clients, and verify no default network client is used.

## Recommended PR Order

1. **Audit persistence**: add repository boundary and seed/Prisma parity tests. Implemented.
2. **Notification routing**: create internal creative ops notifications from persisted events. Implemented.
3. **Admin operations metrics**: aggregate provider budget events and expose drill-down filters. Implemented.
4. **Prometheus exporter**: add safe metric families from operations metrics. Implemented.
5. **External alert env/smoke readiness**: parse and smoke-gate `CREATIVE_PROVIDER_ALERT_*` without sending messages. Implemented.
6. **External alert payload builder**: derive channel-neutral safe payloads from persisted audit events without sending messages. Implemented.
7. **Injected mock dispatcher boundary**: route safe payloads to explicitly injected mocked clients and fail closed without clients. Implemented.
8. **Dispatch audit event planning**: map per-channel dispatch results to safe audit record candidates. Implemented.
9. **Dispatch audit persistence**: persist `creative.provider_alert.dispatch` records through the provider budget audit repository with source-key dedupe. Implemented.
10. **Provider alert dispatch metrics/exporter**: aggregate persisted dispatch attempts in Admin operations metrics and Prometheus-compatible exporter output. Implemented.
11. **Provider alert dispatch failure spike policy**: derive thresholded failure-spike signals from persisted dispatch audit rows. Implemented.
12. **Approved provider alert channel client adapter shell**: define disabled webhook, Slack, and email client shells without real outbound delivery. Implemented.
13. **External alert delivery**: separate phase only after explicit approval.

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

The safest next implementation is **explicit provider alert delivery approval and configuration wiring**, still without sending real outbound messages by default:

- define the exact feature gate and env-to-client wiring that would be required before any real webhook, Slack, or email relay client can be enabled
- keep every client disabled unless the approved gate, channel config, and test fixture path are present
- preserve current audit, idempotency, metrics, and failure-spike boundaries
- keep actual external delivery, Admin mutation controls, provider callback/manual replay endpoints, and real provider calls deferred until explicitly approved

The durable audit source of truth, internal notification routing, Admin read-only metrics, Prometheus-compatible exporter metrics, external alert env/smoke validation, pure payload builder, injected mock dispatcher boundary, disabled channel adapter shell, dispatch audit planning, dispatch audit persistence, dispatch observability, failure-spike policy, and external alert delivery plan now exist. External delivery should still be staged behind explicit channel-client approval before any outbound message is sent.
