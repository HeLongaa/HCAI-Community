# Quality Gates

## Release Infrastructure Rehearsal

RELEASE-01 contract and evidence controls must pass `npm run test:release-infrastructure`. The local integration command
`npm run release:infrastructure:rehearse` then proves all Prisma migrations, permission seeds, custom-format PostgreSQL
backup through S3, checksum-bound restore into a separate database, Redis AOF recovery across a real service restart,
and primary/backup object deletion recovery. Sanitized evidence is bounded, recursively secret-free, SHA-256 receipt
bound, and evaluated against the RTO/RPO targets in `config/release-infrastructure-rehearsal-contract.json`.

Local Docker evidence does not complete production release readiness. The protected target environment must first pass
`npm run release:infrastructure:preflight`, then `npm run release:infrastructure:rehearse:env` against dedicated resources
whose database names include `rehearsal`. See `docs/RELEASE_INFRASTRUCTURE_REHEARSAL.md`.

## Music Production UX Acceptance

AI-MUSIC-02 engineering acceptance is defined by `config/music-production-ux-acceptance.json` and
`docs/V1_MUSIC_PRODUCTION_ACCEPTANCE.md`. `npm run test:music-production-ux-acceptance` proves the fixed 48 kHz/192 kbps
MP3 quality profile, rights and license gates, private clean playback/download, bounded fixture latency and spend,
fail-closed rollback without Lyria or Mock fallback, and 390x844 keyboard/mobile accessibility. Production remains
`no_go` pending AI-MUSIC-01 credentialed acceptance and scoped legal approval evidence.

## Video Production UX Acceptance

AI-VIDEO-02 engineering acceptance is defined by `config/video-production-ux-acceptance.json` and
`docs/V1_VIDEO_PRODUCTION_ACCEPTANCE.md`. `npm run test:video-production-ux-acceptance` proves bounded fixture latency,
duration/output/spend limits, private preview and clean download, lifecycle failure recovery, staging rollback without
automatic fallback, and 390x844 keyboard/mobile accessibility. Production remains `no_go` pending AI-VIDEO-01
credentialed acceptance and scoped approval evidence.

## Image Production UX Acceptance

AI-IMG-02 engineering acceptance is defined by `config/image-production-ux-acceptance.json` and
`docs/V1_IMAGE_PRODUCTION_ACCEPTANCE.md`. `npm run test:image-production-ux-acceptance` proves closed quality and limit
mapping, budget fail-closed behavior, concurrent duplicate suppression and recovery, staging rollback without Mock
fallback, and 390x844 keyboard/mobile accessibility. Production remains `no_go` pending AI-IMG-01 credentialed
acceptance and scoped approval evidence.

## Chat Production UX Acceptance

AI-CHAT-02 engineering acceptance is defined by `config/chat-production-ux-acceptance.json` and
`docs/V1_CHAT_PRODUCTION_ACCEPTANCE.md`. `npm run test:chat-production-ux-acceptance` proves the 100-message fail-closed
boundary before Provider dispatch, 20 isolated concurrent fixture conversations with accounting closure, explicit
`openai_staging -> disabled` rollback without Mock fallback, and 390x844 keyboard/mobile accessibility. The contract
remains `no_go` until AI-CHAT-01 Provider approval and real acceptance evidence are complete.

## Unified Generation Center

V1-35 adds an owner-scoped safe projection across Image, Chat, Video, and Music generation records. Quality gates require workspace/status/date filters, stable newest-first cursor pagination, cross-user denial, Provider/private metadata exclusion, server-derived action eligibility, protected Chat summaries, governed output handling, offline/loading/error/empty recovery, workspace deep links, and desktop/mobile keyboard-accessible UI. The focused API and Playwright suites are documented in `docs/V1_UNIFIED_GENERATION_CENTER.md`; the feature must also pass the complete PR and production smoke gates.

This document defines the productization quality gates used before local handoff, pull request review, and deployment.

## Local Quick Check

Run:

```bash
npm run check:quick
```

Includes:

- `npm run lint`
- `npm run test:data-schema-contract`
- `npm run test:permission-registry`
- `npm run test:resource-authorization`
- `npm run test:admin-mutation-audit`
- `npm run test:domain-events`
- `npm run test:job-runtime`
- `npm run test:v1-scope`
- `npm run test:v1-surfaces`
- `npm run test:v1-providers`
- `npm run test:v1-safety-policy`
- `npm run test:v1-data-governance`
- `npm run test:v1-compliance`
- `npm run test:v1-image-staging`
- `npm run test:v1-video-staging`
- `npm run test:sim`
- `npm run test:release-infrastructure`
- API contract drift check through `scripts/verify-api-contracts.mjs`

