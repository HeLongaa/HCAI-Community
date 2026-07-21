# MuseFlow AI Studio

A MusicGPT-inspired front-end prototype centered on an AI task marketplace and creator community.

The V1 task marketplace uses an actor-scoped workflow contract for publish, claim, propose, select, deliver, revise, accept, reject, stale review, dispute, and Admin resolution. Duplicate and concurrent lifecycle mutations are guarded so internal escrow, notifications, audit, reputation, and settlement side effects occur once; see `docs/V1_64_TASK_MARKETPLACE_LIFECYCLE.md` and run `npm run test:v1-task-marketplace`.

This project is being productized from a front-end prototype into a typed app plus API server. Core auth, task,
community, admin, point settlement, and media upload flows now have service/API coverage while some creative outputs
and catalog content remain simulated for product exploration.

## V1 Release Scope

V1 includes the complete marketplace, community, account, internal-points, notification, media-governance, Admin,
Image, Chat, Video, and Music product. Image, Chat, Video, and Music require approved real Providers before release.
Real RMB payment, withdrawal, KYC, invoice, tax, and merchant-settlement capabilities are explicitly excluded; internal
points, creative credits, quota, escrow, compensation, and generation refunds remain product ledger semantics.

The source of truth is `docs/V1_SCOPE_AND_DEFINITION_OF_DONE.md`, backed by the machine-readable
`config/v1-release-scope.json`. Run `npm run test:v1-scope` to verify the scope contract and excluded-capability guard.
The current demo/mock/fallback inventory lives in `docs/V1_RUNTIME_SURFACE_INVENTORY.md` and
`config/v1-runtime-surfaces.json`; `npm run test:v1-surfaces` prevents new untracked runtime fallbacks.
The conditional Image, Chat, Video, and Music primary/backup decisions, public-list-price budget envelope, legal
conditions, retention constraints, and fail-closed replacement triggers live in `docs/V1_PROVIDER_DECISION_MATRIX.md`
and `config/v1-provider-matrix.json`; `npm run test:v1-providers` verifies that decision contract. No selection in the
matrix approves a real provider call or production enablement.
The frozen four-modality content safety taxonomy, prohibited/block/review/allow decisions, Provider policy mappings,
responsibility chain, review/appeal contract, and audit allowlist live in `docs/V1_CONTENT_SAFETY_POLICY_MATRIX.md` and
`config/v1-content-safety-policy.json`; `npm run test:v1-safety-policy` verifies that policy baseline. Enforcement is
not complete, and the policy does not approve real Provider traffic.
The frozen data inventory, classifications, retention limits, allowed and forbidden flows, export/deletion contract,
external-processor boundaries, and redaction rules live in `docs/V1_DATA_GOVERNANCE_BASELINE.md` and
`config/v1-data-governance.json`; `npm run test:v1-data-governance` verifies all 36 Prisma models and six non-Prisma
asset classes. Export/deletion automation and production approval remain incomplete.
The versioned Terms, Privacy Policy, Acceptable Use Policy, AI Provider/generated-content disclosure, consent contract,
and support/data-rights entry points live in `docs/V1_COMPLIANCE_AND_SUPPORT_BASELINE.md` and
`config/v1-compliance-policy.json`; `npm run test:v1-compliance` verifies the policy, API, UI, OpenAPI, support, and
audit contracts. The text remains an engineering draft: legal approval and production publication are explicitly blocked.

## Features

