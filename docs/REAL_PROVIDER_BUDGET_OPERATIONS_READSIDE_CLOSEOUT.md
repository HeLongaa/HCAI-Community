# Real Provider Budget Operations Read-Side Closeout

This closeout captures the current read-side state for provider budget, cost, alert, notification, and operations observability. It is intentionally limited to fixture-safe and read-only surfaces.

Current decision: **provider budget operations read-side is complete for repository, fixture CI, and PR-ready handoff; real external alert delivery, real paid-provider calls, provider billing reconciliation, provider callback routes, real polling, manual replay endpoints, and Admin mutation controls remain deferred**.

This document does not approve a real provider call or an outbound provider budget alert. A real external-call rehearsal still requires `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md`, current Notion evidence in Chinese, and explicit user approval for the exact staging run.

## Completed Read-Side Chain

The provider budget operations read-side now has these safe foundations:

1. Provider cost metadata shape and Admin visibility boundary in `docs/REAL_PROVIDER_COST_METADATA_AND_BUDGET_ALARMS.md`.
2. Pure provider budget event planning in `server/src/creative/providerBudgetEvents.js`.
3. Durable provider budget audit persistence through `repositories.providerBudgetAudit.recordMany`.
4. Internal station notification routing from persisted provider budget audit events.
5. Admin operations metrics aggregation for provider budget threshold, dispatch-block, cost-anomaly, and provider-alert dispatch audit rows.
6. Prometheus-compatible exporter metrics with low-cardinality safe labels.
7. External alert env/smoke readiness that validates `CREATIVE_PROVIDER_ALERT_*` without sending messages.
8. Channel-neutral external alert payload building from persisted audit events.
9. Injected-only dispatcher boundary and disabled webhook, Slack, and email client shells.
10. Fixture-only external alert dry-run harness with safe dispatch audit persistence.
11. Admin generation history provider cost/budget allowlist sanitizer and read-only UI summaries.

## Current Usable Read Paths

| Surface | Status | What Operators Can See | Boundary |
| --- | --- | --- | --- |
| Admin generation history | Usable read-only | Sanitized provider cost, estimate, actual, budget status, usage hash, risk flags, provider replay evidence | No retry, cancel, refund, replay, recovery, or settlement controls |
| Admin operations metrics | Usable read-only | Provider budget threshold counts, dispatch blocks, cost anomalies, observed spend, provider alert dispatch and fixture dry-run totals | Aggregates persisted safe audit rows only |
| Admin audit log | Usable read-only | `creative.provider_budget.threshold_crossed`, `creative.provider_budget.dispatch_blocked`, `creative.provider_cost.anomaly_detected`, `creative.provider_alert.dispatch` | No raw provider payloads, prompts, output URLs, secrets, or provider job ids in metric-facing labels |
| Internal notifications | Usable for audit readers | Operational provider budget warnings and critical alerts linked to Admin audit detail | Does not notify ordinary generation owners |
| Prometheus exporter | Usable safe subset | Provider budget, cost, anomaly, dispatch, fixture dry-run, and failure-spike metrics | Labels are folded to safe values; no generation/provider job/user/prompt/media labels |
| Fixture dry-run harness | Usable in tests only | Payload building, injected fixture channel results, dispatch audit persistence | No route, no Admin run button, no default network client |
| Production smoke | Usable config gate | Provider alert channel readiness only when `CREATIVE_PROVIDER_ALERTS_ENABLED=true` | Smoke does not send alerts |

## Safe Data Flow

```text
providerCost fixture metadata
  -> provider budget event plan
  -> provider budget audit persistence
  -> internal notification routing
  -> Admin operations metrics
  -> Prometheus exporter
  -> optional fixture-only alert dry-run audit rows
  -> Admin read-only drill-downs
```

The read-side depends on persisted audit events, not raw provider responses. That keeps provider spend observability separate from product creative credits and separate from external billing reconciliation.

## Read-Only Operator Flow

1. An audit-authorized operator opens Admin Center.
2. The operator checks the operations metrics panel.
3. Provider threshold alerts show count, severity, budget scope, provider, workspace, threshold, and latest timestamp.
4. Provider dispatch blocks show count, severity, reason, budget scope, provider, workspace, and latest timestamp.
5. Provider cost anomalies show count, severity, reason, budget scope, provider, workspace, and latest timestamp.
6. Provider alert dispatch metrics show total, succeeded, failed, skipped, channel/status/reason/provider/workspace breakdowns, fixture dry-run totals, and failure-spike status.
7. Audit filter buttons move the operator into the underlying safe audit rows.
8. Generation history detail can show sanitized cost/budget metadata for the generation without exposing raw provider payloads or output URLs.

