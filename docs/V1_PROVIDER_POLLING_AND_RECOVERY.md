# V1 Provider Polling And Recovery

Task: V1-07

## Decision

V1-07 implements the app-side Replicate status polling and timeout recovery boundary for the dedicated worker.
The worker can construct a fixed-destination, read-only status client only when every staging gate is explicitly
enabled. All switches remain false by default.

This task does not register the staging Provider on the product generation route, create a Provider job, execute a
real Provider request during implementation or verification, approve paid traffic, or enable production Provider
traffic.

## Runtime Gates

Status polling requires all of these values:

- `NODE_ENV=production`
- `CREATIVE_PROVIDER_RUNTIME_ENV=staging`
- `CREATIVE_PROVIDER_MODE=replicate_staging`
- `CREATIVE_STAGING_IMAGE_PROVIDER=replicate`
- `CREATIVE_STAGING_PROVIDER_CONFIRMATION=staging-only`
- `CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED=true`
- `CREATIVE_PROVIDER_POLLING_ENABLED=true`
- `CREATIVE_PROVIDER_POLLING_WORKER_ENABLED=true`

`CREATIVE_PROVIDER_POLLING_WORKER_ENABLED=true` is invalid unless the lifecycle polling switch is also true.
Callback intake, Provider dispatch, lifecycle polling, and worker startup retain separate gates. Production smoke
requires polling and the polling worker to remain disabled.

Optional bounds:

- `CREATIVE_PROVIDER_POLLING_MAX_AGE_SECONDS=3600`
- `CREATIVE_PROVIDER_POLLING_LEASE_TTL_SECONDS=300`
- `CREATIVE_PROVIDER_POLLING_INTERVAL_SECONDS=60`
- `CREATIVE_PROVIDER_POLLING_SWEEP_LIMIT=10`
- `CREATIVE_PROVIDER_POLLING_REQUIRE_CREDIT_RESERVATION=false`

The polling interval must remain lower than the maximum polling age.

## Read-Only Status Client

The dedicated worker receives a client exposing only `getPrediction`. It cannot dispatch a prediction through that
reference. Status reads use the fixed Replicate destination `GET /v1/predictions/:providerJobId`, a bounded request
timeout, a bounded response body, deployment-secret authorization, and a provider-job-id allowlist. Path or query
injection is rejected before `fetch`.

Provider responses are projected in memory to lifecycle fields only: id, status, outputs, bounded error/log fields,
bounded metrics, lifecycle timestamps, and optional cost. Provider input, prompt, webhook, URL-control, model-version,
and other response fields are discarded before lifecycle mapping. Invalid status, output, metric, identifier, or
timestamp values fail closed with a generic response error.

The raw response body, Provider input, full Provider error, authorization header, secret, and Provider control URLs
are never persisted, audited, returned by an API, or included in worker results.

## Candidate And Lease Contract

Only durable `queued` and `running` Replicate staging generations are candidates. Repository queries filter by status,
Provider id, and Provider mode, then return the oldest candidates first under a configured per-sweep cap. Terminal,
missing, future-dated, mismatched, unsupported, or unsafe-job-id records never trigger a status request.

The recurring worker uses the existing cross-instance operation lease. Replay side effects also use the durable
Provider replay ledger and its compare-and-set side-effect claim, so worker overlap and duplicate status events cannot
repeat media, credit, quota, notification, audit, or generation mutations. Repeated non-terminal snapshots use a
stable lifecycle idempotency key even when safe Provider metadata changes between reads.

## Retry And Timeout Contract

Rate limits, request timeouts, and retryable upstream failures produce a safe `retry_scheduled` outcome backed by
`CreativeProviderRetryState`. The worker skips the generation until `nextAttemptAt`, deduplicates repeated failure
evidence by hash, and consumes a versioned attempt budget. Exhaustion stops further status reads but leaves the
generation non-terminal so the existing polling max-age policy remains the single timeout closeout. A single job
mismatch or unexpected failure cannot abort the full sweep.

Any successful status read clears the durable retry state before lifecycle replay. The HTTP client projects a bounded
`Retry-After` value but never performs an internal retry. V1-12 details the shared taxonomy and operational procedure
in `docs/V1_PROVIDER_ERROR_AND_RETRY_POLICY.md`.

Once a non-terminal generation exceeds `CREATIVE_PROVIDER_POLLING_MAX_AGE_SECONDS`, the worker does not make another
status request. It writes a stable polling-timeout replay, transitions the generation to `failed` with
`PROVIDER_TIMEOUT`, refunds reserved creative credits, releases reserved quota, and records the result once. Repeated
timeout handling is a replay-ledger duplicate and cannot repeat accounting side effects. If a required accounting or
generation mutation fails transiently, the generation remains pollable and the next sweep resumes only the unfinished
replay-ledger operations.

Non-retryable status-read failures remain non-terminal until the bounded timeout policy closes the generation. They do
not synthesize Provider lifecycle content or mutate accounting early.

## Safe Worker Results And Audits

Worker summaries contain only safe generation/job identifiers, normalized statuses, hashes, counts, booleans, and
low-cardinality failure codes. They exclude normalized generation objects because those objects may contain prompts or
Provider output URLs.

V1-07 adds these source-keyed audit actions:

- `creative.provider_polling.status_fetched`
- `creative.provider_polling.retry_scheduled`
- `creative.provider_polling.timed_out`
- `creative.provider_polling.rejected`

V1-12 also records `creative.provider_retry.scheduled`, `creative.provider_retry.exhausted`, and
`creative.provider_retry.cleared`. Audit metadata is restricted to safe ids, status/reason/error codes and categories,
attempt counts, due times, delay source, payload hashes, HTTP status codes, and booleans.
Raw Provider errors, prompts, response bodies, output URLs, and secrets are ignored even if a caller supplies them.

## Verification And External Boundary

Tests cover fixed status destinations, path injection, response projection, secret isolation, disabled defaults,
runtime gate combinations, oldest-first candidates, missing clients, unsafe job ids, running/completed/failed/cancelled
status mapping, retry scheduling, timeout accounting recovery, duplicate timeout suppression, per-generation failure
isolation, changing non-terminal snapshot dedupe, partial timeout recovery, safe audits, replay idempotency, and
worker-result redaction.

The `polling-worker` staging smoke mode validates configuration and safe metadata only. It does not construct a Provider
job or call Replicate. A real status read still requires the explicit external-call approval package to name the
Provider, environment, call count, spend cap, expiry, credential owner, and rollback owner. Ordinary continuation
language is not that approval.
