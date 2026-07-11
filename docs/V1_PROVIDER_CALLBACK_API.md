# V1 Provider Callback API

## Decision

V1-06 implements the app-side Replicate lifecycle callback boundary at
`POST /api/creative/providers/replicate/callback/:generationId`.

The route is staging-only and disabled by default. It does not register a Provider webhook target, make a Provider
request, enable the V1-05 HTTP client, download a Provider output, or approve paid/production traffic.

## Runtime Gates

The route applies side effects only when all of these are valid:

- `NODE_ENV=production`
- `CREATIVE_PROVIDER_RUNTIME_ENV=staging`
- `CREATIVE_PROVIDER_MODE=disabled` or `replicate_staging`
- `CREATIVE_STAGING_IMAGE_PROVIDER=replicate`
- `CREATIVE_STAGING_PROVIDER_CONFIRMATION=staging-only`
- `CREATIVE_PROVIDER_CALLBACK_ENABLED=true`
- `CREATIVE_PROVIDER_CALLBACK_SIGNATURE_SECRET` is a deployment secret with at least 32 characters

Provider dispatch and callback intake have independent kill switches. Callback intake can drain an already-created
staging job while new Provider dispatch remains disabled.

Optional bounds:

- `CREATIVE_PROVIDER_CALLBACK_REPLAY_WINDOW_SECONDS=300`
- `CREATIVE_PROVIDER_CALLBACK_MAX_BYTES=262144`
- `CREATIVE_PROVIDER_CALLBACK_SIDE_EFFECT_LEASE_SECONDS=60`

## Authentication And Binding

The ingress must send `application/json` and these headers:

- `x-creative-provider-timestamp`: epoch milliseconds within the configured replay window.
- `x-creative-provider-signature`: `sha256=<hex>` for HMAC SHA-256 over `<timestamp>.<exact raw body>`.
- `x-creative-provider-nonce`: `sha256=<hex>` for a domain-separated HMAC over the route generation id and durable
  Provider job id.

The nonce is not accepted as a substitute for the request signature. After signature validation, the route loads the
durable generation and requires `providerMode=replicate_staging`, an allowed Replicate provider id, and an exact
Provider job-id match before building a lifecycle replay.

## Payload Boundary

Only these top-level fields are accepted: `id`, `event_id`, `status`, `output`, `error`, `logs`, `metrics`, `cost_usd`,
`created_at`, `started_at`, and `completed_at`. Unknown fields are rejected without echoing their names or values.
Statuses are limited to `starting`, `processing`, `succeeded`, `failed`, `canceled`, and `cancelled`. Outputs are bounded
HTTPS URLs used only in memory to derive normalized output identity and fixture artifacts; raw URLs are not written to
the replay ledger, audit events, notifications, API responses, or Admin read models.

Raw callback bodies are discarded after authentication, allowlisted normalization, and hashing. Only the SHA-256
payload hash and safe lifecycle evidence may persist.

## Replay And Side Effects

Every accepted callback writes through `creative_provider_replay_ledger` before side effects run. The idempotency key
includes the safe Provider job id, normalized status, and output digest. Repository `record` handles concurrent unique
constraint races, and `claimSideEffects` performs a compare-and-set claim over the replay result.

Only the claim owner may execute or finalize the side-effect plan. Concurrent duplicates return
`duplicate_in_progress` or `duplicate_suppressed`. Completed duplicates cannot repeat media writes, credit
settlement/refund, quota commit/release, generation transitions, notifications, or lifecycle audits. Partial failures
persist completed operation keys and can resume only the missing operations.

Generated outputs still pass through media asset creation and scan governance. Callback completion does not make a
Provider URL publicly downloadable.

## Audit Contract

The route emits safe audit families:

- `creative.provider_callback.accepted`
- `creative.provider_callback.rejected`
- `creative.provider_callback.duplicate_suppressed`
- `creative.provider_lifecycle.side_effect_failed`
- existing replay-ledger and lifecycle side-effect audit events

Metadata is restricted to safe ids, status/reason enums, payload hashes, byte counts, booleans, and stable source keys.
Raw bodies, prompts, output URLs, signatures, nonce values, secrets, and full Provider errors are forbidden.

## Verification

Fixture tests cover valid signatures, malformed/missing/mismatched signatures, stale/future timestamps, content type,
body limits, strict payload projection, nonce mismatch, generation/job mismatch, accepted callbacks, duplicate terminal
callbacks, concurrent duplicate claims, partial replay recovery, output/credit/quota idempotency, safe audits, and
default-disabled runtime gates. Staging smoke validates configuration only and performs no network request.

Real Provider webhook registration remains blocked on the explicit external-call approval package and a named staging
delivery plan. Ordinary continuation language is not approval for that step.
