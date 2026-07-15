# Productization Phase 2 Status

This document summarizes the current API / data model / authentication / authorization productization state.

Closeout decision notes live in `docs/PHASE_2_CLOSEOUT.md`.

## Progress Snapshot

Estimated overall Phase 2 completion: **92%**.

| Module | Progress | Current state | Remaining gap |
| --- | ---: | --- | --- |
| API foundation and contracts | 95% | Modular routes, typed parsers, OpenAPI, route/OpenAPI/permission drift check, response envelope, cursor pagination patterns | Expand OpenAPI schemas from summaries to full response schemas for external consumers |
| Repository and persistence | 90% | Seed fallback and Prisma repository cover core product data, auth sessions, permissions, media, audit, notifications, and finance flows | Run migration/rollback against the real production database profile |
| Auth, sessions, and OAuth | 94% | Email auth, registration, OAuth providers, JWT access tokens, refresh rotation, HttpOnly cookie mode, CSRF/trusted-origin checks, session management, session-verified frontend auth feedback | Real provider credential verification in target deployment environments |
| Authorization and audit | 93% | Central permission catalog, persisted role grants, protected admin grants, audit list/detail/export, deep links, operations export auditability | Add automated permission regression snapshots if role design starts changing frequently |
| Product workflow APIs | 86% | Tasks, proposals, submissions, posts, library conversion, points escrow/settlement, admin reviews, notifications | Broaden non-happy-path E2E for disputes, ownership edge cases, and pagination-heavy flows |
| Media governance and scanner operations | 90% | Signed upload contracts, scan jobs, webhook scanner, ClamAV adapter, callbacks, retry/sweep, archive-before-prune, governance policy/history/rollback, alert delivery | Validate real scanner/object-storage integration in staging with production-like credentials |
| Admin observability and operations | 90% | Security events/alerts, delivery failure aggregation, operations metrics, handoff export, audit replay entry, runbooks and release checklist | Add dedicated metrics exporters if Prometheus/OpenTelemetry becomes required |
| Frontend typed integration | 88% | Typed service layer, async resources, Admin/API-backed flows, auth/session/OAuth UI, media upload integration, notifications, E2E coverage, registered-user profile mapping | Continue replacing residual mock-only creative/catalog flows when Phase 3 product scope is chosen |
| CI, quality gates, and deployment readiness | 90% | `check:quick`, `check:pr`, `check:deploy`, production smoke fixture/env profile, GitHub Actions workflow, GitHub Environment checklist | Execute `check:deploy:env` inside the real GitHub Environment after secrets are configured |
| Documentation and operational handoff | 94% | API design, permission matrix, data/auth notes, operations runbook, quality gates, GitHub environment checklist, release checklist, Phase 2 closeout package | Keep docs in lockstep with future route/permission changes through the new drift check |

## Completed

### API foundation

- `server/` Node package with modular route registration.
- Consistent response envelope and HTTP error handling.
- Request parsing and validation for auth, task, post, library, admin review, role permission updates, admin ledger search, and point adjustments.
- OpenAPI skeleton in `server/src/docs/openapi.js`.
- API contract drift check in `scripts/verify-api-contracts.mjs`, wired into `npm run test:sim`, verifies server routes, OpenAPI paths, and protected-route permission matrix rows stay aligned.
- Production smoke profile in `scripts/smoke-production.mjs` validates managed auth secrets, S3 storage, webhook media scanning, alert channels, secure cookie/trusted-origin settings, guard rails, and OAuth provider metadata through `npm run smoke:production` or real environment checks with `npm run smoke:production:env`.
- Quality gates in `docs/QUALITY_GATES.md` and root npm scripts define `check:quick`, `check:pr`, `check:deploy`, and `check:deploy:env` for local handoff, pull request review, and deployment readiness.
- GitHub Actions workflow `.github/workflows/quality-gates.yml` runs the deployment fixture gate on PRs/pushes and supports manual real-environment smoke checks through GitHub Environments.
- GitHub Environment checklist in `docs/GITHUB_ENVIRONMENT.md` separates required secrets, required variables, alert-channel settings, guard-rail thresholds, and validation steps for the real deployment smoke profile.
- Release checklist in `docs/RELEASE_CHECKLIST.md` covers pre-release gates, database/migration checks, critical API smoke checks, Admin operations verification, alert channel validation, rollback triggers, and rollback steps.

