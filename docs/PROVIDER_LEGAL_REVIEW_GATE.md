# Provider Legal And Data-Processing Review Gate

Task: `LEGAL-BASE-01`

This gate records immutable engineering evidence for the legal and data-processing review of one exact Provider, model version, and deployment environment. It does not turn an engineering test, repository merge, or ordinary continuation instruction into legal approval.

## Scope And Evidence

Each `ProviderLegalReview` is append-only and contains:

- exact Provider, model version, environment, and allowed deployment regions;
- geography, DPA, retention/deletion, training-use, copyright/commercial-use, and SLA dispositions;
- bounded retention days and validity dates;
- distinct qualified-counsel and product-owner references;
- a SHA-256 reference to the externally controlled review package and a deterministic record hash.

Contract text, legal notes, personal data, URLs, Provider payloads, credentials, authorization material, and API keys are not accepted or persisted. Corrections, revocations, and renewed approvals are new sequential versions in the same scope.

## Fail-Closed Promotion

A new production promotion must bind a `legalReviewId`. The review must be the latest version for the exact Provider/model/environment scope, be approved and currently valid, and include the deployment region. Every legal gate must pass for an approved record.

The same conditions are revalidated inside the Release Control transaction immediately before traffic eligibility is enabled. A newer blocking version, expiry, future validity, or any Provider/model/environment/region mismatch blocks apply.

Historical promotions remain readable because the new association is nullable at the database layer. New promotion requests require the field.

## Human Approval Boundary

Only a qualified legal reviewer can supply a genuine counsel attestation and source evidence package. The Admin API provides the controlled recording mechanism; it must not be populated with invented evidence. Until a real current approved record exists for the intended scope, Provider traffic remains closed.

`PROVIDER-APPROVAL` remains a separate operational authorization covering Provider/model, environment, traffic, budgets, credential owner, Kill Switch owner, rollback owner, and expiry. Legal approval is necessary but not sufficient.

## Operations

- `GET /api/admin/model-control/provider-legal-reviews`
- `POST /api/admin/model-control/provider-legal-reviews`
- `GET /api/admin/model-control/provider-legal-reviews/:id`
- `GET /api/admin/model-control/provider-legal-summary`
- `GET /api/admin/model-control/provider-legal-export`

Read access uses `admin:provider-legal:read`; append access uses the protected critical permission `admin:provider-legal:manage`. Every read, export, summary, and append operation is audited with bounded metadata.

## Verification

Run `npm run test:provider-legal`, the Prisma integration test, migration tests, `npm run check:quick`, and `npm run check:pr`. These prove the software controls, not the truth of an external legal opinion.