- Task Plaza-first landing experience for posting AI requirements and taking paid work
- Forum-style creator community for posts, showcases, prompt discussions, and collaboration
- Publish Request page with category, reward, deadline, visibility, attachment, acceptance-rule fields, and AI assist buttons for manual text inputs
- My Tasks desk for claimed work, submitted deliverables, review notes, and contribution history
- Task details with public brief, private brief, attachments, result links, review notes, rights, budget, and points
- Inspiration Library for featured posts, task templates, prompt packs, tutorials, cases, and idea radar
- Points & rewards ledger with balance, pending rewards, rank, redemptions, and point history
- Admin Center for task review, resubmissions, community reports, user/tag/AI-config operation queues, and Finance ledger operations
- Dark responsive app shell with sidebar navigation
- English by default, Chinese language toggle
- Music creation workbench with prompt, modes, tools, queue, and recent results
- AI chat workspace with quick prompts and cross-module actions
- Image Studio with text/image generation modes, persisted lifecycle history, refresh recovery, cancellation, same-session retry, governed downloads, and compatible output reuse
- Video Studio with text-to-video, image-to-video, music video, storyboard, captions, and preview flow
- Explore page with radio cards, trending songs, images, and videos
- Global search panel for songs, playlists, SFX, users, tasks, and posts
- Mini player and expanded now-playing drawer with queue, prompt, lyrics, comments, like, and share
- Task Plaza for browsing, filtering, claiming, submitting, reviewing, accepting, and tracking AI-related tasks
- Community forum with post templates, categories, tags, sorting, votes, solved state, embedded works, task conversion, library saving, likes, saves, and replies
- Profile and playlist detail pages
- Pricing, API, Earn, About, versioned Terms/Privacy/AUP/Provider disclosure, and Support pages
- Login, registration, OAuth dev callback, logout, and auth-gated actions backed by the API, with explicit versioned registration and OAuth first-use consent
- Owner-scoped support, content-report, moderation-appeal, privacy, data-export, and account-deletion request tracking

## Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

Backend skeleton:

```bash
npm run dev:server
```

Open `http://127.0.0.1:8787/health`.

Background operations can run as an independent worker process:

```bash
npm --prefix server run worker
```

For multi-instance deployments, keep `API_EMBEDDED_WORKERS_ENABLED=false` on API instances and run a separate worker process with job-specific flags such as `MEDIA_SCAN_WORKER_ENABLED=true`, `MEDIA_STORAGE_CLEANUP_WORKER_ENABLED=true`, and `TASK_STALE_SUBMISSION_WORKER_ENABLED=true`. `MEDIA_SCAN_WORKER_INTERVAL_SECONDS`, `MEDIA_STORAGE_CLEANUP_WORKER_INTERVAL_SECONDS`, `MEDIA_STORAGE_CLEANUP_BATCH_SIZE`, `TASK_STALE_SUBMISSION_WORKER_INTERVAL_SECONDS`, `TASK_STALE_SUBMISSION_OLDER_THAN_HOURS`, and `TASK_STALE_SUBMISSION_SWEEP_LIMIT` tune worker cadence and bounded work. Worker jobs use durable database leases when `DATABASE_URL` is configured; `WORKER_LEASE_TTL_SECONDS` and `WORKER_LEASE_RENEW_INTERVAL_SECONDS` control lock expiry and renewal cadence so multiple worker instances do not execute the same shared-state job at the same time.

Backend environment:

```bash
cp server/.env.example server/.env
```

Production server startup requires `ACCESS_TOKEN_SECRET` or `SESSION_SECRET` with at least 32 characters. For JWT key rotation, set the new `ACCESS_TOKEN_SECRET` / `ACCESS_TOKEN_KEY_ID` and keep old keys in `ACCESS_TOKEN_PREVIOUS_SECRETS` / `ACCESS_TOKEN_PREVIOUS_KEY_IDS` until old access tokens expire.

Browser sessions receive refresh tokens in the `hcaiRefreshToken` HttpOnly cookie on login, registration, OAuth callback, and refresh rotation. The cookie is scoped to `/api/auth`, uses `SameSite=Lax`, and automatically adds `Secure` in production, when `AUTH_COOKIE_SECURE=true`, or when `AUTH_COOKIE_SAMESITE=None`; JSON body refresh tokens remain supported for API clients and tests. Cookie-backed refresh/logout requests require the readable `hcaiCsrfToken` cookie to match the `x-csrf-token` header, and split frontend/API deployments should set `AUTH_TRUSTED_ORIGINS`.

Local test account shortcuts are shown only in Vite development mode by default. Set `VITE_SHOW_TEST_ACCOUNTS=true` to expose them explicitly in another environment; production builds hide them unless that flag is set.

