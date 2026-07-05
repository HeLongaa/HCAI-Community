# Phase 3 Track B Plan

This document defines the Phase 3 Track B planning baseline: **Production Operations**.

Track A made the task marketplace workflow deeper and more usable. Track B should now harden the runtime shape for multi-instance deployments and external observability without reopening marketplace product behavior or creative-provider productization.

## Objective

Make NewChat safer to operate beyond a single local or fixture-style server process.

Track B should focus on:

- shared abuse-guard state across stateless app instances
- explicit worker topology for recurring/background operations
- metrics exporters for external operations systems
- deployment and incident runbooks for multi-instance environments

## Current Baseline

The codebase already has a strong Phase 2/Track A operations foundation:

- `check:deploy` validates lint, feature simulation, API contracts, build, Prisma generation/validation, backend tests, Playwright E2E, and fixture production smoke.
- Rate limiting protects auth, media upload signing, and admin mutations with a memory store and an injected async-store boundary in `server/src/common/http/rateLimit.js`.
- `RATE_LIMIT_STORE` is parsed by env validation, but currently only supports `memory`.
- Request body limits, auth-failure anomaly detection, security events, and security alerts are already wired.
- Media scan sweeps exist through `startMediaScanWorker`, but the worker runs as an in-process interval attached to the API server.
- Scan job history, archive-before-prune, security alerts, media alerts, and operations metrics are visible through Admin/API JSON views.
- `docs/OPERATIONS_RUNBOOK.md`, `docs/GITHUB_ENVIRONMENT.md`, and `docs/RELEASE_CHECKLIST.md` cover Phase 2 deployment readiness and incident flows.

This is enough for local review, fixture CI, and single-instance staging. It is not yet a complete multi-instance production posture.

## Scope

### In Scope

- Add a shared rate-limit store option, preferably Redis-compatible, while preserving memory fallback.
- Add explicit worker process topology for background operations.
- Add safe lease/locking behavior for recurring jobs that may run from more than one worker.
- Add Prometheus and/or OpenTelemetry exporter support for operational metrics.
- Update smoke checks and runbooks for multi-instance deployment.
- Keep Admin Center operations metrics as an in-product view, but make external systems first-class.

### Out Of Scope

- Track C creative-provider generation, generated asset persistence, cost/quota, or generated-output moderation.
- New marketplace product features beyond operations hardening.
- A broad frontend redesign.
- Replacing the existing Admin Center operations dashboard.
- Vendor-specific infrastructure templates unless a deployment target is chosen.

## Proposed Implementation Order

Current implementation status:

1. Planning and task inventory: completed in `codex/phase-3-track-b-planning`.
2. Shared rate-limit store: completed and merged through PR #5.
3. Worker process topology: completed and merged through PR #6.
4. Distributed job leases: completed and merged through PR #7.
5. External metrics export: completed and merged through PR #9.
6. Multi-instance runbook and smoke updates: in closeout. Core docs and smoke config are updated; final real-environment staging rehearsal remains pending.

### 0. Planning And Task Inventory

Create the Track B plan, confirm scope, and write the task list into Notion before implementation begins.

Exit criteria:

- Track B plan exists in the repository.
- Notion task list records implementation slices, status, validation, and next steps.
- Track B scope is explicitly separated from Track C and Track A follow-up E2E.

### 1. Shared Rate-Limit Store

Goal: allow stateless app instances to share abuse-guard counters.

Recommended scope:

- Add a rate-limit store factory that selects `memory` or `redis`.
- Add Redis-compatible store implementation behind the existing `increment({ key, windowMs, now })` contract.
- Add env validation for Redis configuration:
  - `RATE_LIMIT_STORE=redis`
  - `RATE_LIMIT_REDIS_URL`
  - `RATE_LIMIT_REDIS_PREFIX`
  - `RATE_LIMIT_REDIS_TIMEOUT_MS`
  - optional failure policy such as `RATE_LIMIT_REDIS_FAILURE_MODE=fail_open|fail_closed`
- Preserve memory mode for tests and local development.
- Emit safe structured events when the shared store is unavailable.
- Update smoke profile expectations when Redis mode is selected.

Exit criteria:

- Two app instances can enforce the same auth/upload/admin mutation bucket limits through shared state.
- Memory mode remains unchanged for local tests.
- Store failures have documented and tested behavior.

Validation:

- Unit tests for Redis-store command behavior with a fake client.
- Existing rate-limit tests still pass.
- New env tests cover Redis config.
- Deployment smoke can validate configured shared-store mode without printing secrets.

### 2. Worker Process Topology

Goal: separate recurring/background operational work from HTTP request handling.

Recommended scope:

- Add a worker entrypoint, for example `server/src/worker.js`.
- Add npm script support, for example `npm --prefix server run worker`.
- Move existing media scan sweep scheduling behind a reusable worker registry.
- Add stale task submission sweep as a worker-capable job, with conservative defaults.
- Add scan history archive/prune scheduling as an explicit job only when archive policy is configured.
- Add bounded concurrency and per-job interval configuration.
- Keep manual API-triggered sweeps available for operators.

Exit criteria:

- API server can run without owning background intervals.
- Worker process can run scan sweep and stale-submission sweep jobs.
- Operators can deploy API and worker processes independently.

Validation:

- Worker registry unit tests.
- Smoke test for disabled/enabled worker modes.
- Existing API sweep endpoints remain compatible.

### 3. Distributed Job Leases

Goal: prevent duplicate recurring work when multiple workers are running.

Recommended scope:

- Add a durable operation lease model or equivalent lock mechanism.
- Use leases around worker jobs that mutate shared state:
  - media scan sweep
  - scan history archive/prune
  - stale submission sweep
  - alert delivery retry or dispatch jobs if moved into workers
- Record lease acquisition/release/failure metadata for audit or operations metrics.
- Define stale lease recovery.

Exit criteria:

- Multiple workers can run safely without duplicating sweep/prune side effects.
- A crashed worker lease can expire and be recovered.
- Operators can see recent lease failures or contention.

Validation:

- Repository tests for lease acquire/renew/release.
- Worker tests for lock contention.
- Operations metrics include lease failures or skipped runs.

### 4. External Metrics Export

Goal: expose platform health to external monitoring systems, not only Admin Center.

Recommended scope:

- Add a Prometheus-compatible `/metrics` endpoint or OpenTelemetry exporter.
- Start with metrics already represented in operations aggregates:
  - security events by source/severity
  - security alerts by type/state
  - alert delivery failures by channel/status
  - media scan jobs by status/scan result
  - scan archive candidates
  - scan history pruned count
  - worker job success/failure/duration
  - rate-limit exceeded counts
- Gate exporter exposure with env configuration:
  - `METRICS_EXPORTER_ENABLED`
  - `METRICS_EXPORTER_FORMAT=prometheus|otlp`
  - `METRICS_EXPORTER_TOKEN` or network-only guidance
- Keep sensitive metadata out of exported labels.

Exit criteria:

- Operators can scrape or export core health signals without using the Admin UI.
- Exported metrics do not expose secrets, user PII, raw request bodies, or tokens.

Validation:

- Metrics endpoint/exporter tests.
- Label-safety tests for representative events.
- Runbook examples for scrape configuration.

### 5. Multi-Instance Runbook And Smoke Updates

Goal: make deployment operations repeatable.

Recommended scope:

- Update `docs/OPERATIONS_RUNBOOK.md` with:
  - API vs worker process responsibilities
  - recommended process counts
  - rate-limit Redis configuration
  - lease failure triage
  - metrics scrape/export setup
  - rollback steps
- Update `docs/GITHUB_ENVIRONMENT.md` with new secrets/vars.
- Update `docs/RELEASE_CHECKLIST.md` for multi-instance rollout.
- Update production smoke checks for Redis and metrics config where enabled.

Exit criteria:

- A new operator can deploy API and worker processes, configure shared operational state, monitor health, and roll back safely.

Validation:

- `npm run check:deploy`
- `npm run check:deploy:env` in a real configured environment
- Manual staging rehearsal for API + worker + shared store

## Recommended First Implementation Slice

Start with **Shared Rate-Limit Store**.

Reasoning:

- The existing rate limiter already has the cleanest extension seam: an async injected store with `increment()`.
- `RATE_LIMIT_STORE` already exists in env validation, but only accepts `memory`.
- This slice unlocks horizontally scaled API instances without forcing worker topology changes first.
- It can be tested without a real Redis server by using a fake Redis client around the store contract, then validated in staging with real Redis.

Suggested first PR scope:

1. Add rate-limit store factory.
2. Add Redis-compatible store implementation.
3. Add Redis env validation and safe config projection.
4. Wire production server startup to use the configured store.
5. Add tests for memory parity, Redis command behavior, env validation, and failure policy.
6. Update README, GitHub Environment docs, and production smoke checks.

Non-goals for first PR:

- Worker process extraction.
- Metrics exporter.
- New frontend work.
- Track C provider work.

## Quality Gate

Every Track B PR should pass:

```bash
npm run check:deploy
```

For deployment configuration changes, also run:

```bash
npm run check:deploy:env
```

When Redis or worker infrastructure is introduced, staging should also include a manual multi-instance rehearsal before production rollout.
