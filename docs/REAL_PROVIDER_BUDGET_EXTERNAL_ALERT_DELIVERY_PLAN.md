# Real Provider Budget External Alert Delivery Plan

This plan defines the approval boundary and implementation checklist for future external Slack, webhook, or email delivery of creative provider budget alerts.

Current decision: **dispatch audit persistence, approved channel client shells, explicit approval/config wiring, and fixture dry-run harness without real external delivery**. Durable audit persistence, internal station notifications, Admin operations metrics, Prometheus-compatible exporter metrics, `CREATIVE_PROVIDER_ALERT_*` env/smoke validation, a pure channel-neutral provider alert payload builder, an injected dispatcher boundary for tests, explicit disabled client adapter shells for webhook/Slack/email, explicit approval/config wiring for fixture-only readiness, a fixture-only dry-run harness, safe dispatch audit record candidate planning, per-channel dispatch audit persistence, dispatch observability, and failure-spike policy exist. External alert delivery still must not send outbound Slack, webhook, or email messages until a later explicitly approved implementation PR provides approved real clients.

Admin read-only visibility now includes fixture dry-run dispatch audit rows and safe aggregate summaries. The UI and metrics can show dry-run totals, failures, channel/status/reason/provider/workspace breakdowns, and latest audit time from persisted audit records marked with `dispatchMode=fixture_dry_run` or `fixtureDryRun=true`; this visibility does not add a run button, retry button, replay endpoint, recovery control, or any real outbound client.

## Non-Goals For This Planning Step

- Do not send external Slack, webhook, or email alerts.
- Do not add provider SDKs, default HTTP clients, callback routes, or manual replay endpoints.
- Do not add Admin mutation, replay, recovery, or settlement controls.
- Do not make real paid provider calls.
- Do not reuse `MEDIA_SCAN_ALERT_*` or `SECURITY_ALERT_*` secrets.

## Trigger Source

External alert delivery must derive from already persisted provider budget audit events:

- `creative.provider_budget.threshold_crossed`
- `creative.provider_budget.dispatch_blocked`
- `creative.provider_cost.anomaly_detected`

The delivery layer must consume safe audit event metadata or the existing internal notification payloads. It must not read raw provider responses, raw prompts, output URLs, provider tokens, provider job ids as routing keys, or provider error bodies.

Implemented payload builder:

```js
buildProviderBudgetExternalAlertPayload(auditEvent)
buildProviderBudgetExternalAlertPayloads(auditEvents)
buildProviderBudgetExternalAlertDispatchPlan({ payloads, channels })
buildProviderBudgetExternalAlertClientAdapters({ channels, clients })
buildProviderBudgetExternalAlertDeliveryWiring({ config, approval, fixtureClients })
dispatchProviderBudgetExternalAlerts({ payloads, channels, clients })
buildProviderBudgetExternalAlertDispatchAuditRecords({ results, now })
persistProviderBudgetExternalAlertDispatchAuditEvents({ dispatch, results, records, repositories, actor, now })
runProviderBudgetExternalAlertFixtureDryRun({ auditEvents, config, approval, fixtureClients, repositories, actor, now })
```

The builder is pure and channel-neutral. The dispatcher boundary is injected-only: tests can pass mocked `webhook`, `slack`, or `email` clients, missing clients fail closed with safe per-channel results, and the approved channel adapter shell returns disabled clients unless a caller explicitly injects a client. The delivery wiring helper consumes only safe config booleans/counts/timeouts plus explicit approval flags; without approval it returns disabled clients, and with approval it only enables fixture-injected clients when `fixtureOnly=true`. The fixture dry-run harness consumes already available safe audit events, builds alert payloads, routes them through fixture-only wiring and injected clients, and persists resulting dispatch audit records through the existing audit repository boundary. Disabled shells report `provider_alert_client_disabled` and never create default HTTP, Slack webhook, email relay, or provider SDK behavior.

## Environment Variables