The API includes abuse guards for high-risk endpoints. `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_UPLOAD_MAX`, and `RATE_LIMIT_ADMIN_MUTATION_MAX` control per-window limits for auth, media upload signing, and Admin mutations; `RATE_LIMIT_WINDOW_MS` controls the window; `RATE_LIMIT_STORE=memory` keeps local in-process counters; and `RATE_LIMIT_STORE=redis` uses a Redis-compatible shared store for multi-instance deployments with `RATE_LIMIT_REDIS_URL`, `RATE_LIMIT_REDIS_PREFIX`, `RATE_LIMIT_REDIS_TIMEOUT_MS`, and `RATE_LIMIT_REDIS_FAILURE_MODE=fail_open|fail_closed`. `RATE_LIMIT_ENABLED=false` disables the guard for trusted internal deployments. When a client is limited the server returns HTTP 429 with a `Retry-After` header and emits a structured rate-limit event that can be wired to logs or metrics. If the shared store is unavailable, the configured failure mode either records a warning and fails open or returns HTTP 503 with a critical security event.

Request bodies are capped by `REQUEST_BODY_MAX_BYTES` and guarded both at the HTTP `Content-Length` boundary and during stream reads for chunked bodies. `REQUEST_BODY_SIZE_GUARD_ENABLED=false` disables this protection for trusted internal deployments. Rejected bodies emit a structured event that can be wired to logs or metrics.

Failed login attempts are monitored in a rolling window. `AUTH_FAILURE_IP_ACCOUNT_THRESHOLD` detects one IP failing against many identities, `AUTH_FAILURE_ACCOUNT_IP_THRESHOLD` detects one identity failing from many IPs, and `AUTH_FAILURE_MONITOR_ENABLED=false` disables the monitor for trusted internal deployments. Detected patterns emit structured `auth-anomaly` events for logs or metrics.

Security events from rate limits, body-size rejections, and failed-login anomalies are mirrored to durable Prisma storage when `DATABASE_URL` is configured, with an in-process collector capped by `SECURITY_EVENT_MAX_ITEMS` as the local/test fallback. Admin users with audit access can query recent events through `/api/admin/security/events`, aggregated threshold alerts through `/api/admin/security/alerts`, operations aggregates through `/api/admin/operations/metrics`, and auditable handoff exports through `/api/admin/operations/metrics/export`; the Admin Center Security tab surfaces the same operations metrics as a windowed overview with in-panel samples, handoff notes, server-generated JSON handoff export, audit drill-downs, and managed scan-archive writes. Set `METRICS_EXPORTER_ENABLED=true` and `METRICS_EXPORTER_FORMAT=prometheus` to expose a Prometheus-compatible `/metrics` scrape endpoint; set `METRICS_EXPORTER_TOKEN` for bearer-token protection or restrict the route through private networking/gateway controls. Handoff exports record `admin.operations.metrics_exported` audit events. The app shell and home page now label runtime data sources so API-backed, stored-session, demo-fallback, and mock workspace surfaces are visible during local review. `SECURITY_ALERT_WINDOW_MINUTES`, `SECURITY_ALERT_RATE_LIMIT_THRESHOLD`, `SECURITY_ALERT_BODY_REJECTED_THRESHOLD`, `SECURITY_ALERT_AUTH_FAILURE_THRESHOLD`, and `SECURITY_ALERT_DELIVERY_FAILURE_THRESHOLD` control the alert window and trigger points; optional `SECURITY_ALERT_WEBHOOK_*`, `SECURITY_ALERT_SLACK_*`, and `SECURITY_ALERT_EMAIL_*` settings fan out new alerts to operations channels, and repeated delivery failures surface as `security.alert.delivery_failed.spike`.

OAuth provider buttons read `/api/auth/oauth/providers` and use a signed dev callback when provider credentials are omitted. The security modal can list, link, and unlink provider accounts through `/api/auth/oauth/accounts`. Google and GitHub support real authorization-code exchange, PKCE, verified profile lookup, browser callback bridge handling, and HttpOnly refresh-cookie issuance. Admins manage the client id, exact redirect URI, scopes, SecretRef metadata, and enabled state; actual secrets remain fixed deployment variables such as `OAUTH_GOOGLE_CLIENT_SECRET` and `OAUTH_GITHUB_CLIENT_SECRET`. See `docs/OAUTH_SECURITY_AND_STAGING.md` for Provider registration.