### Repository and persistence

- Repository abstraction with seed fallback and Prisma-backed implementation.
- Prisma schema and migrations for users, auth accounts, refresh tokens, profiles, tasks, task proposals, task submissions, posts, comments, post likes, library items, media assets, point ledger, audit events, admin reviews, notifications, permissions, role permissions, and system settings.
- Point ledger has a unique source boundary on `(user, sourceType, sourceId)` for idempotent task escrow and settlement events.
- Refresh token sessions include family metadata for rotation-chain tracking and reuse detection.
- Prisma seed can reproduce the demo accounts and enough product data for current UI flows.

### Auth and permissions

- Email/password registration and login, demo handle login, refresh, logout, and `/api/me`.
- Frontend email login and registration now verify the authenticated session through `/api/me` before reporting success, map API error codes into user-facing messages, and show field-level errors for email, password, and handle validation.
- Newly registered users receive API-derived profile summaries in the frontend account state instead of falling back to the `taskops` demo profile.
- Passwords are hashed with Node `scrypt` before storage.
- Hardened demo session storage:
  - Login and refresh now issue signed JWT access tokens plus random opaque refresh tokens instead of static `demo-*` session tokens.
  - Access tokens are stateless HS256 JWTs with short expiry and signature/tamper validation.
  - JWT signing supports `kid` headers, current/previous key rings, and production startup validation for managed secrets.
  - Refresh tokens are stored as SHA-256 hashes in Prisma-backed persistence and rotated on refresh.
  - Refresh token family reuse detection revokes the active family when an already replaced token is replayed.
  - Logout revokes active refresh tokens.
  - Legacy static `demo-access.*` tokens remain accepted for backend test fixtures and local compatibility.
- Session management APIs:
  - `GET /api/auth/sessions`
  - `DELETE /api/auth/sessions/:id`
  - `DELETE /api/auth/sessions`
