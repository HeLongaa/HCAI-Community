# Notification Delivery Metrics And Channel Configuration

## Scope

NOTIFY-03 adds aggregate delivery business metrics and governed channel controls to the personal-account notification system. It does not add tenant routing, SMS, push, raw Provider payload storage, or credentials in PostgreSQL.

## Metrics

`GET /api/admin/notifications/deliveries/metrics` accepts `dateFrom`, `dateTo`, `channel`, and `notificationType`. The default window is 30 days and the maximum window is 366 days. The response contains aggregate counts, delivery and failure rates in basis points, average/P50/P95/maximum sent latency, per-channel results, and threshold breaches. Suppressed and cancelled deliveries are reported separately and are excluded from the terminal delivery-rate denominator.

`GET /api/admin/notifications/deliveries/metrics/export` emits the same aggregate-only evidence as versioned JSON or CSV. Neither route returns notification bodies, recipient identities, addresses, Provider receipts, credentials, or raw attempt payloads.

## Channel Controls

`NotificationChannelConfig` stores enablement, delivery-rate target, failure alert threshold, P95 latency target, maximum attempts, retry backoff, optimistic version, and active revision. `NotificationChannelConfigRevision` is append-only database-protected evidence. Updates and rollbacks both require `expectedVersion` and a stable reason code; rollback copies a historical revision into a new current revision.

`in_app` is the durable core notification fact and cannot be disabled or configured above one attempt. Email can be enabled or disabled by an Admin, but it is effective only when the deployment also provides a valid email webhook configuration. Webhook URL, signing secret, sender credential, and Provider response payload remain outside the channel-control tables and Admin API.

New email deliveries read the current channel switch and maximum-attempt policy. Retry scheduling reads the current channel backoff. Disabling email suppresses new email deliveries with `CHANNEL_DISABLED`; it does not rewrite queued, sent, failed, or historical delivery facts.

## Operations

Admins with `admin:notifications:read` can inspect metrics, exports, effective channel availability, and up to 100 newest revisions. `admin:notifications:manage` is required for configuration updates and rollback. Mutations are CAS-protected and domain-audited without secrets or notification content.

Run `npm run test:notification-delivery-metrics-config` for the machine contract and focused behavior suite. Run `FOUNDATION_DATABASE_URL=... npm run test:notification-delivery-metrics-config:integration` for PostgreSQL migration, aggregate SQL, concurrency, immutable revision, runtime suppression, and rollback evidence.
