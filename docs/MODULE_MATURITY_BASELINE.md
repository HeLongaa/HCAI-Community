# Module Maturity Baseline

This document is the Phase 1 entry contract for MuseFlow. Its machine-readable source is
`config/module-maturity-baseline.json`; `npm run test:foundation-baseline` prevents the matrix, evidence, and quality
gate wiring from drifting.

## Scope

The product supports personal accounts only. This baseline does not introduce shared account containers, group
membership, invitations, or cross-account data sharing. Real Provider traffic remains disabled until the separate
`PROVIDER-APPROVAL` decision is explicitly approved.

Maturity has four meanings:

- `production_capable`: the current user and administrator paths have production-capable persistence and tests.
- `partial`: meaningful runtime behavior exists, but one or more required closure capabilities are missing.
- `contract_only`: a safe boundary or fixture exists, but the complete product path is not available.
- `planned`: no coherent end-to-end module exists yet.

## Capability Matrix

| Module | Maturity | Current user outcome | Current administrator outcome | Primary gaps |
| --- | --- | --- | --- | --- |
| Platform architecture | Partial | Unified API entry and explicit unavailable states | Release and runtime inventories | Domain dependency rules, route/query contracts |
| Admin console | Partial | No direct user surface | RBAC, review, audit, accounting, security, metrics | Reusable resource framework, bulk jobs, global search |
| User and profile | Partial | Personal profile, public page, portfolio, sessions | Limited role and audit read sides | Account lifecycle, export/deletion, full Admin management |
| Identity and access | Partial | Email/OAuth login and session revocation | Role permission editing | Permission registry, resource policy, high-risk access controls |
| Config and feature flags | Contract only | Server-owned availability | Isolated media/points policies | Versioned registry, secret references, rollout controls |
| Model control plane | Contract only | Safe model/provider metadata | Kill switch, budget evidence, circuits | Governed model catalog and explicit Provider approval |
| AI runtime | Partial | Image and Chat runtime; Video/Music fixture lifecycles | Generation inspection and governed mutations | Unified job runtime, evaluations, real Provider evidence |
| Task marketplace | Production capable | Publish through dispute lifecycle | Dispute resolution and escrow evidence | Cancellation, expiry, operational depth |
| Community | Partial | Posts, comments, likes, conversion, profiles | Generic moderation primitives | Content lifecycle, reporting, appeal, dedicated statistics |
| Media platform | Partial | Private assets, scans, downloads, lineage | Scan queue, policy rollback, alerts | Real storage/scanner rehearsal and cleanup automation |
| Entitlements and accounting | Production capable | Points, credits, quota, escrow and refunds | Policy, adjustments, reconciliation and compensation | Broader billing statistics and user detail experience |
| Notifications and webhooks | Partial | Inbox, read state and safe deep links | Limited evidence lookup | Durable delivery jobs, retry/DLQ, webhook subscriptions |
| Trust, safety and risk | Partial | Policy blocks/review and appeal entry | Security alerts and moderation queues | Unified cases, abuse rules, risk policy and statistics |
| Jobs and automation | Contract only | Partial async recovery | Lease metrics | Unified jobs, attempts, cancellation, retry, DLQ and cron UI |
| Audit and evidence | Partial | Critical flows emit evidence | Search, detail, export and redaction | Shared Admin write middleware, retention and evidence verification |
| Observability and incident response | Partial | Stable errors and explicit failure | Metrics, Prometheus and security dispositions | Trace correlation, SLOs, dashboards and incident workflow |
| Developer platform | Contract only | OpenAPI document | No API key administration | API v1 policy, keys, scopes, usage and deprecation |
| Search and discovery | Planned | Module-local filters only | No global search | Search ownership, indexing, authorization and operations |
| Support | Partial | Authenticated support requests | Basic review/audit evidence | Queue ownership, SLA, assignment and reporting |
| Compliance and data rights | Partial | Policies, consent and request entry points | Consent/support audit evidence | Legal approval, export/deletion execution and receipts |
| Platform engineering and release | Partial | Fail-closed production boundaries | Gates, smoke and rollback docs | Real infrastructure, restore rehearsal, SLO/load/canary evidence |

## Closure Contract

Every module must eventually prove all applicable parts of the same closure model:

1. User primary and failure/recovery flows.
2. Administrator list, detail, create/update action, state transition, filtering, sorting, pagination, bulk action and export.
3. Personal-resource authorization, operation permissions, field redaction and audit evidence.
4. Explicit data operation policy: mutable CRUD, state transition, soft delete, append-only, or immutable evidence.
5. Metrics, configuration and operational runbooks where applicable.
6. Unit, integration and browser acceptance evidence plus matching OpenAPI and database documentation.

The matrix records current truth, not completion claims. A module may be marked `production_capable` for its current V1
contract while still carrying follow-up tasks that expand the contract.

## Change Control

Any new module or maturity change requires the machine baseline, this document, evidence paths, gap task ownership, and
`npm run test:foundation-baseline` to change together. Maturity cannot be raised using a mock-only success path, an
unverified document, or a frontend page without a production-capable API and persistence boundary.
