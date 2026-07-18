# Observability Incident Response

## Scope

OBS-03 extends the OBS-02 sanitized telemetry and burn-rate alert boundary. It adds versioned SLO thresholds, named primary and secondary personal-account on-call handles, immutable response events, bounded escalation, recovery metrics, and one immutable review per resolved alert.

## SLO And On-Call Controls

- API availability and API latency remain the only supported SLO ids.
- Target, short and long burn thresholds, latency threshold, severity, owner, runbook, escalation delay, enabled state, and primary/secondary on-call handles are versioned with optimistic concurrency.
- The database stores account handles, not phone numbers, external paging credentials, or notification Provider payloads.
- Runtime defaults remain active until the first persisted control version is written. A stale update fails with `STATE_CONFLICT`.

## Alert Lifecycle

- Evaluation opens a `firing` alert only when both configured burn thresholds are exceeded.
- Operators may acknowledge, silence for at most seven days, escalate, or resolve an active alert.
- Recovery evaluation resolves an active alert with `burn_rate_recovered`; manual resolution records a bounded reason.
- Every fired, recovered, acknowledged, silenced, escalated, resolved, and reviewed event is append-only.
- Escalation increments the alert level and routes a preference-aware notification to the configured secondary on-call handle, falling back to primary when no secondary exists.

## Incident Review

A review is accepted only after resolution and only once per alert. Summary, root cause, impact, and one to twenty corrective actions are bounded. Corrective actions are stored with a canonical SHA-256 evidence hash. Reviews and alert events reject update and delete outside explicit maintenance mode.

## Metrics

The Admin dashboard reports active and critical incidents, acknowledged and silenced counts, escalation count, mean time to acknowledge, mean time to recovery, review coverage, and immutable event count. Metrics use normalized alert timestamps and never include raw logs, request bodies, tokens, prompts, or Provider payloads.

## Recovery Procedure

1. Acknowledge the firing alert and inspect its sanitized trace/log evidence.
2. Apply the linked runbook and record an escalation if primary ownership cannot recover within the configured interval.
3. Resolve only after service health is restored; automated burn-rate recovery may also close the alert.
4. Archive the incident review with concrete corrective actions.
5. Verify notification delivery operations separately when external email delivery is enabled. In-app delivery remains preference-aware and available without an external Provider.
