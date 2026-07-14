# V1-64 Task Marketplace Lifecycle

V1-64 closes the internal task marketplace lifecycle from publishing through proposal selection, delivery, revision, acceptance, rejection, stale review, dispute, and Admin resolution.

## Contract

- The server is the source of truth for task state and actor-specific actions.
- A creator may submit one proposal per task. Repeating the same proposal returns the existing record; changing it after creation is a conflict.
- Only one submission may be pending review. Repeating the same payload recovers the existing result; a different concurrent payload is a conflict.
- Review, stale sweep, dispute opening, and Admin resolution use conditional state transitions so duplicate or concurrent requests do not repeat ledger, notification, audit, reputation, or review side effects.
- Rejection keeps task escrow pending while revision or dispute remains possible. Acceptance settles escrow and the creator reward. A rejected dispute releases escrow exactly once.
- An approved dispute reopens the task for revision and keeps escrow pending.

The machine-readable contract is `config/v1-task-marketplace-lifecycle.json`. Run `npm run test:v1-task-marketplace` to validate its implementation wiring.

## Security

Publisher, creator, participant, and Admin reads and mutations are checked on the server. The workflow endpoint returns only an allowlisted role, state summary, and action list. Non-participants cannot use task child or timeline APIs to discover private proposal, submission, or dispute data.

## Product Boundary

Escrow and rewards are internal point ledger semantics. V1-64 does not implement RMB payment, withdrawal, KYC, invoices, merchant settlement, paid Provider traffic, or external notification delivery.
