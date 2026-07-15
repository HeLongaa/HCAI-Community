# Observability Contract

This contract defines the minimum telemetry expected from every MuseFlow module. The machine source is
`config/observability-contract.json` and is checked by `npm run test:observability-contract`.

## Correlation

Every request receives or generates `x-request-id`, returns it to the caller, and participates in W3C `traceparent`
propagation. Logs use `requestId`, `traceId`, and `spanId`; asynchronous work additionally carries stable job, attempt,
event, causation, and correlation identifiers. Identifiers are searchable fields, never metric labels.

Structured logs must use the common error taxonomy and stable error codes. Credentials, cookies, tokens, prompts, chat
bodies, Provider payloads, and storage URLs are forbidden. Resource identifiers may appear only in access-controlled,
retention-governed fields and must not become metric dimensions.

## Metrics

HTTP, job, and dependency boundaries use RED metrics: rate, errors, and duration. Runtime resources use USE metrics:
utilization, saturation, and errors. Business metrics record low-cardinality state transitions, reconciliation issues,
and policy blocks.

Routes are labeled by route template, never raw path. Status is labeled by class. User IDs, resource IDs, request/trace
IDs, Provider job IDs, prompts, email addresses, IP addresses, and raw error messages are forbidden labels.

## SLO And Error Budget

The initial contract defines 30-day availability, latency, async-start, and notification persistence objectives. These
targets are reviewable product objectives, not evidence that current telemetry already measures them. `OBS-BASE-01`
must implement collection and propagation; `OBS-02` must implement dashboards, multi-window burn-rate alerts, ownership,
runbooks, acknowledgement, silence, resolution, and post-incident review.

SLO exclusions must be explicit and versioned. Planned maintenance, client cancellations, policy blocks, validation
errors, and unauthenticated requests may be excluded only according to the indicator definition; dependency failures
are not automatically excluded.

## Retention And Access

Application logs, security logs, metrics, and traces use bounded retention from the machine contract. Audit evidence is
governed separately by data retention and legal hold. Operations search and export require dedicated permissions,
redaction, pagination, and audit of exports.

This contract does not enable real Provider traffic and does not add shared account or group-scoped telemetry.

## OBS-02 Search And Incident Response

`OBS-02` implements the searchable persistence and Admin workflow described by this baseline. Its bounded query, Trace reconstruction, SLO burn-rate, alert disposition, export integrity, redaction, and access-audit contract is documented in `docs/OBSERVABILITY_SEARCH_AND_TRACE.md` and verified by `npm run test:observability-search`.