## Notification Flow

1. Provider budget audit events are persisted first.
2. Internal notifications are derived from persisted audit rows.
3. Recipients are audit readers, excluding the actor who triggered routing.
4. Notifications dedupe by recipient and audit `sourceKey`.
5. Notification metadata links to Admin audit detail through `metadata.target.admin.auditEventId`.
6. Notification payloads do not include raw prompts, provider job ids, provider output URLs, tokens, raw provider payloads, or raw provider error bodies.

## Metrics And Exporter Boundary

Admin operations metrics aggregate these audit actions:

- `creative.provider_budget.threshold_crossed`
- `creative.provider_budget.dispatch_blocked`
- `creative.provider_cost.anomaly_detected`
- `creative.provider_alert.dispatch`

Prometheus exporter labels are intentionally narrow:

- allowed: provider, workspace, severity, threshold, reason, currency, confidence, channel, status
- forbidden: user id, generation id, provider job id, prompt hash, media asset id, output URL, raw error text, raw model version, email, token, webhook URL

Budget scope can appear inside Admin read-only detail and audit metadata, but it is not used as a Prometheus label to avoid accidental cardinality growth.

## Fixture Dry-Run Boundary

The fixture dry-run harness can exercise payload building, injected fixture channel clients, and dispatch audit persistence.

It still does not provide:

- Admin run button
- public or internal route
- default HTTP client
- real Slack webhook sender
- real webhook sender
- real email relay sender
- provider SDK
- provider network call
- retry or recovery mutation control

Fixture dry-run dispatch rows are marked with `dispatchMode=fixture_dry_run` or `fixtureDryRun=true`. Metrics keep fixture dry-run dispatch counts separate from non-fixture failure-spike signals.

## Still Deferred

These remain intentionally unavailable:

- real external Slack, webhook, or email delivery for provider budget alerts
- real provider SDK, default provider HTTP client, or paid provider network call
- provider callback route
- real provider polling worker or default provider status client
- manual replay endpoint
- Admin retry, cancel, refund, force-review, replay, recovery, or manual settlement controls
- provider billing reconciliation, invoice matching, or payment-provider refund flow
- role-managed provider budget policy editor
- user-visible provider budget notifications for ordinary generation owners
- production paid-provider enablement

## Maintenance Rules

- Persist provider budget audit rows before routing notifications or deriving metrics.
- Keep external alert delivery best-effort and non-blocking if it is implemented later.
- Keep provider spend accounting separate from product creative credit settlement/refund.
- Keep all provider budget surfaces read-only until a separate Admin mutation phase is approved.
- Keep unsafe provider fields out of Notion, audit metadata, notification metadata, logs, metrics labels, and PR descriptions.
- Treat ordinary continuation language such as "continue" or "next" as insufficient approval for real provider calls or outbound alert delivery.

## Validation Evidence

Focused tests that currently cover this closeout:

```bash
npm --prefix server test -- src/creative/providerBudgetAuditPersistence.test.js
npm --prefix server test -- src/creative/providerBudgetNotifications.test.js
npm --prefix server test -- src/creative/providerBudgetExternalAlerts.test.js
npm --prefix server test -- src/operations/metrics.test.js
npm --prefix server test -- src/operations/metricsExporter.test.js
npm --prefix server test -- src/modules/admin/routes.test.js
```

Repository gates:

```bash
git diff --check
npm run check:quick
npm run check:deploy
```

No validation command should require real provider credentials or real outbound alert channels.

## Next Allowed Work

Allowed without real-provider approval:

1. Documentation consistency updates.
2. Fixture-only tests for read-only Admin operations samples, exporter labels, notifications, and dry-run audit rows.
3. Metadata-only smoke improvements for provider alert readiness.
4. Additional read-only Admin summaries that use existing sanitized audit or generation-history data.

Requires explicit approval:

1. Any real outbound provider budget alert delivery.
2. Any real provider SDK or network-capable provider client.
3. Any route or worker that can create or poll real provider jobs.
4. Any Admin mutation for replay, retry, cancel, refund, settlement, or recovery.
5. Any production paid-provider enablement.
