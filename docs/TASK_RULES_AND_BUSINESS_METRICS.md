# Task Rules and Business Metrics

TASK-03 adds versioned task creation policy and business reporting to the personal-account task marketplace.

## Rule lifecycle

`task_rule` reuses the existing `ConfigResource` lifecycle: draft, publish, rollback, soft delete, and restore. Each publication creates an immutable `ConfigResourceRevision` and atomically refreshes the normalized `TaskRule` projection. Dedicated read, manage, and publish permissions separate inspection from mutation.

A rule owns one category, zero to twenty acceptance templates, and bounded minimum/default/maximum deadline hours. Task creation applies a published rule only to its matching category, allowing rules to roll out one category at a time. A configured inactive category, unknown template, or deadline outside the selected category range fails closed. Categories without a published rule remain compatible. The selected rule key, published version, and template id are retained in task and audit metadata.

## Product flow

Authenticated publishers read `GET /api/task-rules`. The publish form uses available categories and acceptance templates and sends an ISO deadline. A missing required deadline receives the published default. Custom acceptance text remains supported when no template is selected.

## Business metrics

`GET /api/admin/tasks/business-metrics` aggregates the full selected dataset in PostgreSQL and supports `dateFrom`, `dateTo`, and `category`. The response groups:

- funnel: published, proposal, assignment, submission, and completion conversion;
- deadlines: configured, overdue active, expired, and cancelled tasks;
- disputes: opened, resolved, resolution rate, and average resolution hours.

The date window is limited to 366 days when both bounds are supplied. `GET /api/admin/tasks/business-metrics/export` emits a versioned `task.business-metrics.snapshot` JSON document. Both reads require `admin:tasks:read` and record safe audit evidence.

## Boundaries

- Personal accounts only. No tenant, organization, team, workspace, membership, or invitation model is introduced.
- No Provider API, credential, paid traffic, or staging claim is part of TASK-03.
- Configuration revisions remain immutable and task rules are soft-deleted, never hard-deleted.
