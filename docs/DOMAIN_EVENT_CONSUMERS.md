# Domain Event Consumers

`EVENT-02` adds a durable, personal-account-scoped consumer boundary to the transactional Outbox delivered by EVENT-01.

## Data And State

`DomainEventConsumerInbox` is an immutable receipt with a unique `(event_id, consumer_key)` identity. Mutable processing state is isolated in `DomainEventConsumption`; every execution is retained in `DomainEventConsumptionAttempt`. `DomainEventConsumerCursor` advances only in the same transaction as the registered consumer effect and successful terminal state, so a failed or dead-lettered sequence blocks later events for that consumer and aggregate.

Compensation uses an immutable `DomainEventCompensation` request, mutable state, and append-only attempts. Compensation handlers append a registered inverse/repair effect; they cannot execute arbitrary code supplied by an administrator.

## Retry And DLQ

The consumer registry fixes event version, handler, ordering, maximum attempts, and exponential retry bounds. Stable error codes only are persisted. Exhausted consumption enters `dead_lettered`. An operator with `admin:events:recover` may grant one additional attempt with a reason code. There is no skip-order action.

EVENT-02 owns event-consumer retry and DLQ only. Generic JobRun retry, Cron, job DLQ, and manual JobRun rerun remain JOB-02.

## Runtime And Administration

The internal `domain-event-pipeline` worker publishes Outbox rows into registered Inbox consumers, backfills published rows missing a receipt, processes due consumption, and executes queued compensation. The job uses the existing OperationLease and JobRun tracking.

Admin APIs expose registered consumers, filtered cursor-paginated Inbox receipts, details, dead-letter recovery, and compensation requests. Read uses `admin:events:read`; recovery uses `admin:events:recover`. Both mutations are mandatory-audited. No endpoint exposes raw handler execution, payload editing, or order skipping.

The first registered consumer appends deterministic audit evidence for `task.created.v1`; duplicate delivery and retries cannot duplicate that effect. Real Provider traffic is unrelated and remains disabled.
