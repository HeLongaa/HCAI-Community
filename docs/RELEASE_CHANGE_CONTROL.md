# Release Change Control

`RELEASE-00` defines the control plane for environment promotion, configuration releases, and Secret Manager reference rotation. It records operator intent and deployment evidence; it does not execute infrastructure commands or store secret values.

## State Policy

Every request starts in `pending_approval`. A different administrator must approve or reject it. Approved changes can record a successful or failed deployment. Deployed and failed changes can be rolled back to the required `rollbackVersion`. Every mutation uses the current row version as an optimistic concurrency condition.

`ReleaseEvidence` is append-only. Request, approval, rejection, deployment, failure, and rollback records contain a SHA-256 evidence hash, actor reference, reason code, timestamp, and safe details. Existing evidence cannot be edited or deleted through the API.

## Environment And Secret Boundaries

- Environments are `development`, `staging`, and `production`.
- Production promotion can originate only from staging.
- Every request supplies both `artifactVersion` and `rollbackVersion`.
- Secret rotation stores only `secret://` references and external version labels.
- Payload fields commonly used for plaintext secrets are rejected.
- No Provider is enabled and no external deployment or Secret Manager call is made by this module.
- Every production request is bound to one Git commit, candidate artifact SHA-256, rollback artifact SHA-256, and signed evidence bundle receipt.
- A production `deployed` outcome requires the complete six-role evidence bundle and six trusted Ed25519 public keys. Missing, expired, modified, or source-mismatched evidence fails closed.
- Raw evidence URLs and operator notes are not persisted; only bounded SHA-256 projections are retained.

The complete signing and Go/No-Go procedure is defined in `docs/PRODUCTION_RELEASE_EVIDENCE_AND_GO_NO_GO.md`.

## API And Permissions

- `admin:releases:read`: list and inspect safe release/evidence records.
- `admin:releases:manage`: request a release change.
- `admin:releases:approve`: approve or reject with requester separation.
- `admin:releases:deploy`: record deployment outcomes and rollback.

All mutations are covered by mandatory attempted-operation audit. Lists use cursor pagination and filters for status, target environment, and change type.

## Verification

Run `npm run test:production-release-evidence` and `npm run test:release-control`. Database environments must additionally deploy migration `0046_release_change_control` and run the Prisma integration suite.
