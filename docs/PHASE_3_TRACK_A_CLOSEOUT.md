# Phase 3 Track A Closeout

This document closes the current Phase 3 implementation slice: **Track A, Marketplace Depth**.

Phase 3 remains an umbrella roadmap with Track B production operations and Track C creative tool productization, but this closeout package is intentionally limited to the task marketplace workflow. The goal is to make the publisher-to-creator delivery loop usable beyond the original happy path while keeping deferred operational and provider-backed work explicit.

## Closeout Position

Track A is implementation-complete on `codex/phase-3-task-revisions`.

Completed local slices:

1. Revision requests and creator resubmission.
2. Participant-facing task timeline.
3. Acceptance checklist at review time.
4. Creator and publisher reputation updates on completion.
5. Dispute and stale-submission flow.
6. Notification coverage polish across task lifecycle events.

The branch should remain scoped to Marketplace Depth. Track B and Track C items should not be pulled into the Track A PR unless they are required to fix a production blocker exposed by Track A.

## Usable Main Workflow

The following marketplace flow is now the primary user path that should be considered usable for product review.

### Publisher Creates A Task

- Publisher creates a task with title, category, brief, reward, deadline, visibility, attachments, and acceptance guidance.
- Task creation records a pending publisher escrow ledger entry for the reward.
- Task attachment uploads can go through the existing media upload contract and scan/governance flow.

### Creator Proposes

- Creator submits a normalized proposal through the task proposal API.
- Publisher receives a task proposal notification that routes to the task workspace.
- The creator can see proposed or assigned work from My Tasks.

### Publisher Selects A Proposal

- Publisher accepts or rejects proposals.
- Accepting a proposal assigns the creator and moves the task into the delivery path.
- Other pending proposals can be auto-rejected when a proposal is accepted.
- Proposal decision notifications are sent to proposers.

### Creator Submits Delivery

- Creator submits delivery content, result links, rights notes, and optional submission assets.
- Publisher receives a submission-ready notification.
- My Tasks displays normalized submission records and related review state.

### Publisher Reviews With Checklist

- Publisher reviews the submission with an acceptance checklist.
- Approval requires all checklist items to be checked.
- Review metadata is stored for task, submission, audit, and notification context.

### Publisher Requests Changes

- Publisher can request changes instead of approving or rejecting.
- The submission moves to `revision_requested`.
- Points escrow is not settled or released.
- Creator receives review notes and can submit a revised delivery.
- Resubmission notifies the publisher and keeps the workflow auditable.

### Publisher Approves

- Approval completes the task.
- Publisher escrow and creator reward settlement happen idempotently.
- Creator receives a reward-settled notification with a points-page target.
- Creator reputation is updated by `completed +1` and `score +10`.
- Publisher reputation is updated by `completed +1` and `score +6`.

### Publisher Rejects Or Submission Goes Stale

- Rejection releases or cancels the pending settlement path according to the existing points behavior.
- A moderator stale sweep can mark old pending-review submissions as stale.
- Rejected or stale submissions can be disputed by the creator.

### Creator Opens A Dispute

- Creator can open a dispute for a rejected or stale submission.
- The task/submission is marked disputed.
- An admin review item is created in the task dispute queue.
- Publisher/admin queue readers receive dispute context.
- Creator receives a dispute-received confirmation.

### Participants Track History

- Participants and admins can read the task timeline.
- Timeline entries are derived from audit events, with a synthetic creation fallback.
- My Tasks uses the timeline to make revisions, decisions, stale state, and disputes easier to inspect.

## User-Facing Capability Summary

