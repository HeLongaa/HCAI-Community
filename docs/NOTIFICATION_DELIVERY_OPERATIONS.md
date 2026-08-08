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

Production refuses to enable this channel unless the webhook secret contains at least 32 characters, a syntactically
valid `NOTIFICATION_EMAIL_FROM` address is configured, and Provider receipts are required. Production webhook URLs
cannot contain credentials, fragments, or query parameters. A successful HTTP response must include `x-message-id` or
`x-request-id`; the application stores only its SHA-256. A `2xx` response without that receipt is dead-lettered as
`PROVIDER_RECEIPT_MISSING` and is not automatically retried, because the relay may already have accepted the message.

Required enablement order:

1. Set `NOTIFICATION_EMAIL_WEBHOOK_URL` and secret in the worker runtime.
2. Set `NOTIFICATION_EMAIL_DELIVERY_ENABLED=true`.
3. Set `NOTIFICATION_EMAIL_FROM` and keep `NOTIFICATION_EMAIL_REQUIRE_PROVIDER_RECEIPT=true` in production.
4. Set `NOTIFICATION_DELIVERY_WORKER_ENABLED=true` only on the dedicated worker process.
5. Verify Admin reports Email available and the worker enabled.
6. Send a test template, verify one sent attempt with a receipt hash, then exercise retry, DLQ, cancellation, and recovery.

Without these values, Email is explicitly unavailable and no external request is made.

## Staging Relay Acceptance

Before enabling production traffic, run `npm run notification-email:preflight` and then execute the controlled canary
with `npm run notification-email:rehearse`. Execution requires an exact Staging confirmation, a clean Git commit, a
bound release artifact SHA-256, a dedicated test recipient, and the production signing, sender, and receipt controls.
The resulting evidence contains only hashed relay and email-domain identities, a hashed Provider receipt, and the
source/artifact binding; it must be checked independently with
`node scripts/verify-notification-email-staging-evidence.mjs <evidence.json>`.

This acceptance proves only that the configured Staging relay returned a success response with a traceable Provider
receipt. It does not prove mailbox delivery, bounce handling, complaint handling, or approval for production. Final
mailbox delivery and the relay's bounce and complaint lifecycle require separate Provider and mailbox evidence.

## Verification

Run `npm run test:notification-delivery-operations` and `npm run test:notification-email-staging`. With PostgreSQL available, run
`npm run test:notification-delivery-operations:integration`. The full release gate remains `CI=1 npm run check:pr`.