- OAuth account flow foundation:
  - `GET /api/auth/oauth/providers`
  - `GET /api/auth/oauth/accounts`
  - `DELETE /api/auth/oauth/accounts/:provider`
  - `POST /api/auth/oauth/:provider/start`
  - `GET /api/auth/oauth/:provider/callback`
  - Public provider metadata exposes provider labels, `dev`/`external` mode, callback method, and requested scopes without leaking secrets.
  - Signed short-lived OAuth state with nonce, redirect, and optional account-link user id.
  - OAuth state is persisted only as a SHA-256 hash and atomically consumed once before exchange; replay and expired state are rejected across API instances.
  - Google and Discord authorization-code flows use S256 PKCE without persisting the verifier.
  - Production never silently falls back to dev OAuth; missing or invalid Provider configuration is explicitly unavailable.
  - Provider redirect URIs are exact callback paths, external JSON calls have bounded timeouts, and verified email evidence is mandatory before email-account linking.
  - Account-link start now requires an authenticated user when `linkAccount` is requested.
  - Dev OAuth provider mode for local login/linking without external provider credentials.
  - Google OAuth token exchange and OpenID userinfo profile verification.
  - Discord OAuth token exchange and `/users/@me` profile verification.
  - Apple Sign in token exchange, ES256 client secret generation, JWKS-backed `id_token` verification, nonce checks, and first-login name capture.
  - OAuth callback supports GET and form-post provider callbacks.
  - OAuth callback returns a token-free browser bridge for top-level HTML callbacks, sets refresh/CSRF cookies, clears stale access state, preserves a bounded one-time app redirect, and restores `/api/me` through a single-flight cookie rotation; API clients keep the JSON session response.
  - Browser refresh sessions now issue and rotate `hcaiRefreshToken` as an HttpOnly `/api/auth` cookie with `SameSite=Lax`; refresh/logout can use the cookie while JSON-body refresh tokens remain supported for API clients.
  - Cookie-backed refresh/logout now require double-submit CSRF protection through the readable `hcaiCsrfToken` cookie and `x-csrf-token` header, plus trusted Origin checks and credentialed CORS preflight support for configured frontend origins.
  - Deployment smoke coverage validates production OAuth provider metadata, managed token secrets, trusted origins, `SameSite=None` secure cookie mode, object storage, media scanner callbacks, and notification delivery channel configuration.
  - Rate limits protect auth, media upload signing, and Admin mutation buckets, with per-bucket env limits, a tested opt-out for trusted internal deployments, a swappable HTTP-layer store boundary, standard `Retry-After` responses, and a structured exceeded-event hook for logs/metrics.
  - Request body size guards reject oversized `Content-Length` requests before route handling and cap chunked body reads with structured HTTP 413 responses plus rejected-event hooks for logs/metrics.
  - Failed-login anomaly monitoring detects one IP failing against many identities and one identity failing from many IPs, with configurable windows/thresholds and structured observer hooks for logs/metrics.
  - A unified security event collector now normalizes rate-limit, body-size, and auth-anomaly events, mirrors them to durable Prisma storage when configured, keeps an in-process fallback for local/test mode, and exposes them through `/api/admin/security/events` for audit-authorized operators.
  - Security event aggregation now exposes `/api/admin/security/alerts` for rate-limit, body-size, failed-login anomaly, and external delivery failure spikes; Prisma-backed deployments create deduped station notifications for audit readers, fan out new alerts through optional webhook/Slack/Email channels, audit delivery results as `security.alert.dispatch`, and aggregate repeated failures as `security.alert.delivery_failed.spike`.
  - Admin operations metrics now expose `/api/admin/operations/metrics` for audit-authorized operators, aggregating security event volume, security alert disposition/delivery health, scan archive candidates/writes, and scan history prune totals from existing event sources. `/api/admin/operations/metrics/export` returns a server-generated handoff artifact with samples and remediation hints, records `admin.operations.metrics_exported` audit metadata for traceability, and Admin Center can expand that audit event to recover the exported window/sample/hint summary and reopen the matching metrics window.
  - OAuth callback can create a new user, link to an existing email user, or bind a provider account to the current user.
  - Signed-in users can list and unlink OAuth provider accounts, with last sign-in method protection.
- Route guards through `requireUser` and `requirePermission`.
- Central permission catalog in `server/src/auth/permissions.js`.
- Persisted `permissions` and `role_permissions` tables for Prisma-backed role grants.
- Admin role permission APIs:
  - `GET /api/admin/permissions`
  - `GET /api/admin/roles`
  - `PUT /api/admin/roles/:role/permissions`
- Protected grant rule: `admin` cannot lose `admin:permissions:manage`.
- Cursor pagination and basic filters for admin audit, admin review queue, tasks, posts, points ledger, profiles, and library APIs.
- Seed fallback repository and Prisma repository now share high-risk ownership rules for task submit/review, post conversion, and library conversion/workspace actions.

### Product workflows

- Task create, claim, submit, and review APIs.
- Task creation now records a pending publisher escrow ledger entry for point rewards.
- Task approval now settles the publisher escrow and creator reward points in the same review transaction.
- Task rejection cancels the publisher escrow and records a settled escrow release entry.
- Task reward settlement is idempotent across repeated review calls.
- Normalized task proposal and submission APIs:
  - `POST /api/tasks/:id/proposals`
  - `GET /api/tasks/:id/proposals`
  - `POST /api/tasks/:id/proposals/:proposalId/actions`
  - `GET /api/tasks/:id/submissions`
