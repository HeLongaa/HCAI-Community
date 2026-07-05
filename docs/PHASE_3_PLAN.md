# Phase 3 Plan

Phase 2 closed the API, auth/session, authorization, admin operations, media governance, and deployment-readiness baseline. Phase 3 should avoid reopening that broad foundation unless a production blocker is found.

## Recommendation

Start Phase 3 with **Marketplace Depth** as the primary product track.

Reasoning:

- The strongest product loop is publisher request -> creator proposal -> delivery -> review -> points settlement.
- Phase 2 already built the technical foundation for tasks, proposals, submissions, media assets, notifications, audit, and Admin review.
- Marketplace depth improves the core user value before adding expensive creative-provider integrations.

## Scope Decision

Phase 3 is an umbrella plan with Tracks A, B, and C, but the first Phase 3 implementation and closeout package should complete **Track A: Marketplace Depth** only.

Track B and Track C remain Phase 3 roadmap candidates, but they are explicitly deferred from the current closeout package unless Track A exposes a production blocker that must be fixed first.

Current closeout target:

1. Complete Track A end to end.
2. Keep Track B production operations as a follow-up track.
3. Keep Track C creative provider productization as a follow-up track.
4. Do not open the Phase 3 PR until Track A is complete and `npm run check:deploy` is green.

Track A closeout notes live in `docs/PHASE_3_TRACK_A_CLOSEOUT.md`.

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

Candidate scope:

- Shared rate-limit store such as Redis.
- Worker/queue topology for scan sweeps and alert dispatch.
- Prometheus or OpenTelemetry exporters.
- Deployment runbook updates for multi-instance operation.

Exit criteria:

- Stateless app instances can share abuse guards and background work safely.
- Operators can observe auth, scan, queue, and alert health outside the app UI.

### Track C: Creative Tool Productization

Goal: replace remaining simulated creative outputs with provider-backed generation and persisted assets.

Candidate scope:

- Provider abstraction for image/video/music/chat generation.
- Generated asset persistence through media uploads/storage.
- Cost, quota, and moderation boundaries.
- Admin review for generated outputs when required.

Exit criteria:

- At least one creative workspace produces a real stored output through a provider adapter.
- Runtime data-source labels clearly distinguish provider-backed outputs from demo/catalog content.

## Recommended First Slice

Implement a revision loop for task submissions.

Suggested scope:

1. Add `revision_requested` state to normalized submissions.
2. Add a publisher review action that records requested changes without settling points.
3. Allow the creator to submit a revised delivery.
4. Show revision notes and submission history in My Tasks.
5. Notify creator/publisher on revision request and resubmission.
6. Add backend tests and one browser E2E covering approve-after-revision.

Non-goals:

- Full dispute arbitration.
- External creative-provider integration.
- Multi-instance worker infrastructure.
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