Point rewards now create pending publisher escrow ledger entries on task creation, settle creator rewards on approval, release escrow on rejection, and use a unique source boundary to prevent duplicate settlement records. The ledger API is scoped to the signed-in user by default, allows `points:adjust` operators to query `userHandle`, and returns balance projections for available, frozen, pending, and lifetime totals. Admin Finance adds cross-user ledger search, manual adjustment with audit events, persisted policy management with history/diff/rollback, reason classification, high-value adjustment review, approval templates, filtered CSV export, and notifications for high-risk point workflows. The global topbar includes a notification inbox with unread count, unread/all/read history switching, single-read, read-all, refresh, and workflow page links; Admin Center can further filter notifications by type and resource. Adjustments above the actor's direct limit default to the admin review queue before settlement; `POINT_ADJUSTMENT_REVIEW_THRESHOLD` sets the default admin limit and `POINT_ADJUSTMENT_DIRECT_LIMITS` can override initial role limits such as `admin:5000,moderator:1000`.

Internal accounting now keeps points, creative credits, quota units, and Provider currency separate. Stable operation keys and same-unit balanced movements back atomic `InternalPointAccount` snapshots, task escrow, credit closeout, quota reservation, and append-only compensation. Admin Accounting provides permission-scoped reconciliation list/detail/scan/export APIs and a frontend read side; supported snapshot repairs require a different approver and append a linked compensation operation without rewriting historical ledger rows or movements. Run `npm run test:v1-accounting` for the V1-65 gate.

Media uploads default to local `mock://` contracts. In `STORAGE_DRIVER=s3`, upload creation requires a SHA-256 checksum and returns a presigned PUT bound to the exact content length, content type, and checksum; completion performs a storage HEAD before scanning. Scanners receive a short-lived private read contract, never a storage key. Clean active objects receive short-lived private S3 downloads or an HMAC private-CDN URL when `STORAGE_PRIVATE_DOWNLOAD_*` is configured. Soft deletion immediately revokes access and schedules physical deletion after `MEDIA_STORAGE_CLEANUP_RETENTION_DAYS`; the JOB-02 cleanup worker and bounded Admin trigger perform idempotent DELETE operations. Scanner configuration, retries, alerts, and archive behavior remain available as described in [MEDIA_REAL_STORAGE_SCANNER.md](docs/MEDIA_REAL_STORAGE_SCANNER.md).

