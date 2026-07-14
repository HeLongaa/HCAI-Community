# ADR 001: Domain Boundaries

Status: Accepted for Phase 1 foundation work.

## Context

The application has route modules and several domain-oriented service folders, but repository access and cross-module
workflow code are still concentrated in shared files. Moving directories before ownership rules are explicit would
create churn without preventing future coupling.

## Decision

MuseFlow uses five logical layers: transport, application, domain, repository, and infrastructure. The versioned source
of truth is `config/domain-boundaries.json` and is checked by `npm run test:architecture-boundaries`.

- Transport parses protocol input, invokes application contracts, and projects responses. It owns no business policy.
- Application services orchestrate use cases, authorization, transactions, events, jobs, and audit requirements.
- Domain code contains state machines, invariants, operation policies, and value contracts without HTTP or database IO.
- Repository ports expose persistence capabilities required by an owning domain.
- Infrastructure implements database, cache, object storage, secret, Provider, and telemetry adapters.

Cross-module writes must enter the owning module's application contract. Cross-module reads use owner-authorized queries
or purpose-built redacted read models. Eventual workflows use versioned domain events once `EVENT-01` is delivered.
Direct imports of another route handler or persistence implementation are prohibited.

## Scope Boundary

Account ownership is personal. This ADR does not introduce shared account containers, group membership, invitations, or
cross-account data sharing. Real Provider dispatch remains behind `PROVIDER-APPROVAL`.

## Migration Strategy

1. Freeze ownership and dependency direction before moving files.
2. Add application contracts around existing behavior when a module is changed.
3. Split the shared repository incrementally behind ports; do not perform a repository-wide rewrite.
4. Add automated import-boundary enforcement after stable module roots exist.

## Consequences

The initial verifier proves inventory coverage and contract consistency, not full static import enforcement. This is an
intentional intermediate state: current code remains runnable while later tasks establish stable application and
repository ports.