The V1 scope contract checks the frozen included domains, all four required real-provider modalities, explicit
real-money exclusions, evidence paths, fail-closed Provider policy, and the absence of payment/withdrawal/KYC/invoice
runtime routes or Prisma models.

The V1 runtime-surface contract checks the exact frontend `mockData` import set, visible fallback labels, server
seed/mock/fixture boundaries, production dispositions, and downstream V1 owners. It deliberately reports the current
release blockers; V1-39 may claim runtime-surface readiness only when the disposition matrix has zero blockers and the production bundle/negative persistence guards pass.

The V1 provider-decision contract checks the four primary/backup pairs, official-source register, pricing examples,
budget sums, app concurrency and lifecycle bounds, rights/training/retention/region/SLA dispositions, replacement
triggers, and fail-closed approval rules. It rejects any drift that would imply real-call or production approval.

The V1 content-safety contract checks the prohibited/block/review/allow partition for all four modalities, 20 risk
categories, the five-stage responsibility chain, all eight Provider policy mappings, official policy sources, region
behavior, user messages, review/appeal rules, audit allowlists, sensitive-field exclusions, and downstream task owners.
It deliberately records that runtime enforcement is incomplete and rejects any drift that implies production approval.

The V1 data-governance contract checks every Prisma model and non-Prisma data asset, classification, purpose, retention
limit, allowed/forbidden flow, export/delete target, legal-hold rule, external processor, secondary-surface redaction,
and downstream implementation owner. It records that export/deletion automation and backup rehearsal are incomplete.

The V1 compliance contract checks five bilingual versioned policies, exact-version affirmative consent, registration
and first-use capture, all eight Provider disclosures, six support/data-rights categories, owner-scoped APIs, OpenAPI,
frontend entry points, audit allowlists, and downstream owners. It deliberately fails if the engineering draft claims
legal approval or production publication readiness.

The V1 Video staging contract validates 13 fixture-only scenarios with concrete evidence markers, executes the selected
request/input/lifecycle/accounting/release/operations tests, and fails if a default network client, Provider credential,
real-call approval, automatic failover, or production enablement is implied.

The Music capability contract freezes instrumental and lyrics-to-song request shapes, Provider mode projections,
three-minute MP3 output, rights/license gates, application lifecycle, and budget limits. `npm run
test:music-elevenlabs-readiness` covers closed request mapping, official Music v2 HTTP shape, bounded MP3 validation,
safe failures, generated-minute costs, staging license evidence, private ingestion, scanning, and accounting. Use
`npm run music:elevenlabs:preflight` before any deployment and `npm run music:elevenlabs:acceptance` only with the
short-lived one-call approval envelope. Reference audio, remix, voice/TTS, Lyria failover, and production remain disabled.

Use this before handing off small frontend, contract, or documentation changes.

For migration or repository changes in EVENT-01/JOB-01, also run the opt-in real PostgreSQL gate after `0043_domain_events_and_job_runs` is deployed:

```bash
FOUNDATION_DATABASE_URL="$DATABASE_URL" npm run test:events-jobs-integration
```

This verifies Task/Outbox atomic commit and rollback, event and job claim competition, immutable replay, foreign/late lease rejection, sensitive job input/result redaction, cooperative cancellation, and timeout sweeping. The test skips when `FOUNDATION_DATABASE_URL` is absent so the ordinary fixture gate never guesses a database target.

For CONFIG-02 or SET-02 schema and repository changes, deploy the complete migration chain through `0052_feature_flag_rollout`, then run:

```bash
FOUNDATION_DATABASE_URL="$DATABASE_URL" npm run test:config-resource-domains:integration
```

This verifies concurrent publication, audit rollback atomicity, immutable revisions, independent published projections, mirrored soft deletion, restore, versioned rollback, rollout projection persistence, and emergency override concurrency. The test skips when `FOUNDATION_DATABASE_URL` is absent.

Run the SET-02 contract and runtime gate for targeting-rule limits, deterministic evaluation, permission isolation, preview, and immediate shutdown:

```bash
npm run test:feature-flag-rollout
```

