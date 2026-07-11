# V1 Scope And Definition Of Done

This document is the human-readable V1 release contract. `config/v1-release-scope.json` is its machine-readable companion, and `npm run test:v1-scope` prevents either side from drifting silently.

## Release Intent

V1 is the first production release of the complete MuseFlow AI Studio product: marketplace, community, accounts, internal points, notifications, governed media, Admin operations, and real-provider Image, Chat, Video, and Music studios.

V1 does not include real RMB money movement. Pricing may explain internal creative credits or future plans, but production must not expose payment, withdrawal, KYC, invoice, tax-settlement, or merchant-settlement capability.

## Included Product Domains

| Contract id | V1 outcome | Release evidence |
| --- | --- | --- |
| `auth-account` | Real OAuth, secure sessions, account settings, active-session control, export, and deletion | Auth/account E2E, security review, deletion rehearsal |
| `task-marketplace` | Publish, propose, select, deliver, revise, accept, reject, and dispute | Lifecycle E2E, permission matrix, idempotency tests |
| `community-profile` | Community, creator profile, portfolio, visibility, report, moderation, and appeal | Ownership/privacy tests and moderation E2E |
| `internal-points` | Internal points, creative credits, quota, escrow, compensation, and refund semantics | Ledger invariants, concurrency tests, reconciliation |
| `notifications` | Deduplicated notifications, read state, deep links, retries, and operations visibility | Contract and recovery tests |
| `media-governance` | Private object storage, scanner lifecycle, review, download gates, and cleanup | Storage/scanner staging evidence |
| `admin-operations` | RBAC, redacted read sides, high-risk controls, provider operations, and audit | Permission, mutation, rollback, and audit evidence |
| `image-studio` | Real text-to-image and governed image editing workflows | Approved provider staging and production gates |
| `chat-studio` | Real streaming chat, durable history, attachments, context, stop, and regenerate | Streaming/load/safety evidence |
| `video-studio` | Real asynchronous video generation, progress, cancel, retry, preview, and download | Long-job staging and cost evidence |
| `music-studio` | Real asynchronous music generation, metadata, license policy, playback, and download | Provider/legal and media evidence |
| `unified-generation-assets` | Cross-studio history, asset lineage, reuse, task delivery, and portfolio connection | Cross-module API/UI E2E |
| `legal-support` | Terms, privacy, acceptable-use policy, provider disclosures, support, report, and appeal entry points | Policy review, consent and support E2E |
| `release-operations` | Real environment, monitoring, load, security, UAT, canary, rollback, and hypercare | Release evidence index and go/no-go record |

## Explicitly Excluded Capabilities

The following contract ids are release blockers if implemented or advertised as available:

- `rmb-payment`: RMB checkout, card, Alipay, WeChat Pay, merchant acquiring, or payment intent APIs.
- `withdrawal-payout`: creator withdrawal, bank payout, or payout-provider integration.
- `kyc`: identity verification required for money movement.
- `invoice-tax-settlement`: invoices, tax settlement, or merchant settlement.

Internal points, creative credits, quota, escrow, compensation, and generation refunds are product ledger semantics. They must never be represented as withdrawable currency or provider billing.

## Product Definition Of Done

Every included domain is done only when all of the following are true:

1. The primary user flow and material non-happy paths are implemented against production-capable APIs.
2. Authentication, authorization, ownership, idempotency, audit, redaction, and rate limits are tested where applicable.
3. Loading, empty, offline, timeout, denied, failed, review, and recovery states are usable.
4. Mobile, keyboard, screen-reader, Chinese, and English acceptance criteria are satisfied.
5. OpenAPI, generated clients, runtime contracts, documentation, and Notion evidence agree.
6. Production uses a real data source or an explicit unavailable state; it never silently falls back to demo or mock content.

## Creative Provider Definition Of Done

Image, Chat, Video, and Music each require:

1. An approved primary provider and documented replacement path.
2. An explicit model/parameter/cost/license/data-retention contract.
3. Default-disabled credentials and a fail-closed production registration boundary.
4. Create, status, cancel, retry, failure recovery, moderation, persistence, and private-download behavior as applicable.
5. Usage, price snapshot, quota/credit handling, budget caps, kill switch, metrics, alerts, and Admin visibility.
6. Real staging evidence followed by a separate production go/no-go decision.

The current conditional primary/backup choices, public-price budget envelope, contract blockers, data/SLA dispositions,
and replacement triggers are frozen in `docs/V1_PROVIDER_DECISION_MATRIX.md` and
`config/v1-provider-matrix.json`. That decision record authorizes implementation planning only.

The four-modality prohibited/block/review/allow taxonomy, Provider policy mapping, pre-dispatch through appeal
responsibility chain, user message codes, and safety audit contract are frozen in
`docs/V1_CONTENT_SAFETY_POLICY_MATRIX.md` and `config/v1-content-safety-policy.json`. Runtime enforcement remains
incomplete until the downstream V1-59 through V1-63 implementation tasks pass their own release evidence.

The complete data asset inventory, five-level classification, bounded retention, allowed/forbidden flows,
external-processor mapping, export/deletion targets, legal-hold rules, and secondary-surface redaction contract are
frozen in `docs/V1_DATA_GOVERNANCE_BASELINE.md` and `config/v1-data-governance.json`. Account rights automation,
Provider deletion receipts, and backup expiry/restore deletion evidence remain downstream release work.

Ordinary continuation language is not approval for a paid provider call. The exact provider, environment, maximum calls, app/provider budget, expiry, token owner, kill-switch owner, and rollback owner must be approved first.

## Technical Definition Of Done

- PostgreSQL migrations, connection pool, backup, restore, and rollback are rehearsed.
- Object storage, CDN/private download, scanner request/callback, and lifecycle cleanup are verified.
- Redis-backed shared limits, independent workers, leases, failover, and rolling deployment are verified.
- OAuth, TLS, CORS, cookies, CSP/headers, secrets, and rotation pass the real environment gate.
- Metrics, dashboards, alerts, client/server errors, queue health, provider cost, and on-call delivery are observable.
- SLO, capacity, RTO, and RPO targets pass load, soak, and failure-injection tests.

## Quality And Release Definition Of Done

The release requires all manifest quality gates, no unaccepted P0/P1 defects, complete UAT, a production-like staging rehearsal, canary thresholds, tested rollback, and completed hypercare. Evidence must be linked from the matching Notion task.

Run the local contract with:

```bash
npm run test:v1-scope
npm run test:v1-safety-policy
npm run test:v1-data-governance
```

Run the complete safe deployment gate with:

```bash
npm run check:deploy
```

`npm run check:deploy:env` remains mandatory in the managed target environment and must not print secrets.

## Change Control

Changes to included or excluded scope require all of:

1. Update this document and `config/v1-release-scope.json` in the same pull request.
2. Update the V1 roadmap and affected Notion tasks.
3. Record effects on effort, Provider/legal dependencies, quality gates, and release risk.
4. Pass `npm run test:v1-scope` and the normal pull-request gate.