Creative generation now has a provider boundary. `GET /api/creative/providers` exposes safe provider capability metadata, and `POST /api/creative/generations` executes the mock creative provider, applies moderation/review gates, reserves and commits quota through a durable cross-instance quota ledger, reserves and settles/refunds creative credits through a dedicated durable credit ledger, persists generated outputs as media assets, writes a safe durable generation record with prompt hash/preview and linked output asset ids, and keeps downloads behind the same media scan governance boundary. Admin users can inspect generation history and, with dedicated permissions, request idempotent cancellation, user-confirmed retry authorization, or a two-person manual lifecycle replay. Retry always creates a linked child attempt and requires the owner to resubmit matching inputs; manual replay accepts only allowlisted lifecycle evidence and cannot inject prompts, output URLs, secrets, or raw Provider payloads. Image Studio is the first frontend workspace wired to this API path; its V1-15 model, mode, parameter, input, output, cost, and safety contract is machine-readable, API-projected, and fail-closed. Music, Video, Chat, Explore, and catalog surfaces still retain demo/mock workspace content until a real-provider phase. V1-04 conditionally selects OpenAI GPT Image 2, GPT-5.6 Terra, Google Veo 3.1 Fast, and ElevenLabs Enterprise Music as primaries, with Replicate FLUX 1.1 Pro, Anthropic Claude Sonnet 5, Runway Gen-4.5, and Google Lyria 3 Pro Preview as approval-gated backups. V1-05 adds a minimum-payload Replicate HTTP client and deployment-secret boundary, but does not register it on the default generation route. V1-06 adds `POST /api/creative/providers/replicate/callback/:generationId` behind an independent, default-disabled staging kill switch, with timestamped HMAC, generation/job nonce binding, strict payload projection, replay-ledger dedupe, and an atomic side-effect claim. V1-07 adds a default-disabled dedicated-worker status client, strict polling response projection, oldest-first bounded sweeps, retry-safe status handling, and idempotent timeout accounting recovery. V1-08 adds the application-side generation mutation ledger, cancel/retry routes, dedicated permissions, Admin controls, and reviewed manual replay without registering a real Provider mutation client. V1-12 adds one shared Provider error taxonomy, safe error envelopes, bounded `Retry-After`, deterministic backoff, durable CAS retry state, polling attempt budgets, and safe Admin/metrics evidence. V1-13 adds a machine-readable lifecycle event catalog, recipient-aware in-app notification routing, retry audit allowlisting, unified Admin lifecycle metrics, safe drill-down samples, and Prometheus handoff metrics. `CREATIVE_PROVIDER_MODE=disabled` keeps credential checks metadata-only; `CREATIVE_PROVIDER_MODE=replicate_staging` exposes a staging-only, image-only provider shell as unavailable safe catalog metadata. Provider HTTP, callback, polling, polling-worker, output-fetch, external-notification, and mutation clients remain default-disabled or unregistered. A bounded HCAI Router image staging regression has been executed successfully through a dedicated restricted key; production Provider traffic remains promotion- and approval-gated.

The V1-06 callback contract lives in `docs/V1_PROVIDER_CALLBACK_API.md`; the V1-07 polling and recovery contract lives in `docs/V1_PROVIDER_POLLING_AND_RECOVERY.md`; the V1-08 mutation and reviewed replay contract lives in `docs/V1_PROVIDER_GENERATION_MUTATIONS.md`; the V1-09 source-keyed output ingestion and default-unregistered fetch boundary lives in `docs/V1_PROVIDER_OUTPUT_INGESTION.md`; the V1-10 immutable pricing snapshot and durable Provider budget ledger lives in `docs/V1_PROVIDER_COST_BUDGET_LEDGER.md`; the V1-11 fail-closed kill-switch, cap-evidence, circuit, probe, and reviewed-recovery boundary lives in `docs/V1_PROVIDER_CONTROL_PLANE.md`; the V1-12 shared error taxonomy and durable retry-state runbook lives in `docs/V1_PROVIDER_ERROR_AND_RETRY_POLICY.md`; the V1-13 internal notification, audit, metrics, and handoff contract lives in `docs/V1_PROVIDER_LIFECYCLE_OBSERVABILITY.md`; the V1-15 Image model, mode, parameter, and product projection contract lives in `docs/V1_IMAGE_CAPABILITY_CONTRACT.md`.

Provider readiness is closed out in `docs/PROVIDER_READINESS_CLOSEOUT.md`, with planning history in `docs/PROVIDER_READINESS_PLAN.md`. Start with `docs/REAL_PROVIDER_CURRENT_STATUS.md` before any provider work; it summarizes what is usable now, what is fixture-only, what is deferred, and what requires explicit approval. The V1-05 client and secret contract lives in `docs/V1_PROVIDER_HTTP_AND_SECRETS_BOUNDARY.md`. No real paid provider is connected to a product route yet. The current real-provider boundary handoff lives in `docs/REAL_PROVIDER_BOUNDARY_CLOSEOUT.md`; it remains the detailed boundary document after the current-status page. Admin mutation requirements originated in `docs/REAL_PROVIDER_ADMIN_MUTATION_REQUIREMENTS.md`; V1-08 implements the limited cancel, retry-authorization, and reviewed manual replay scope described in `docs/V1_PROVIDER_GENERATION_MUTATIONS.md`. Provider cost metadata and budget alarms are planned in `docs/REAL_PROVIDER_COST_METADATA_AND_BUDGET_ALARMS.md`; they keep provider spend separate from product creative credits and external billing. The final real-provider preflight gate lives in `docs/REAL_PROVIDER_READINESS_CLOSEOUT_GATE.md` and gives a conditional go only for a guarded staging-only image adapter, not production enablement. The staging adapter shell task boundary lives in `docs/REAL_PROVIDER_STAGING_ADAPTER_SHELL_PLAN.md`; its fixture and budget constraints still apply to product-route integration. The first external-call staging rehearsal still requires the explicit approval package in `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md`. V1-08 manual replay operates only on durable internal lifecycle evidence and never contacts a Provider; real webhook delivery, real status reads, real Provider cancellation, and paid generation remain separately approval-gated. Ordinary continuation language is not approval for a real paid provider call.