## Pull Request Check

Run:

```bash
npm run check:pr
```

Includes:

- Local quick check
- production frontend build
- backend Node test suite
- Prisma schema validation
- Playwright E2E workflow checks

Use this before merging productization work into the main branch.

## Deployment Check

Run the safe fixture profile in CI:

```bash
npm run check:deploy
```

Run the real environment profile in the deployment environment:

```bash
npm run check:deploy:env
```

Includes:

- Pull request check
- production smoke profile
- managed auth secret validation
- S3 object storage configuration validation
- webhook media scanner request/callback validation
- media/security alert channel validation
- secure cookie and trusted origin validation
- guard rail validation for rate limits, request body limits, and auth failure monitoring
- Prometheus-compatible metrics exporter configuration validation
- worker topology and lease renewal sanity checks
- Chat message encryption configuration and the inactivity-retention worker required to enforce the 365-day lifecycle
- Chat selected-context and 512-character output safety buffering; Provider, classifier, and attachment-byte code is
  implemented but every Chat network/runtime switch remains off in production smoke, and tools remain unavailable
- Video capability version, Veo/Runway model decision, closed modes/parameters, governed input bytes/lineage,
  safe operation persistence, generated-second pricing, strict fixture lifecycle/replay, bounded MP4 ingestion,
  scanner isolation and terminal accounting; the Video UI consumes application capability/history/mutation/media APIs,
  preserves ordered image/audio roles, polls only application generation detail, gates private preview on clean MP4, and
  labels Mock/fixture/unavailable runtimes; the V1-29 matrix executes 13 request, lifecycle, accounting, release, failure,
  operations, and rollback scenarios, while adapter product registration, HTTP, lifecycle runtime, real calls,
  production, and failover remain disabled
- Music capability version, guarded ElevenLabs staging and disabled Lyria Preview decisions, instrumental and lyrics-to-song
  modes, three-minute private MP3 output, rights/license metadata, application lifecycle, and USD budget limits; the
  ElevenLabs adapter validates requests, bounded MP3 bytes, safe errors, generated-minute cost, and license evidence;
  the application acceptance persists owner-scoped private MP3 assets with scan gating and durable cost closeout
  while Music Studio consumes only application capability/history/mutation/media APIs and gates private MP3 playback;
  all staging HTTP/credential/rights gates are disabled by default, and voice/TTS adjacency, production, and failover remain unavailable
- external OAuth provider metadata validation
- OAuth hardening validation: `npm run test:oauth-hardening` proves production fail-closed behavior, hashed single-use
  state, PKCE, bounded Provider failures, cookie-based callback recovery, transactional account lifecycle, governance,
  and opt-in PostgreSQL concurrency coverage without making a real Provider call
- creative provider safety validation: production smoke must keep staging provider preflight and the Provider HTTP
  client disabled, while client tests use injected fetch implementations and never expose real Provider tokens
- provider decision validation: all four modalities retain a conditional primary and backup with explicit legal, data,
  SLA, budget, and replacement conditions
- content safety validation: all four modalities retain a fail-closed policy partition, Provider-native safety remains
  defense in depth, and unknown content, safety responses, or regions cannot dispatch or release output
- data governance validation: every data model remains classified with bounded retention, unknown flows/processors are
  denied, secrets/raw Provider payloads cannot enter persistence, and export/deletion targets stay explicit
- compliance validation: exact policy versions, consent capture, support routing, and user-rights entry points remain
  synchronized while legal approval and production publication remain fail-closed

The environment profile does not print secrets. It reports booleans, counts, provider modes, and safe operational metadata only.
For Chat, it reports only whether an encryption key is configured, whether the retention worker is enabled, and the
bounded sweep limit. The encryption material itself must never appear in smoke output or application logs.