- Task proposal accept/reject workflow with assign-on-accept behavior.
- Media upload signing and persisted media asset APIs:
  - `GET /api/media/review-queue`
  - `GET /api/media/scan-jobs`
  - `GET /api/media/governance-config`
  - `PUT /api/media/governance-policy`
  - `GET /api/media/governance-policy/history`
  - `POST /api/media/governance-policy/rollback`
  - Effective media governance policy now drives scanner alert windows/thresholds, scan sweep max attempts, and scan job history retention while keeping scanner adapter secrets and dispatch endpoints environment-owned.
  - `GET /api/media/scan-alerts`
  - `GET /api/media/scan-alerts/:id/events`
  - `GET /api/media/uploads/:id/scan-jobs`
  - `POST /api/media/scan-jobs/sweep`
  - `POST /api/media/uploads`
  - `POST /api/media/uploads/:id/complete`
  - `POST /api/media/uploads/:id/scan`
  - `POST /api/media/uploads/:id/scan-callback`
  - `POST /api/media/uploads/:id/scan-retry`
  - `GET /api/media/assets/:id/download`
  - Scan job history supports cursor pagination with default `limit=10` and max `limit=50`.
  - Upload contracts support local `mock://` mode and S3-compatible presigned PUT URLs through `STORAGE_DRIVER=s3`.
  - Upload signing enforces purpose-specific MIME and size policies before creating media asset records.
  - Upload completion records secondary MIME validation and scan provider metadata.
  - `MEDIA_SCAN_PROVIDER=manual` keeps completed uploads pending manual review; `MEDIA_SCAN_PROVIDER=mock` deterministically classifies local assets as clean, manual-review, or rejected for integration testing; `MEDIA_SCAN_PROVIDER=webhook` moves uploads into `scanning`, optionally dispatches scan requests to `MEDIA_SCAN_REQUEST_URL` through `MEDIA_SCAN_REQUEST_ADAPTER=generic-webhook` or `clamav-http`, and waits for a shared-secret provider callback to record the final scanner result. `MEDIA_SCAN_CALLBACK_SIGNATURE_SECRET` enables timestamped HMAC callback verification, and denied callbacks write `media.scan.callback_denied` audit events without storing secret material.
  - The `clamav-http` adapter has deployment-style smoke coverage with a local scanner gateway that receives the ClamAV job payload and calls back with `clean`, `review`, and `rejected` results.
  - Durable `media_scan_jobs` records track job status, scan result, request adapter, attempts, timeout, external scan id, callback/review timestamps, failure reason, and retry state for operations monitoring; `MediaAssetDto.metadata.security` remains a compatibility projection for the frontend.
  - Admin Center can open per-asset scan job history, including attempts, dispatch status, callback timing, timeout/failure markers, and rejection notes.
  - Admin Center surfaces scanner health alerts for repeated callback denials, dispatch failures, and scan timeout escalations.
  - Scanner health alerts create deduped station notifications for media queue readers and can fan out to a configured operations webhook through `MEDIA_SCAN_ALERT_WEBHOOK_URL`, to Slack through `MEDIA_SCAN_ALERT_SLACK_WEBHOOK_URL`, and to an HTTP mailer through `MEDIA_SCAN_ALERT_EMAIL_WEBHOOK_URL`; webhook and email delivery can be HMAC-signed, each channel writes delivery audit events, failed external delivery is aggregated as `media.scan.alert_delivery_failed.spike`, operators can acknowledge/silence/unsilence alerts with audit-backed state, each alert exposes recent contributing samples for investigation, Admin Center shows a safe media governance config projection and can persist editable numeric policy overrides, and delivery is organized behind an explicit channel registry for future adapters.
  - Admin Center surfaces recent denied scanner callbacks in the Media governance panel, using `media.scan.callback_denied` audit events without exposing secret material.
  - Scan job sweep can automatically requeue timed-out jobs until `MEDIA_SCAN_MAX_ATTEMPTS`, then escalate to manual review and notify queue operators; `MEDIA_SCAN_WORKER_ENABLED=true` enables the independent worker process sweep loop, while API instances should keep `API_EMBEDDED_WORKERS_ENABLED=false` in multi-instance deployments.
  - Scan job history retention is configurable with `MEDIA_SCAN_HISTORY_RETENTION_DAYS` and `MEDIA_SCAN_HISTORY_RETENTION_MAX_PER_ASSET`; `/api/media/scan-jobs/archive` previews and writes cold-archive candidate manifests before deletion, while sweep prunes inactive history and writes `media.scan.history_pruned` audit summaries.
  - Production operations guidance now covers security alert disposition, silence windows, notification delivery failure triage, archive-before-prune flow, auditable operations handoff exports, and a suggested metrics mapping for security, scan, and Admin workflows.
  - Scan results can mark assets `clean` or `rejected`; clean uploaded assets can receive private mock/S3 download contracts.
  - Media review queue supports scan status, purpose, search, and pagination filters for operations workflows.
