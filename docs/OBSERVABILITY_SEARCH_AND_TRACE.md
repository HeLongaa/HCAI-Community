# Observability Search And Trace

`OBS-02` provides an access-controlled Admin read side for sanitized application logs, W3C traces, API SLOs, and burn-rate alerts. The machine contract is `config/observability-search-contract.json`; run `npm run test:observability-search` to verify it.

## Scope And Boundaries

- The product remains personal-account-only. No tenant, organization, team, membership, or invitation scope is introduced.
- This feature does not register, enable, probe, or call any real Provider client.
- PostgreSQL stores sanitized HTTP completion logs, server spans, and alert state. Audit events remain a separate immutable evidence stream.
- Log search covers at most 30 days, list pages contain at most 100 records, and one export contains at most 1000 records.

## Collection And Correlation

Every completed HTTP request records one `http.request.completed` log and one server span after the response finishes. The record uses the route template, status class, duration, module, operation, request ID, trace ID, service span ID, and the incoming parent span ID when a valid W3C `traceparent` is supplied.

Incoming trace IDs are preserved. The incoming span ID becomes `parentSpanId`, and the service generates its own span ID. Raw paths, query values, headers, request bodies, prompts, chat messages, Provider payloads, credentials, cookies, tokens, secrets, and storage URLs are never persisted.

## Admin Operations

| Operation | Permission | Audit action |
| --- | --- | --- |
| Search logs | `admin:observability:read` | `admin.observability.logs_queried` |
| Read log detail | `admin:observability:read` | `admin.observability.log_detail_read` |
| Read Trace timeline | `admin:observability:read` | `admin.observability.trace_read` |
| Read SLO status | `admin:observability:read` | `admin.observability.slos_read` |
| Read alerts | `admin:observability:read` | `admin.observability.alerts_read` |
| Export logs | `admin:observability:export` | `admin.observability.logs_exported` |
| Evaluate SLOs | `admin:observability:manage` | `admin.observability.slos_evaluated` |
| Acknowledge, silence, or resolve | `admin:observability:manage` | State-specific disposition action |

Exports use `observability.log-export.v1`. The manifest includes a content hash and canonical manifest hash so offline consumers can detect record or manifest changes.

## SLO Policy

| SLO | Target | Indicator |
| --- | --- | --- |
| API availability | 99.9% over 30 days | Completed HTTP requests without a 5xx response |
| API latency | 99% at or below 750 ms over 30 days | Non-5xx completed HTTP requests within threshold |

Evaluation calculates 5-minute and 60-minute burn rates. An alert fires when the 5-minute burn is at least `14.4x`, the 60-minute burn is at least `6x`, and the 60-minute window contains requests. More than 100,000 records in the evaluation window produces `unverifiable` instead of a misleading result.

Alert changes use an expected version and fail with `409 STATE_CONFLICT` when another operator has already changed the record. Silence requires a future timestamp no more than seven days away. Automatic evaluation resolves active alerts after the burn condition recovers.

## Incident Runbook

1. Filter by `requestId`, `traceId`, operation, outcome, or error code and keep the query window as narrow as practical.
2. Inspect the sanitized log detail and reconstruct the Trace timeline. Confirm parent span continuity before attributing the failure to a dependency.
3. Compare 5-minute and 60-minute burn rates. Treat `unverifiable` as a telemetry incident, not as healthy status.
4. Acknowledge an owned alert. Silence only for a bounded investigation window and record resolution after recovery is verified.
5. Export evidence only when necessary. Store the artifact according to incident evidence policy and verify both manifest hashes before relying on it.
6. Inspect the privileged audit log for every search, detail read, Trace read, SLO read, export, evaluation, and disposition performed during the incident.

## Retention And Recovery

`ObservabilityLog` and `TraceSpan` are append-only operational facts and may be physically deleted only by the bounded retention process. Current query retention is 30 days and Trace retention is 14 days. `ObservabilityAlert` is a versioned state-transition record and is not hard-deleted by ordinary operations. Audit evidence follows its separate retention and legal-hold policy.

Telemetry persistence failures never alter an already completed HTTP response. Operators should treat a missing request completion record as a collection failure, check application error output and database health, then restore persistence before using SLO results.

## Verification

```sh
npm run test:observability-search
npm run test:data-schema-contract
npm run test:data-operation-policies
npm run test:v1-data-governance
npm run test:permission-registry
npm run test:admin-mutation-audit
npm run build
npm run check:quick
npm run check:pr
```
