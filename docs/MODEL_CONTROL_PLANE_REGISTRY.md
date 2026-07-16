# Model Control Plane Registry

`MODEL-01` and `MODEL-04` establish the normalized, credential-free model catalog. The catalog is the source of truth for Provider identity, model families, immutable versions, modality capabilities, environment deployments, and additive pricing history.

## Boundaries

- The product remains personal-account only. The catalog has no tenant, organization, team, membership, or invitation ownership.
- Registry APIs do not accept Provider credentials, tokens, secret endpoint values, or raw Provider payloads. `MODEL-05` separately accepts only `secret://` metadata references.
- New deployments are always created with `trafficEligible=false`.
- This registry work does not register a real Provider adapter. Production traffic eligibility can change only through an approved `MODEL-05` promotion and is reversed by rollback.

## Lifecycle

Provider and model records use soft archival. Versions, deployments, and prices use explicit lifecycle transitions:

`draft -> active -> disabled -> active`

`active -> deprecated -> disabled -> archived`

`draft -> archived`

Skipped transitions and stale versions fail with `409`. PostgreSQL triggers enforce the same state machine and reject hard deletion outside an explicit maintenance transaction.

Model capabilities can change only while their model version is `draft`. Once activated, version parameters and capability rows are immutable. Pricing changes create a new `PricingVersion`; existing amount, unit, currency, deployment scope, and effective dates cannot be overwritten.

## Generation Evidence

`CreativeGeneration` now has nullable foreign keys to `ModelVersion`, `ModelDeployment`, and `PricingVersion`. Existing history remains readable. `AI-CORE-01` will require these references for future real-Provider generation dispatch; it must not invent associations for legacy mock records.

## Operations

The Admin model-control workbench supports credential-free list, filter, sort, pagination, detail, creation, lifecycle transitions, summary, and export. Dedicated read, manage, and transition permissions separate inspection from mutation. Every route records safe audit evidence without deployment references or credentials.

Run:

```bash
npm run test:model-control-plane
FOUNDATION_DATABASE_URL=postgresql://... node --test server/src/repositories/prismaModelControl.integration.test.js
```