- Post create, comment, like/unlike, and convert-to-task APIs.
- Library save, convert-to-task, and send-to-workspace APIs.
- Points ledger read API exposes entry status, source type, and source id for escrow/settlement auditability.
- Points ledger is scoped to the current user by default, supports `points:adjust` operator lookup by `userHandle`, and returns balance projections for available, frozen, pending settlement, projected, earned, and spent totals.
- Admin Finance APIs support cross-user ledger search by handle/status/keyword, manual point adjustments with audit events, persisted policy management, policy history/diff/rollback, reason classification, role-based direct adjustment limits, high-value adjustment review metadata before settlement, self-approval prevention, and filtered CSV export.
- Notification APIs expose a current-user inbox and read state:
  - `GET /api/notifications`
  - `POST /api/notifications/:id/read`
  - `POST /api/notifications/read-all`
- Notification list queries support `readState`, `type`, and `resourceType` filters while preserving the older `unreadOnly=true` compatibility flag.
- Notification producers cover high-value point adjustment review requests, point adjustment approval/rejection results, and point policy rollback events.
- Media scan notifications cover external-scan manual review requests, scanner rejections, operator retry requests, and scanner health alerts with Admin deep links.
- Admin audit API.
- Admin audit events support precise `GET /api/admin/audit/:id` lookup for copied audit links and notification deep links.
- Admin audit exports support filtered JSON artifacts through `GET /api/admin/audit/export`.
- Admin review queue list/review APIs with persisted Prisma model.

### Frontend integration

- Typed service layer in `src/services`, including auth session list/revoke calls.
- Login modal supports email/password sign in, registration, and OAuth provider sign in with dev fallback when external provider credentials are not configured.
- Login modal now reads OAuth provider configuration from the API, shows Dev/Live provider badges, handles external redirecting state separately from completed dev callbacks, and maps OAuth API errors into user-facing messages.
- Login modal shows field-level validation and API-backed error mapping for email/password registration and sign-in, including duplicate account and invalid credential states.
- Local test account shortcuts are hidden from production builds by default and gated behind Vite development mode or `VITE_SHOW_TEST_ACCOUNTS=true`.
- Security session modal lists refresh sessions, shows active/revoked/risk states, and supports single-session or all-session revocation.
- Security session modal also shows linked Google/Apple/Discord identities, supports provider linking through the OAuth flow, supports unlinking, and surfaces last-method protection errors.
- Async resource hook for API-backed loading/error states.
- Admin Center consumes review queue, audit log, permission catalog, and role permission matrix APIs.
- Admin Center role permission matrix supports edit/save when the current account has `admin:permissions:manage`.
- Admin Center includes a Security tab that consumes `/api/admin/security/alerts` and `/api/admin/security/events`, with threshold alert summaries, exact notification deep-link focus, acknowledge/silence/unsilence actions, alert event samples, single-alert JSON export, source/severity/type filters, cursor-based event loading, refresh/error/empty states, and event detail metadata for rate-limit, body-size, and failed-login anomaly investigation.
- Admin Center Security tab now includes an operations metrics overview for `/api/admin/operations/metrics`, with time-window switching, security event/alert/disposition health, delivery failures, scan archive candidates, archive writes, scan history prune summaries, audit-filter drill-downs, in-panel recent sample drill-downs, handoff notes/remediation hints, JSON snapshot export, media governance focus, and managed archive write actions.
- App shell and home page now expose runtime data source labels for API sessions, stored sessions, demo fallbacks, API-loaded task/community/points resources, and mock creative workspace surfaces.
- Admin Center Finance tab consumes admin ledger search, balance summary, manual adjustment, high-value review submission, points approval filtering, policy editing/history/rollback, approval templates, and CSV export APIs when the current account has `points:adjust`.
- Admin Center shows unread notifications and can mark reminders as read.
- The global topbar now includes a notification inbox with unread count, refresh, read-all, single-read, and workflow page deep links.
- Notification metadata now carries `target` hints so Admin Center can switch tab/filter and highlight related review or policy-history rows.
- Notification and copied audit links can focus exact Admin audit events, including events outside the current audit list page.
- Admin Center can export the current audit filter result as a JSON artifact for incident review and handoff.
- Media notification targets can focus the Admin media governance panel by scan status and asset id.
- Topbar and Admin notification surfaces can switch between unread, all, and read history; Admin also filters by notification type and resource type.
- Task proposal/submission typed service integration:
  - `taskService` now exposes proposal create/list/review and submission list endpoints.
  - Task workflow hook tracks per-task proposal and submission collections with loading/error states.
  - Task market submit action now uses `task:propose` and the normalized proposal API.
  - My Tasks is account-aware for publisher, assignee, and in-session proposer task ownership.
  - My Tasks displays API-backed proposal queues, accept/reject actions, normalized submission records, and review actions with demo-data fallback.
  - Frontend task DTO mapping handles both legacy string budgets and structured API budget view models.