Use `docs/RELEASE_CHECKLIST.md` after the deployment gate passes to run the release execution, post-release operations, alert verification, and rollback checks.
Use `docs/PHASE_3_TRACK_B_MULTI_INSTANCE_RUNBOOK.md` before scaling beyond one API or worker process so the deployment profile, smoke checks, metrics scrape, and rollback boundary are reviewed together.
Use `docs/REAL_PROVIDER_CURRENT_STATUS.md` as the first decision entry point before starting provider work. Use
`docs/V1_PROVIDER_HTTP_AND_SECRETS_BOUNDARY.md` for the default-disabled client and deployment-secret contract. Use
`docs/REAL_PROVIDER_BOUNDARY_CLOSEOUT.md` as the detailed handoff document. Use
`docs/REAL_PROVIDER_READINESS_CLOSEOUT_GATE.md` before starting or merging any staging-only real provider adapter PR.
Use `docs/REAL_PROVIDER_STAGING_SMOKE_READINESS.md` for the metadata-only smoke readiness closeout, then use
`docs/REAL_PROVIDER_STAGING_SMOKE_RUNBOOK.md` for the manual creative staging smoke execution and adapter closeout
evidence. Use `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md` before any PR or operator runs a real provider external-call
rehearsal. Use `docs/REAL_PROVIDER_CALLBACK_POLLING_PREREQUISITES.md` before enabling provider callbacks, polling workers,
or manual lifecycle replay.
Use `docs/V1_PROVIDER_DECISION_MATRIX.md` before choosing a provider/model, changing modality budgets, negotiating
provider terms, or implementing a primary/backup adapter.
Use `docs/V1_CONTENT_SAFETY_POLICY_MATRIX.md` before changing moderation categories, Provider safety mappings,
review/reject/release behavior, appeals, user safety messages, or safety-event audit fields.
Use `docs/V1_DATA_GOVERNANCE_BASELINE.md` before adding a Prisma model, persistent payload, processor, log field,
retention job, export/delete path, backup, Admin view, notification field, or secret boundary.
Use `docs/V1_COMPLIANCE_AND_SUPPORT_BASELINE.md` before changing policy text or versions, consent capture, Provider
disclosures, support categories, rights entry points, or legal-publication status.
Use `docs/OAUTH_SECURITY_AND_STAGING.md` before changing OAuth Provider configuration, callback/session behavior, or
requesting approval for a real staging validation.

LEGAL-02 data export and deletion changes must pass `npm run test:data-rights-lifecycle`. The gate freezes recent-session
and exact-handle identity verification, the three-request rolling limit, 5 MiB secret-free exports, decrypted owned Chat
content, seven-day artifacts, fixed 15-minute private downloads, the 30-day deletion grace period, all 15 primary deletion
domains, and final completion only after three immutable backup-expiry receipts at least 35 days after primary deletion.
Run `FOUNDATION_DATABASE_URL="$DATABASE_URL" npm run test:data-rights-lifecycle:integration` for PostgreSQL deletion and
trigger evidence, plus `npm run test:data-rights-lifecycle:e2e` for the owner/Admin workflow and 390px layout. These gates
prove engineering behavior only; production backup expiry remains blocked until RELEASE-01 infrastructure and rehearsal
evidence exist.

MEDIA-04 capacity and scan statistics must pass `npm run test:media-capacity-scan-metrics`. The gate freezes the
existing normalized media sources, 366-day filter bound, read/export permissions, safe aggregate projection, audited
snapshot export, responsive Admin metrics, and the personal-account-only boundary without making a Provider call.

## GitHub Actions

`.github/workflows/quality-gates.yml` wires these gates into CI:

- Pull requests and pushes to `main` / `master` run `npm run check:deploy` with the safe fixture smoke profile.
- Manual `workflow_dispatch` with `smoke_profile=fixture` runs the same fixture gate.
- Manual `workflow_dispatch` with `smoke_profile=env` runs `npm run smoke:production:env` against a selected GitHub Environment.
- Manual `workflow_dispatch` with `smoke_profile=creative-staging` runs `npm run smoke:creative-staging:env` against a selected dedicated staging GitHub Environment.
- Manual `workflow_dispatch` with `smoke_profile=infrastructure-rehearsal` runs the fail-closed preflight and isolated PostgreSQL/Redis/S3 recovery rehearsal, then retains only sanitized evidence.

For the real environment smoke, configure GitHub Environment variables and secrets by category. The detailed checklist lives in `docs/GITHUB_ENVIRONMENT.md`.