V1-16 adds a fixture-only OpenAI GPT Image 2 `text_to_image` adapter with a fixed endpoint and payload, strict
synchronous base64 PNG validation, safe Provider error projection, quality-based cost accounting, and governed media
persistence through non-serializable in-process bytes. The OpenAI catalog shell is always disabled and unregistered;
both `CREATIVE_OPENAI_IMAGE_HTTP_CLIENT_ENABLED` and `CREATIVE_OPENAI_IMAGE_NETWORK_CALLS_ENABLED` remain false by
default, and no real Provider request is approved by this implementation.

V1-17 adds owner-scoped clean image inputs, source/PNG-mask roles, strength controls, image-to-image/edit/variation
workflows, and durable `image-lineage-v1` relationships. OpenAI edit requests remain fixture-only behind the same
default-off gates; the product route continues to use explicit mock execution until separately approved.

V1-18 adds owner-scoped `GET /api/creative/generations` history and detail reads, a user-specific safe serializer,
governed output summaries, lifecycle action eligibility, refresh recovery, bounded active-job polling, cancellation,
same-session exact retry, private download contracts, and compatible PNG/JPEG/WebP output reuse. Raw prompts remain
in memory only for retry and are not written to browser storage or generation history. Refresh preserves job state but
intentionally removes exact-retry input. No browser path contacts a Provider directly.

V1-19 preparation adds a machine-readable Image staging acceptance contract and an OpenAI Image metadata preflight.
The preflight checks the selected primary adapter/client boundary, credential presence, bounded Provider/app caps,
disabled product dispatch, and production no-go while forcing real network calls off. Real staging evidence remains
pending explicit approval and is not produced by local or CI fixture commands.

V1-20 freezes the Chat contract for OpenAI GPT-5.6 Terra with Anthropic Claude Sonnet 5 as a separately approved backup.
It defines bounded context and output, `store=false`, disabled background mode, app-owned retention, future governed
attachments, streaming safety, disabled tools, and fail-closed cost limits. Both Chat Provider shells remain disabled;
the Chat UI is still simulated until V1-23.

V1-21 implements encrypted owner-scoped conversations, idempotent Mock SSE turns, stop/disconnect closeout, typed
frontend clients, inactivity cleanup, and restore-deletion tombstones. The visible Chat page remains simulated until
V1-23, and both real Chat Provider clients remain absent and disabled.

V1-22 adds strict owner/scanner/type/size checks for selected Chat attachment metadata, read-time authorization for
explicit Task and Library context, fail-closed input classification, a 512-character streaming safety buffer, safe
partial output, and identity-free Admin review evidence. Attachment bytes, production classifiers, and real Chat
Provider traffic remain unavailable.

## Verification

```bash
npm run check:quick
npm run check:pr
npm run check:deploy
```

`check:quick` runs lint, the V1 scope, runtime-surface, Provider-decision, content-safety, data-governance, compliance-policy, and Image staging-gate contracts, plus feature/API contract checks. `check:pr` adds production build, backend tests, Prisma schema validation, and E2E. `check:deploy` adds the safe production smoke fixture. Use `check:deploy:env` in a real deployment environment to validate actual environment variables without printing secrets.

