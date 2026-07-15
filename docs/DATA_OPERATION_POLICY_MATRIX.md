# Data Operation Policy Matrix

`config/entity-operation-policies.json` assigns every Prisma model to one owning domain and one primary mutation policy.
Run `npm run test:data-operation-policies` after any Prisma model or policy change.

## Policy Meanings

| Policy | Allowed behavior | Forbidden behavior |
| --- | --- | --- |
| Mutable CRUD | Validated owner-controlled field changes; explicit deletion where listed | Bypassing ownership, audit, or field allowlists |
| State transition | Declared transitions, compare-and-set, bounded metadata updates | Arbitrary replacement or reopening terminal history |
| Soft delete | Lifecycle state or tombstone followed by retention cleanup | Immediate user-triggered physical deletion |
| Append-only | Create a new fact or linked correction | Updating or deleting an existing fact |
| Immutable evidence | Create, expire, or supersede with another record | Editing evidence content after creation |

## Domain Summary

- Identity and profile: credentials and role assignments are controlled CRUD; sessions are state transitions; users are
  soft deleted.
- Marketplace and media: business aggregates use state machines; user removal is soft deletion; asset lineage is
  immutable evidence.
- AI runtime: generations, turns, messages, mutations, and ingestion use explicit lifecycle transitions; replay and
  deletion evidence are append-only.
- Entitlements and accounting: balance snapshots and reservation aggregates may transition atomically, while ledger
  facts, accounting operations, and movements are append-only. Corrections are linked compensation records.
- Provider control and risk: mutable state is separated from immutable cap evidence and append-only circuit events.
- Audit and security: audit and security facts are append-only; audit archive manifests are immutable evidence. Database
  triggers reject updates and deletes outside an explicit transaction-local maintenance override.
- Observability: sanitized logs and Trace spans are append-only and may be hard-deleted only by retention maintenance;
  SLO alerts use compare-and-set state transitions and preserve their versioned disposition evidence.
- Configuration: the current setting projection is mutable only through a published change; change requests use an
  explicit state machine and optimistic versions, and published revisions are immutable evidence.

## Enforcement Boundary

This task freezes the policy contract and proves complete schema coverage. `ADMIN-01`, `AUDIT-01`, and the owning domain
tasks must enforce policies at API and repository boundaries. A `state_transition` label does not permit arbitrary
updates; it requires a declared transition and idempotent or compare-and-set protection where concurrency matters.

The product remains personal-account scoped and this matrix adds no shared account container or membership model.
