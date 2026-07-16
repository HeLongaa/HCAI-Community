# Model Route Governance

`MODEL-05` records explainable route decisions, stores only external secret references, and links model production promotion to the existing release approval lifecycle. The product remains personal-account only.

## Route Decisions

Every preview or dispatch through `resolveAndRecordModelRoute` appends a `ModelRouteDecision`. The record contains the safe policy and target attempts needed to explain the result. The raw subject key is used only during route calculation; only a domain-separated SHA-256 subject hash is persisted. PostgreSQL rejects updates and deletes.

## Secret References

`ProviderSecretRef` contains metadata and a `secret://` vault reference. APIs reject plaintext credential fields, ordinary URLs, tokens, and unsupported fields. Rotation appends a new record linked to the prior version and must preserve Provider, environment, and purpose. SecretRef records are never updated or deleted.

## Promotion

Model promotion is strictly `staging -> production`. A request links one active production route revision, production deployment, and unexpired production SecretRef to a standard `ReleaseChange`. The existing two-person approval rules remain authoritative.

Applying an approved promotion and toggling `ModelDeployment.trafficEligible` happen in the same database transaction. A successful deployment enables traffic; a failed apply or rollback disables it. Generic release endpoints use the same repository transaction, so they cannot bypass the model side effect.

Provider controls, circuits, budgets, evaluation, legal approval, and capability checks remain independent fail-closed gates. Promotion does not itself issue a Provider request.

## Operations

The Admin model-control workbench provides cursor-paginated decision, SecretRef, and promotion lists; safe detail views; immutable JSON export; SecretRef append/rotation; and promotion request creation. Release approval, application, and rollback remain in the release-control workbench.

Run:

```bash
npm run test:model-governance
FOUNDATION_DATABASE_URL=postgresql://... node --test server/src/repositories/prismaModelGovernance.integration.test.js
```
