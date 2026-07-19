# V1 Compliance And Support Baseline

Task: V1-78
Policy set: `v1-legal-support-2026-07-11`
Status: engineering draft pending qualified legal review

This baseline replaces the former Terms and Privacy placeholders with a versioned product contract, affirmative consent records, and user-visible support and data-rights entry points. It does not claim that the policy text has received legal approval or that downstream export, deletion, or appeal work has completed.

## Release Gate

The machine-readable source of truth is `config/v1-compliance-policy.json`.

- `legalApproved`, `policyPublicationApproved`, and `productionLaunchAllowed` remain `false`.
- The final legal entity, jurisdiction, consumer terms, age rules, governing law, liability language, complaint authorities, and notice periods must be approved before publication.
- Ordinary continuation, a Codex "continue" instruction, passing tests, or merging this engineering task cannot substitute for legal approval.
- Real or paid Provider traffic remains separately blocked by the Provider approval gate.

## Policy Inventory

| Policy | Route | Version | Consent |
| --- | --- | --- | --- |
| Terms of Service | `terms` | `1.0.0-draft.1` | Required |
| Privacy Policy | `privacy` | `1.0.0-draft.1` | Required |
| Acceptable Use Policy | `aup` | `1.0.0-draft.1` | Required |
| AI Provider and Generated Content Disclosure | `disclosures` | `1.0.0-draft.1` | Required |
| Support and User Rights Policy | `support` | `1.0.0-draft.1` | Notice only |

The Terms cover accounts, all four creative modalities, user content, generated output, Provider processing, the task marketplace, community behavior, internal points, creative credits, quotas, escrow, enforcement, and material changes. They explicitly exclude real-money payment, withdrawal, KYC, invoicing, banking, and merchant settlement from V1.

The Privacy Policy maps the data classes and retention rules frozen by V1-45, exposes user-rights entry points, and states that the V1-67 export/deletion orchestrators are still required. The AUP presents the V1-44 safety contract in user-facing language. The Provider disclosure identifies all eight primary/backup candidates and keeps every production approval flag false.

## Consent Contract

`POST /api/auth/register` requires an affirmative `policyConsent` object containing the exact current versions. A missing acknowledgement fails with `POLICY_CONSENT_REQUIRED`; stale or partial versions fail with `POLICY_VERSION_MISMATCH` and return the required versions.

OAuth and existing accounts receive their consent state from `GET /api/me`. The frontend presents a non-dismissible first-authenticated-use gate until the current required versions are accepted or the user signs out. `POST /api/compliance/consent` records the acceptance.

Consent evidence is an immutable `AuditEvent`:

- action: `compliance.policy_consent.recorded`
- resource type: `policy_consent`
- actor/resource: current user
- allowlisted metadata: policy-set version, exact policy versions, timestamp, source, and locale

No IP address, user agent, token, password, raw content, or private URL is added to the consent event. A material required-policy version change makes the prior record non-current and requires a new affirmative record.

## Support Contract

Authenticated users can create and track six request categories through `/support` and `/api/support/requests`:

| Category | Initial target | Downstream owner |
| --- | --- | --- |
| General support | 2 business days | V1-78 |
| Content report | 1 business day | V1-63 |
| Moderation appeal | 5 business days | V1-63 |
| Privacy request | 30 calendar days | V1-67 |
| Data export | 30 calendar days | V1-67 |
| Account deletion | 30 calendar days | V1-67 |

Targets are operational goals, not guaranteed resolution times. Each request is stored as an owner-scoped `SupportTicket` and receives a stable tracking id, dedicated message history, assignment state, and first-response/resolution deadlines. Reports and appeals remain Trust & Safety cases; `AdminReview` is not reused for support. Allowlisted audit events store category, state, SLA, and stable resource references, but not free-form request or message bodies.

The request parser rejects credential-like content including Authorization headers, bearer tokens, API keys, passwords, private signed URL signatures, and secret query parameters. Users are instructed not to submit payment data, government identifiers, raw Provider payloads, or unnecessary sensitive media.

## API Surface

- `GET /api/compliance/policies`: public policy manifest and explicit release status.
- `GET /api/compliance/consent`: current-user consent status.
- `POST /api/compliance/consent`: exact-version affirmative consent.
- `GET /api/support/requests`: owner-scoped request history.
- `POST /api/support/requests`: validated request creation.
- `GET /api/support/requests/:id`: owner-scoped request detail.

The OpenAPI inventory and protected-route permission matrix include every route. The public manifest never exposes a secret or credential.

## Implementation Boundaries

- V1-48 owns final production OAuth return behavior and real identity-provider validation.
- V1-63 owns human moderation review, appeal adjudication, notifications, and audit closure.
- V1-67 owns recent-authentication checks, identity verification, export package creation, account deletion, anonymization, Provider deletion propagation, and per-store evidence.
- V1-73 owns final application-security, privacy, legal-policy, and supply-chain review.

A submitted export, deletion, privacy, report, or appeal request is only an accepted handoff. The UI and API do not claim that the requested operation is complete.

## Verification

Run:

```bash
npm run test:v1-compliance
npm run test:contracts
npm --prefix server test
npm run test:e2e
npm run check:deploy
```

`scripts/verify-v1-compliance-policy.mjs` checks policy ids, localized sections, versions, consent requirements, release blockers, Provider disclosures, support categories, routes, OpenAPI, frontend entry points, data-governance ownership, documentation, and quality-gate wiring.