- Media upload UI integration:
  - Publish task form can register task attachment assets through the typed media upload contract and pass uploaded asset ids to task creation.
  - My Tasks delivery form can register submission assets through the typed media upload contract and pass uploaded asset ids to normalized submissions.
  - The upload panel handles mock upload URLs, can PUT directly to real signed URLs, and completes persisted media assets through the API.
  - Admin Center includes a media governance panel with scan status/purpose/search filters and release/reject actions.
- Browser E2E foundation:
  - Playwright config starts the API server and Vite app for browser regression tests.
  - Email registration/login E2E covers the login modal, OAuth account linking/unlinking, and security session revocation against real auth APIs.
  - OAuth provider E2E covers Google button -> OAuth start -> dev callback -> signed-in user.
  - Admin permission matrix E2E covers role permission edit/save and verifies the API state.
  - Task workflow E2E covers publisher task creation, creator proposal submission, publisher proposal acceptance, creator submission asset upload, publisher review, and final task completion persistence.

## Verification

Latest verification commands:

```bash
npm run check:quick
npm run check:pr
npm run check:deploy
npm run smoke:production:env # run inside the configured deployment environment
```

Current known passing state:

- Deployment fixture gate: passing through `npm run check:deploy` on the `codex/phase-2-closeout` branch.
- Prisma schema validation: passing.
- Backend tests: 259 passing.
- Static feature simulation: 52 passing.
- API contract drift check: passing with 89 server routes, 89 OpenAPI routes, and 58 protected permission-matrix routes.
- Browser E2E: 4 passing, including email registration/login, dev OAuth login, admin permission matrix editing, and the complete proposal -> media-backed submission -> review task workflow.
- Frontend lint: passing.
- Frontend production build: passing.
- Production smoke fixture: passing.

## Remaining Production Gaps

- Real deployment secrets and GitHub Environment variables still need to be configured and validated with `npm run check:deploy:env`.
- Real OAuth provider credentials, scanner endpoints, object storage credentials, and alert delivery channels need staging/prod smoke validation outside fixture mode.
- Dedicated Prometheus/OpenTelemetry exporters are not yet implemented; current observability is API/audit/dashboard based.
- Rate limiting currently supports the in-process memory store; multi-instance production should keep external gateway limits or add a shared store.
- Some creative/catalog-facing frontend areas remain simulated or demo-content driven until Phase 3 product scope is chosen.
- OpenAPI currently has route coverage and summaries; full response schema expansion remains a later external-integration hardening task.

## Recommended Next Steps

1. Configure the real GitHub Environment and run `npm run check:deploy:env` through the manual `Quality Gates` workflow.
2. Execute the release checklist in a staging environment with real S3, OAuth, scanner, and alert-channel credentials.
3. Decide whether Phase 2 can be closed after staging validation, or whether external metrics exporters / shared rate-limit storage are required before closure.
