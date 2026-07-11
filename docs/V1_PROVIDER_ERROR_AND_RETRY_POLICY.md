# V1 Provider Error And Retry Policy

## Scope

V1-12 standardizes application-side Provider failures and bounded retry decisions. It does not register or enable a real Provider client, callback target, polling worker, probe, fallback, dispatch path, payment, withdrawal, KYC, invoice, merchant settlement, or payment refund.

## Error Contract

All Provider-facing code uses `provider-error-v1`. Durable and returned evidence is restricted to a safe code, category, redacted preview, retry/circuit flags, bounded status code, bounded `Retry-After`, operation type, accounting disposition, and public message key.

Categories are `rate_limit`, `timeout`, `provider_5xx`, `provider_incident`, `provider_rejected`, `auth_configuration`, `invalid_request`, `content_policy`, `user_cancelled`, `local_dependency`, and `unknown`.

Raw Provider bodies, headers, URLs, credentials, prompts, logs, stack traces, and full failure evidence are never persisted in retry state.

## Retry Contract

- `status_read` is idempotent and may retry within five attempts and 15 minutes.
- `output_fetch` is eligible only when the caller marks it idempotent; no real fetch client is registered.
- `dispatch_create` and mutation retries require explicit idempotency and proof that the Provider did not accept the request. They remain disabled.
- callbacks are inbound and never automatically retried by this service.
- `Retry-After` accepts seconds or an HTTP date and is capped at 900 seconds.
- fallback delay is deterministic capped exponential backoff with source-key jitter.
- user generation retry remains a separate, user-confirmed child generation and is never converted into an automatic Provider retry.

## Durable State

`CreativeProviderRetryState` stores one row per generation and operation. It tracks `scheduled`, `exhausted`, or `cleared`, the bounded attempt budget, due time, safe error code/category, delay source, policy hash, version, and only a SHA-256 failure-evidence hash.

Seed and Prisma repositories use versioned compare-and-swap updates. Duplicate failure evidence does not consume another attempt. Concurrent version conflicts are retried a bounded number of times and then fail closed.

## Polling Lifecycle

1. The polling max-age check runs first so an exhausted generation can still reach the existing terminal timeout recovery.
2. A scheduled retry before `nextAttemptAt` performs no status read.
3. An exhausted retry performs no status read and leaves the generation non-terminal.
4. A transient failed status read records the next durable retry or exhaustion state.
5. Any successful status read clears retry state before lifecycle replay.
6. Polling timeout continues through the replay ledger and existing accounting recovery.

## Operations

`GET /api/admin/creative/provider-controls` includes sanitized retry summaries for authorized operators. It omits source keys, failure hashes, policy hashes, raw errors, secrets, and account references.

Prometheus metrics use only bounded provider, workspace, operation, category, and delay-source labels:

- `newchat_creative_provider_retry_events_total`
- `newchat_creative_provider_retry_scheduled_total`
- `newchat_creative_provider_retry_exhausted_total`
- `newchat_creative_provider_retry_cleared_total`
- `newchat_creative_provider_retry_by_operation_total`
- `newchat_creative_provider_retry_by_category_total`

## Incident Procedure

1. Keep Provider dispatch and real polling disabled.
2. Inspect sanitized retry state and `creative.provider_retry.*` audit events.
3. Confirm whether exhaustion is concentrated by operation and category.
4. For `rate_limit`, verify bounded `Retry-After`; for `provider_5xx` or incidents, inspect the V1-11 circuit state.
5. Do not edit attempts or due times manually. Resolve configuration or Provider health, then allow a successful read to clear state or wait for polling timeout.
6. Any proposal to enable real Provider traffic requires the separate external-call approval package.

## Verification

```bash
npm --prefix server run db:generate
npm --prefix server test
npm run check:quick
npm run build
cd server && npx prisma validate --schema ./prisma/schema.prisma
```