`test:sim` runs feature-contract checks for the planned modules and then verifies API contract consistency across server routes, OpenAPI paths, and the protected-route permission matrix. `test:contracts` can run that API consistency check by itself. The feature-contract checks cover navigation, Task Plaza lifecycle, publish form,
My Tasks delivery desk, community forum flows, publish-form AI assists, creation tools, points ledger, admin review queue,
cross-module actions, localization, responsive layout contracts, and prototype-boundary documentation.

`smoke:production` validates the managed production configuration checklist against a safe fixture profile. Use `npm run smoke:production:env` in a deployment environment to validate the real `process.env` without printing secrets.

GitHub Actions configuration lives in `.github/workflows/quality-gates.yml`: PRs and pushes run the fixture deployment gate, while manual dispatch can run real environment smoke through a selected GitHub Environment.

## Productization Docs

Planning docs for the API, data model, auth, and backend rollout live in `docs/`:

- `docs/V1_SCOPE_AND_DEFINITION_OF_DONE.md`
- `docs/V1_CURRENT_STATE_AUDIT.md`
- `docs/V1_RUNTIME_SURFACE_INVENTORY.md`
- `docs/V1_PROVIDER_DECISION_MATRIX.md`
- `docs/V1_IMAGE_CAPABILITY_CONTRACT.md`
- `docs/V1_IMAGE_STAGING_RELEASE_GATE.md`
- `docs/V1_CHAT_CAPABILITY_CONTRACT.md`
- `docs/V1_CHAT_STREAMING_CONVERSATIONS.md`
- `docs/V1_CONTENT_SAFETY_POLICY_MATRIX.md`
- `docs/V1_DATA_GOVERNANCE_BASELINE.md`
- `docs/PRODUCT_BACKEND_PLAN.md`
- `docs/API_DESIGN.md`
- `docs/DATA_MODEL_AND_AUTH.md`
- `docs/OPERATIONS_RUNBOOK.md`
- `docs/PERMISSION_MATRIX.md`
- `docs/PHASE_2_STATUS.md`
- `docs/PHASE_2_CLOSEOUT.md`
- `docs/QUALITY_GATES.md`
- `docs/GITHUB_ENVIRONMENT.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/PHASE_3_PLAN.md`
- `docs/PHASE_3_TRACK_A_CLOSEOUT.md`
- `docs/PHASE_3_TRACK_B_PLAN.md`
- `docs/PHASE_3_TRACK_B_OPERATIONS_CLOSEOUT.md`
- `docs/PHASE_3_TRACK_B_MULTI_INSTANCE_RUNBOOK.md`
- `docs/PHASE_3_TRACK_C_PLAN.md`
- `docs/PHASE_3_TRACK_C_CLOSEOUT.md`
- `docs/PROVIDER_READINESS_PLAN.md`
- `docs/PROVIDER_READINESS_CLOSEOUT.md`
- `docs/PROVIDER_READINESS_CLOSEOUT_REVIEW.md`
- `docs/REAL_PROVIDER_CURRENT_STATUS.md`
- `docs/REAL_PROVIDER_BOUNDARY_CLOSEOUT.md`
- `docs/REAL_PROVIDER_PREFLIGHT_PLAN.md`
- `docs/REAL_PROVIDER_STAGING_STRATEGY.md`
- `docs/REAL_PROVIDER_ADMIN_MUTATION_REQUIREMENTS.md`
- `docs/REAL_PROVIDER_COST_METADATA_AND_BUDGET_ALARMS.md`
- `docs/REAL_PROVIDER_BUDGET_EVENT_WIRING_PLAN.md`
- `docs/REAL_PROVIDER_READINESS_CLOSEOUT_GATE.md`
- `docs/REAL_PROVIDER_STAGING_ADAPTER_SHELL_PLAN.md`
- `docs/REAL_PROVIDER_STAGING_SMOKE_READINESS.md`
- `docs/REAL_PROVIDER_STAGING_SMOKE_RUNBOOK.md`
- `docs/REAL_PROVIDER_EXTERNAL_CALL_GO_NO_GO.md`
- `docs/REAL_PROVIDER_CALLBACK_POLLING_PREREQUISITES.md`
