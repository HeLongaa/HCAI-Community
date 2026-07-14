# Transactional Domain Events

`EVENT-01` introduces a versioned event registry and PostgreSQL transactional Outbox. `DomainEventOutbox` stores immutable event identity, type/version, aggregate, correlation/causation, idempotency key, versioned allowlisted payload, and occurrence time. `DomainEventPublication` stores the independent claim and publication state so replay never edits the event fact.

The first producer is `task.created.v1`. Task creation, point escrow, and the event are committed in one Prisma transaction. The event builder rejects unknown types, versions, missing fields, and extra payload fields. No raw prompts, Provider payloads, URLs, credentials, or unregistered extension fields are accepted.

Publishers claim due rows with compare-and-set, a bounded lease, and a unique token. A matching token is required to mark published or failed. Admin replay changes only publication state and is permission protected and audited. Consumer Inbox, retry policy, ordering, DLQ, and compensation are intentionally owned by `EVENT-02`.