- Auth secrets: `ACCESS_TOKEN_SECRET` or `SESSION_SECRET`, plus optional `ACCESS_TOKEN_KEY_ID`.
- Browser auth variables: `AUTH_COOKIE_SECURE`, `AUTH_COOKIE_SAMESITE`, `AUTH_COOKIE_DOMAIN`, `AUTH_TRUSTED_ORIGINS` or `CORS_ALLOWED_ORIGINS`.
- Object storage: `STORAGE_DRIVER`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, optional `STORAGE_SESSION_TOKEN`, purpose-specific TTLs, and optional paired `STORAGE_PRIVATE_DOWNLOAD_*` settings.
- Media scanner: `MEDIA_SCAN_PROVIDER`, `MEDIA_SCAN_WEBHOOK_SECRET`, `MEDIA_SCAN_REQUEST_ADAPTER`, `MEDIA_SCAN_REQUEST_URL`, `MEDIA_SCAN_REQUEST_SECRET`, `MEDIA_SCAN_CALLBACK_BASE_URL`, `MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET`.
- Media alert channels: `MEDIA_SCAN_ALERT_WEBHOOK_URL`, `MEDIA_SCAN_ALERT_WEBHOOK_SECRET`, `MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL`, `MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL`, `MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_SECRET`, `MEDIA_SCAN_ALERT_EMAIL_TO`, `MEDIA_SCAN_ALERT_EMAIL_FROM`.
- Security alert channels: `SECURITY_ALERT_WEBHOOK_URL`, `SECURITY_ALERT_WEBHOOK_SECRET`, `SECURITY_ALERT_SLACK_WEBHOOK_URL`, `SECURITY_ALERT_EMAIL_WEBHOOK_URL`, `SECURITY_ALERT_EMAIL_WEBHOOK_SECRET`, `SECURITY_ALERT_EMAIL_TO`, `SECURITY_ALERT_EMAIL_FROM`.
- Guard rails: `RATE_LIMIT_*`, `REQUEST_BODY_*`, `AUTH_FAILURE_*`, `SECURITY_EVENT_MAX_ITEMS`.
- Metrics exporter: `METRICS_EXPORTER_ENABLED`, `METRICS_EXPORTER_FORMAT`, optional secret `METRICS_EXPORTER_TOKEN`.
- Worker topology: `API_EMBEDDED_WORKERS_ENABLED`, `MEDIA_SCAN_WORKER_*`, `MEDIA_STORAGE_CLEANUP_*`, `TASK_STALE_SUBMISSION_WORKER_*`, `WORKER_LEASE_*`.
- OAuth providers: `OAUTH_GOOGLE_*`, `OAUTH_GITHUB_*`, `OAUTH_DISCORD_*`, and/or `OAUTH_APPLE_*`.
- Creative provider preflight: keep `CREATIVE_PROVIDER_MODE=mock` or `disabled` and
  `CREATIVE_PROVIDER_HTTP_CLIENT_ENABLED=false` in production smoke. Use `CREATIVE_PROVIDER_RUNTIME_ENV=staging`,
  `CREATIVE_PROVIDER_MODE=disabled`, `CREATIVE_STAGING_PROVIDER_PREFLIGHT_ENABLED=true`,
  `CREATIVE_STAGING_IMAGE_PROVIDER=replicate`, `CREATIVE_STAGING_PROVIDER_API_TOKEN`,
  `CREATIVE_STAGING_PROVIDER_CONFIRMATION=staging-only`, and `CREATIVE_STAGING_SMOKE_MODE=preflight` only in a dedicated
  staging environment. The HTTP client flag is not an external-call approval.

Use GitHub Secrets for credentials, shared secrets, tokens, webhook secrets, Slack webhook URLs, and private keys. Use GitHub Variables for non-secret URLs, ids, domains, counts, feature flags, and recipient lists unless your deployment policy treats them as sensitive.

Multi-instance readiness is not just a passing fixture gate. Before a real rollout, rehearse two API instances with a shared Redis store, two worker instances with durable leases, and an external `/metrics` scrape as described in `docs/PHASE_3_TRACK_B_MULTI_INSTANCE_RUNBOOK.md`.

## Failure Handling

- Contract drift failures mean a route, OpenAPI path, or protected-route permission row is out of sync.
- Production smoke failures usually mean an environment variable is missing, invalid, or not aligned with the managed deployment profile.
- E2E failures should be checked after confirming the local dev server ports are free and Playwright artifacts have not been left from a previous interrupted run.
- After E2E, remove generated reports with `rm -rf test-results playwright-report` when running manually.
V1-36 asset-library changes must cover owner isolation, safe DTO redaction, stable filters/pagination, governance eligibility, lineage idempotency/cycle rejection, archive evidence retention, cross-studio handoff, and responsive UI. Run the full PR gate and fixture production smoke before closeout.