| Area | Current capability | Status |
| --- | --- | --- |
| Task posting | Publisher can create tasks with structured reward, deadline, visibility, attachment, and acceptance fields | Usable |
| Proposal flow | Creator can propose; publisher can accept/reject; accepted proposal assigns the creator | Usable |
| Submission flow | Creator can submit work and assets through normalized submissions | Usable |
| Revision loop | Publisher can request changes and creator can resubmit | Usable |
| Acceptance gate | Publisher approval requires acceptance checklist completion | Usable |
| Reward settlement | Approval settles reward idempotently and updates ledger state | Usable |
| Reputation | Creator and publisher stats update on first final approval | Usable |
| Timeline | Participants/admins can inspect task lifecycle history | Usable |
| Dispute flow | Creator can dispute rejected/stale submissions and create admin review queue work | Usable foundation |
| Notifications | Task lifecycle events route users to My Tasks, Admin, or Points as appropriate | Usable |
| Browser coverage | Happy-path marketplace E2E exists; backend coverage is broader | Partial |
| Admin arbitration UX | Dispute queue item creation exists; deeper arbitration workflow can still be expanded | Partial |

## Still Simulated, Deferred, Or Follow-Up

These items are intentionally outside the Track A closeout boundary.

### Track B: Production Operations

- Track B was intentionally outside the Track A PR boundary.
- It has since shipped the shared Redis-compatible rate-limit store, independent worker topology, distributed job leases, Prometheus-compatible `/metrics`, and multi-instance deployment runbook.
- OpenTelemetry/OTLP export, vendor-specific dashboard templates, and real environment staging rehearsal remain separate operations follow-ups.

Current state: the repository has a horizontal-production operations baseline for fixture CI and PR-ready handoff. Real environment validation still requires deployment secrets and managed services.

### Track C: Creative Tool Productization

- Real provider-backed image, video, music, and chat generation.
- Generated asset persistence through media storage.
- Provider cost, quota, and moderation boundaries.
- Admin review flows for generated outputs.

Current state: creative workspaces and catalog surfaces still include demo, mock, or simulated content. Runtime labels should continue to distinguish API-backed/stored-session surfaces from demo or mock creative surfaces.

### Deployment Environment Validation

- Real `npm run check:deploy:env` is still environment-owned.
- Real OAuth provider credentials need staging/production validation.
- Real object storage, scanner callbacks, and alert delivery channels need staging/production smoke validation.
- Production database migration and rollback rehearsal still need target-environment execution.

Current state: fixture-based deployment checks are the safe local/CI gate. Environment validation requires managed secrets and external service configuration.

### Test Coverage Follow-Up

- Add browser E2E for dispute opening and admin queue inspection.
- Add browser E2E for stale submission sweep visibility.
- Add browser E2E for notification target routing across My Tasks, Admin, and Points.
- Add more rare-path ownership and pagination coverage.

Current state: backend route tests cover the task lifecycle more deeply than browser E2E. Browser coverage should grow after Track A closeout if runtime remains stable.

### API Contract Hardening

- Full OpenAPI response schemas are still deferred.
- Generated API clients are still deferred.

Current state: route coverage, summaries, permission matrix alignment, and API drift checks are in place.

## Verification

Current known Track A verification from the local branch:

- `npm --prefix server test -- src/modules/tasks/routes.test.js`
- `npm run check:quick`
- `npm --prefix server test`
- `npm run test:e2e`
- `npm run check:deploy`

Before opening or merging the Track A PR, run:

```bash
npm run check:deploy
```

If deployment configuration is changed or a real environment is being promoted, also run:

```bash
npm run check:deploy:env
```

## PR Boundary

The Track A PR should include:

- Task revision/resubmission behavior.
- Task timeline.
- Acceptance checklist gate.
- Reputation updates.
- Dispute and stale-submission flow.
- Task lifecycle notification polish.
- Documentation updates that explain the usable marketplace workflow and deferred boundaries.

The Track A PR should not include:

- Redis/shared rate-limit store work.
- Worker topology changes.
- Metrics exporter implementation.
- Provider-backed creative generation.
- Generated asset cost/quota systems.
- Broad visual redesign.

## Suggested Reviewer Focus

- Confirm revision requests do not settle points.
- Confirm approval-after-revision settles rewards exactly once.
- Confirm checklist enforcement does not block rejection or revision requests.
- Confirm reputation updates are idempotent.
- Confirm stale and dispute flows do not let unrelated users mutate tasks.
- Confirm notification targets route users to the right workflow surfaces.
- Confirm Track C or real-environment operations follow-ups are not hidden inside the Track A branch.
