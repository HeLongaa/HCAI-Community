# Webhook Subscriptions And Delivery

## Scope

WEBHOOK-01 provides outbound domain-event webhooks for personal accounts. It does not introduce tenants, teams, organizations, memberships, invitations, repository access, or Provider callback behavior. The initial allowlist is generated from `config/domain-event-registry.json`; the first supported event is `task.created.v1`.

The feature is default-disabled. An administrator with `admin:webhooks:manage` must mount webhook-secret encryption keys and explicitly enable `WebhookControl` before a user can create a subscription. Disabling the global control or an individual subscription cancels queued, retry-scheduled, and claimed delivery work without deleting evidence.

## Subscription Contract

Authenticated personal accounts can create, list, update, enable, disable, soft-delete, and rotate signing secrets for their own subscriptions. Names are unique per owner. Endpoint, event list, retry limit, status, and version are durable; every configuration or state change uses optimistic concurrency and a bounded reason code.

Production endpoints must use HTTPS and cannot contain URL credentials or fragments. Literal private, loopback, link-local, multicast, and unspecified addresses are rejected. Delivery resolves every target before connection, rejects any prohibited result, pins the accepted address for the request, and does not follow redirects. Non-production may target loopback HTTP for local tests.

Signing secrets are random `whsec_` values returned only on creation or rotation. PostgreSQL stores a SHA-256 fingerprint, a display hint, and AES-256-GCM ciphertext. APIs, Admin projections, audit metadata, logs, metrics, and exports never return ciphertext, hashes, encryption metadata, or plaintext. Rotation retires the previous secret for already-pinned deliveries and uses the replacement for new or manually replayed delivery.

Configure one current 32-byte key:

```bash
WEBHOOK_SECRET_ENCRYPTION_KEY=<base64-encoded-32-byte-key>
WEBHOOK_SECRET_ENCRYPTION_ACTIVE_KEY_ID=v1
```

For encryption-key rotation, mount all retained keys and select the current writer:

```bash
WEBHOOK_SECRET_ENCRYPTION_KEYS=v1:<old-base64-key>,v2:<current-base64-key>
WEBHOOK_SECRET_ENCRYPTION_ACTIVE_KEY_ID=v2
```

Do not remove an old encryption key while any retained signing secret or delivery references it.

## Delivery Envelope

Each delivery uses `POST` with `Content-Type: application/json`. The controlled envelope contains:

```json
{
  "id": "delivery-id",
  "type": "task.created",
  "version": 1,
  "occurredAt": "2026-07-19T00:00:00.000Z",
  "data": {},
  "metadata": {
    "eventId": "event-id",
    "aggregateType": "task",
    "aggregateId": "task-id",
    "aggregateSequence": 1,
    "correlationId": "correlation-id"
  }
}
```

The sender includes:

- `X-MuseFlow-Delivery`: stable delivery id and outbound idempotency key.
- `X-MuseFlow-Event`: event type without the version suffix.
- `X-MuseFlow-Event-Version`: integer event version.
- `X-MuseFlow-Attempt`: durable attempt number.
- `X-MuseFlow-Timestamp`: Unix seconds used by the signature.
- `X-MuseFlow-Signature`: `v1=` plus the hexadecimal HMAC-SHA256 of `<timestamp>.<exact-body>`.
- `Idempotency-Key`: the stable delivery id.

Receivers should reject stale timestamps, compute the HMAC over the exact bytes received, compare signatures in constant time, and deduplicate by delivery id.

## Retry And DLQ

`2xx` completes a delivery. `408`, `409`, `425`, `429`, `5xx`, timeouts, and network failures are retryable. Other `4xx` responses are permanent failures. Retry uses deterministic jittered exponential backoff from the Admin-configured base, respects a bounded `Retry-After`, and caps delay at one hour. A unique subscription/event constraint and lease-token CAS prevent duplicate durable delivery records and competing workers from completing the same attempt.

Exhausted or permanent failures enter `dead_lettered`. The owner or an administrator can replay only a dead-lettered delivery belonging to an active subscription. Replay requires the current delivery version, a reason code, and a durable idempotency key. It appends `WebhookDeliveryReplay` evidence, pins the current signing secret, and grants a fresh bounded attempt window without removing prior attempts.

## Operations

Run delivery only in the dedicated worker deployment:

```bash
WEBHOOK_DELIVERY_WORKER_ENABLED=true
WEBHOOK_DELIVERY_WORKER_INTERVAL_SECONDS=10
WEBHOOK_DELIVERY_WORKER_BATCH_SIZE=25
WEBHOOK_DELIVERY_LEASE_SECONDS=60
npm --prefix server run worker
```

The Admin surface exposes the global kill switch and bounded limits, subscription search and emergency disable, delivery status and attempts, DLQ replay, and aggregate metrics. It never displays a raw signing or encryption secret.

Verification:

```bash
npm run test:webhooks
FOUNDATION_DATABASE_URL=<postgres-url> npm run test:webhooks:integration
```

Before production enablement, verify a real HTTPS receiver accepts a valid signature, rejects a modified body and stale timestamp, deduplicates repeated delivery ids, returns representative retryable and permanent responses, and observes global/subscription kill switches.
