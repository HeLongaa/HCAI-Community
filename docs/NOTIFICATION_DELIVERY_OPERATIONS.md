# Notification Delivery Operations

## Scope

NOTIFY-02 adds durable delivery state for personal-account notifications. Every persisted notification records an
`in_app` delivery as sent. The optional `email` channel is queued only when the HTTP mailer adapter is explicitly
configured; otherwise it records `suppressed` with a stable unavailable or missing-recipient reason.

Webhook subscriptions and customer-managed signing keys remain owned by WEBHOOK-01. Channel configuration analytics
and threshold management remain owned by NOTIFY-03.

## State And Recovery

- Delivery uniqueness is `(notification_id, channel)` plus an idempotency key.
- Workers claim due rows using a versioned lease. Expired processing leases are recoverable.
- Attempts are preserved evidence with a single processing-to-terminal transition and bounded response class, status
  code, and stable error code only. Expired leases close their current attempt as timed out before recovery.
- Retryable timeouts, HTTP 408/425/429, 5xx, and network failures use bounded backoff before DLQ.
- Permanent failures and exhausted retries enter `dead_lettered`. Admin retry and queued cancellation require CAS and a
  stable reason code; both are audited.
- Provider message identifiers are stored only as SHA-256 receipt hashes and are never returned by APIs.

## Email Adapter

The email boundary is an HTTPS JSON webhook suitable for an approved mail relay. It sends recipient email, subject,
escaped HTML, and text. `NOTIFICATION_EMAIL_WEBHOOK_SECRET` signs the exact body with HMAC-SHA256 in
`x-notification-signature`. The endpoint URL and secret are never stored in PostgreSQL or returned by API/UI.

Required enablement order:

1. Set `NOTIFICATION_EMAIL_WEBHOOK_URL` and secret in the worker runtime.
2. Set `NOTIFICATION_EMAIL_DELIVERY_ENABLED=true`.
3. Set `NOTIFICATION_DELIVERY_WORKER_ENABLED=true` only on the dedicated worker process.
4. Verify Admin reports Email available and the worker enabled.
5. Send a test template, verify one sent attempt, then exercise retry, DLQ, cancellation, and recovery.

Without these values, Email is explicitly unavailable and no external request is made.

## Verification

Run `npm run test:notification-delivery-operations`. With PostgreSQL available, run
`npm run test:notification-delivery-operations:integration`. The full release gate remains `CI=1 npm run check:pr`.