These variables are parsed by `buildEnv`, exposed only as safe booleans/counts/small enums, and included in production smoke readiness checks. They do not activate outbound delivery yet because no dispatcher or external clients are wired.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CREATIVE_PROVIDER_ALERTS_ENABLED` | `false` | Master switch for external provider budget alert delivery. |
| `CREATIVE_PROVIDER_ALERT_CHANNELS` | empty | Comma-separated external channels, for example `webhook,slack,email`. |
| `CREATIVE_PROVIDER_ALERT_WINDOW_MINUTES` | `60` | Lookback window for delivery-failure spike detection. |
| `CREATIVE_PROVIDER_ALERT_DELIVERY_FAILED_ALERT_THRESHOLD` | `2` | Failure count that creates a delivery-failure alert signal. |
| `CREATIVE_PROVIDER_ALERT_WEBHOOK_URL` | empty | Dedicated provider budget webhook endpoint. |
| `CREATIVE_PROVIDER_ALERT_WEBHOOK_SECRET` | empty | Optional/recommended signing secret for webhook payloads. |
| `CREATIVE_PROVIDER_ALERT_WEBHOOK_TIMEOUT_SECONDS` | `5` | Webhook timeout. |
| `CREATIVE_PROVIDER_ALERT_SLACK_WEBHOOK_URL` | empty | Dedicated provider budget Slack webhook endpoint. |
| `CREATIVE_PROVIDER_ALERT_SLACK_TIMEOUT_SECONDS` | `5` | Slack timeout. |
| `CREATIVE_PROVIDER_ALERT_EMAIL_WEBHOOK_URL` | empty | Email relay endpoint for provider budget alerts. |
| `CREATIVE_PROVIDER_ALERT_EMAIL_WEBHOOK_SECRET` | empty | Optional/recommended signing secret for the email relay. |
| `CREATIVE_PROVIDER_ALERT_EMAIL_TO` | empty | Comma-separated external email recipients. Required when email webhook is configured. |
| `CREATIVE_PROVIDER_ALERT_EMAIL_FROM` | empty | Optional sender identity for email relay payloads. |
| `CREATIVE_PROVIDER_ALERT_EMAIL_TIMEOUT_SECONDS` | `5` | Email relay timeout. |

Implemented validation rules:

- If `CREATIVE_PROVIDER_ALERTS_ENABLED=true`, at least one configured channel must be present.
- Every configured URL must be a valid URL.
- Every timeout must be a positive integer.
- `CREATIVE_PROVIDER_ALERT_EMAIL_TO` is required when `CREATIVE_PROVIDER_ALERT_EMAIL_WEBHOOK_URL` is configured.
- Secrets must never be emitted in safe config summaries, audit metadata, notification metadata, Prometheus labels, or logs.

## Recipient And Permission Model

Initial recommendation: route external provider budget alerts to a dedicated creative operations channel configured by env, while internal station notifications continue to target `admin:audit:read` readers.

Open decision before implementation:

- Option A: keep internal recipients as `admin:audit:read` and use env-only external recipients.
- Option B: add a dedicated permission such as `creative:provider_budget:read` before enabling user-visible recipient selection.

Do not notify ordinary generation owners from provider budget external alerts unless a later product workflow creates a user-visible generation outcome.

## Payload Rules

Allowed payload fields:

- action
- severity
- reasonCode
- budgetScope
- providerId
- workspace
- crossedThresholdPercent
- usageRatioPercent
- estimateAmount
- actualAmount
- projectedSpendAmount
- currency
- auditEventId
- createdAt
- Admin audit deep link when available

Forbidden payload fields:

- provider token or request headers
- raw provider response
- raw prompt
- output URL
- provider job id
- generation id as a routing key
- user email or user id
- media asset id
- raw error body
- model version if it can create high-cardinality payloads

## Idempotency And Dedupe

Delivery idempotency should be based on:

```text
creative-provider-alert:<channel>:<auditEventSourceKey>
```

The dispatcher must suppress duplicate delivery attempts for the same channel and audit source key. Retrying a failed channel should create a new attempt record but keep the same logical idempotency key so successful duplicate sends are suppressed.

Recommended audit metadata:

- `sourceKey`
- `channel`
- `status`
- `statusCode`
- `error`
- `attempt`
- `alertAction`
- `auditEventId`
- `budgetScope`
- `providerId`
- `workspace`
- `severity`
- `reasonCode`
- `dispatchMode`
- `fixtureDryRun`

Do not include external URLs, secrets, raw request payloads, raw response bodies, or provider job ids in dispatch audit metadata.

## Audit Actions

Implemented delivery-attempt audit event:

| Action | Resource Type | Purpose |
| --- | --- | --- |
| `creative.provider_alert.dispatch` | `creative_provider_budget_alert` | One row per channel delivery attempt. |
| `creative.provider_alert.delivery_failed` | `creative_provider_budget_alert` | Optional normalized failure signal for delivery-failure spike aggregation. |

Admin operations metrics aggregate persisted delivery attempts into:

- total provider alert dispatches
- succeeded, failed, and skipped counts
- dispatches by channel, status, reason, provider, and workspace
- latest dispatch audit timestamp
- fixture dry-run dispatch totals, success/failure/skipped counts, breakdowns, and latest audit timestamp
- thresholded failure-spike status, threshold, failure count, channel breakdown, and reason breakdown for non-fixture dispatches only

Prometheus exporter derives:

- `newchat_creative_provider_alert_dispatches_total`
- `newchat_creative_provider_alert_dispatches_succeeded_total`
- `newchat_creative_provider_alert_dispatches_failed_total`
- `newchat_creative_provider_alert_dispatches_skipped_total`
- `newchat_creative_provider_alert_dispatches_by_channel_total{channel}`
- `newchat_creative_provider_alert_dispatches_by_status_total{status}`
- `newchat_creative_provider_alert_dispatches_by_reason_total{reason}`
- `newchat_creative_provider_alert_dispatches_by_provider_total{provider}`
- `newchat_creative_provider_alert_dispatches_by_workspace_total{workspace}`
- `newchat_creative_provider_alert_fixture_dry_run_dispatches_total`
- `newchat_creative_provider_alert_fixture_dry_run_dispatches_succeeded_total`
- `newchat_creative_provider_alert_fixture_dry_run_dispatches_failed_total`
- `newchat_creative_provider_alert_fixture_dry_run_dispatches_skipped_total`
- `newchat_creative_provider_alert_fixture_dry_run_dispatches_by_channel_total{channel}`
- `newchat_creative_provider_alert_fixture_dry_run_dispatches_by_status_total{status}`
- `newchat_creative_provider_alert_fixture_dry_run_dispatches_by_reason_total{reason}`
- `newchat_creative_provider_alert_fixture_dry_run_dispatches_by_provider_total{provider}`
- `newchat_creative_provider_alert_fixture_dry_run_dispatches_by_workspace_total{workspace}`
- `newchat_creative_provider_alert_dispatch_failure_spike_active`
- `newchat_creative_provider_alert_dispatch_failure_spike_threshold`
- `newchat_creative_provider_alert_dispatch_failure_spike_failures_total`
- `newchat_creative_provider_alert_dispatch_failure_spike_by_channel_total{channel}`
- `newchat_creative_provider_alert_dispatch_failure_spike_by_reason_total{reason}`

## Failure Isolation

External alert delivery must be best-effort and non-blocking.

- Dispatch failures must not block provider budget kill switches.
- Dispatch failures must not retry real provider calls.
- Dispatch failures must not mark provider budget events as unpersisted.
- Dispatch failures must not fail user-facing creative generation requests.
- Timeouts should be short and per-channel.
- Partial delivery success should be represented per channel.

If every configured channel fails repeatedly, surface that through Admin operations metrics and Prometheus. Do not hide the original provider budget alert just because delivery failed.

## Smoke Criteria

Managed smoke requires provider alert channels only when `CREATIVE_PROVIDER_ALERTS_ENABLED=true`.

Smoke verifies:

- provider alert delivery is disabled by default
- enabled delivery has at least one configured channel
- configured URLs parse as URLs
- email webhook requires recipients
- secrets are present as booleans in safe summaries only
- production smoke still keeps `CREATIVE_PROVIDER_MODE=mock` or `disabled` unless a separate provider rollout approves otherwise

Payload-builder, disabled adapter shell, approval/config wiring, fixture dry-run harness, injected-dispatcher, and dispatch-audit-planning tests verify that no provider token, webhook URL, email address, Slack webhook, raw prompt, raw provider payload, output URL, generation id, or provider job id appears in payload output, dispatch envelopes, dispatch results, disabled shell JSON, wiring summaries, dry-run summaries, or dispatch audit record candidates. Future production-client tests must additionally verify the same rule for logs, metrics labels, and real request bodies.

## Implementation Order

1. Add env parsing and safe config summaries for `CREATIVE_PROVIDER_ALERT_*`. Implemented.
2. Add smoke checks gated by `CREATIVE_PROVIDER_ALERTS_ENABLED=true`. Implemented.
3. Add a pure payload builder from persisted audit events, still without outbound sends. Implemented.
4. Add an injected dispatcher boundary with mocked webhook, Slack, and email clients in tests, still without default outbound clients. Implemented.
5. Plan per-channel dispatch audit event candidates with safe metadata. Implemented.
6. Persist per-channel dispatch audit events with safe metadata. Implemented.
7. Add delivery-failure aggregation to Admin operations metrics and `/metrics`. Implemented.
8. Add thresholded delivery-failure spike policy. Implemented.
9. Add approved webhook/Slack/email client adapter shells that remain disabled unless clients are explicitly injected. Implemented.
10. Add explicit approval/config wiring that only permits fixture-injected clients and keeps real delivery unavailable. Implemented.
11. Add fixture-only dry-run harness that dispatches through injected clients and persists safe dispatch audit records. Implemented.
12. Surface fixture dry-run dispatch audit records in Admin read-only metrics and Prometheus-compatible exporter summaries. Implemented.
13. Only then consider enabling a staging external channel with fixture events after explicit approval.

## Explicit Approval Required

Before any implementation PR sends outbound messages, the user must approve:

- which channels are enabled first
- which environment owns the first smoke test
- whether a dedicated creative operations permission is required
- whether delivery failure alerts should page humans or stay dashboard-only
- retention expectations for dispatch audit records

Until then, real external alert delivery remains deferred even though env parsing, smoke validation, dispatch audit persistence, observability, failure-spike policy, disabled channel adapter shells, fixture-only approval/config wiring, fixture dry-run harness, and Admin read-only dry-run visibility exist.
