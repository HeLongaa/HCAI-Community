# Phase 3 Plan

Phase 2 closed the API, auth/session, authorization, admin operations, media governance, and deployment-readiness baseline. Phase 3 should avoid reopening that broad foundation unless a production blocker is found.

## Recommendation

Start Phase 3 with **Marketplace Depth** as the primary product track.

Reasoning:

- The strongest product loop is publisher request -> creator proposal -> delivery -> review -> points settlement.
- Phase 2 already built the technical foundation for tasks, proposals, submissions, media assets, notifications, audit, and Admin review.
- Marketplace depth improves the core user value before adding expensive creative-provider integrations.

## Scope Decision

Phase 3 is an umbrella plan with Tracks A, B, and C. Track A and Track B are now closed out in the repository. Track C is now the active planning track for replacing selected simulated creative outputs with provider-backed generation.

Current closeout target:

1. Keep Track A marketplace depth stable.
2. Keep Track B production operations closed unless a deployment blocker is found.
3. Complete Track C creative provider productization in scoped, reviewable slices.
4. Keep each remaining Phase 3 PR green on `npm run check:deploy`.

Track A closeout notes live in `docs/PHASE_3_TRACK_A_CLOSEOUT.md`.
Track B planning notes live in `docs/PHASE_3_TRACK_B_PLAN.md`.
Track B operations closeout notes live in `docs/PHASE_3_TRACK_B_OPERATIONS_CLOSEOUT.md`.
Track B multi-instance deployment runbook lives in `docs/PHASE_3_TRACK_B_MULTI_INSTANCE_RUNBOOK.md`.
Track C planning notes live in `docs/PHASE_3_TRACK_C_PLAN.md`.

## Phase 3 Tracks

### Track A: Marketplace Depth

Goal: make task delivery feel production-grade instead of a happy-path workflow.

Candidate scope:

- Revision requests before acceptance.
- Dispute flow for rejected or stale submissions.
- Acceptance criteria checklist at review time.
- Creator and publisher reputation updates after completion.
- Task timeline/audit view for participants.
- Notification coverage for revision, dispute, acceptance, rejection, and settlement events.

Exit criteria:

- A publisher can request changes instead of only approving/rejecting.
- A creator can resubmit against review notes.
- A task has a clear event history and participant-facing status.
- Points settlement remains idempotent and auditable.

Implementation order:

1. Revision requests and creator resubmission. Completed in `codex/phase-3-task-revisions`.
2. Participant-facing timeline/audit view. Completed in `codex/phase-3-task-revisions`.
3. Acceptance criteria checklist at review time. Completed in `codex/phase-3-task-revisions`.
4. Creator and publisher reputation updates after completion. Completed in `codex/phase-3-task-revisions`.
5. Dispute and stale-submission flow. Completed in `codex/phase-3-task-revisions`.
6. Notification coverage polish across revision, resubmission, acceptance, rejection, settlement, and dispute events. Completed in `codex/phase-3-task-revisions`.

### Track B: Production Operations

Goal: harden the platform for multi-instance and observable deployments.

Status: closed out for repository, fixture CI, and PR-ready handoff. Real environment validation is still required before a production rollout.

Completed scope:

- Shared Redis-compatible rate-limit store.
- Independent worker topology for scan sweeps and stale submission sweeps.
- Distributed worker job leases for mutating recurring jobs.
- Prometheus-compatible `/metrics` endpoint with token/network protection guidance.
- Deployment runbook updates for multi-instance operation.

Exit criteria:

- Stateless app instances can share abuse guards and background work safely.
- Operators can observe auth, scan, queue, and alert health outside the app UI.
- Operators have a repeatable multi-instance deployment, staging rehearsal, and rollback guide.

Deferred operations follow-ups:

- Real `npm run check:deploy:env` after deployment secrets and managed services are configured.
- First real staging rehearsal with multiple API and worker instances.
- OpenTelemetry/OTLP export or vendor-specific dashboard templates if needed.

### Track C: Creative Tool Productization

Goal: replace remaining simulated creative outputs with provider-backed generation and persisted assets.

Status: active planning track. The first recommended implementation slice is a provider abstraction and mock provider boundary, not a direct paid-provider integration.

Candidate scope:

- Provider abstraction for image/video/music/chat generation.
- Generated asset persistence through media uploads/storage.
- Cost, quota, and moderation boundaries.
- Admin review for generated outputs when required.
- Runtime labels for provider-backed, mock-provider, demo, and catalog outputs.

Exit criteria:

- At least one creative workspace produces a real stored output through a provider adapter.
- Runtime data-source labels clearly distinguish provider-backed outputs from demo/catalog content.

Recommended implementation order:

1. Planning and task inventory.
2. Creative provider abstraction.
3. Generated asset persistence.
4. First workspace provider integration, with Image Studio recommended first.
5. Cost, quota, and moderation boundaries.
6. Track C closeout.

## Recommended First Slice

Implement the Track C provider abstraction and mock provider boundary.

Suggested scope:

1. Add provider registry and capability metadata.
2. Add generation request/response contracts.
3. Add mock provider adapter.
4. Add safe provider config projection.
5. Add backend tests.
6. Keep generated asset persistence and real provider credentials for later slices.

Non-goals:

- Direct paid-provider integration.
- Full generated asset persistence.
- Cost/quota/moderation enforcement beyond placeholder metadata.
- New visual redesign.

## Quality Gate

Every Phase 3 PR should pass:

```bash
npm run check:deploy
```

For deployment changes, also run:

```bash
npm run check:deploy:env
```
