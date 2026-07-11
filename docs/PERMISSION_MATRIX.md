# Permission Matrix

This document tracks the current productization phase 2 authorization surface. It is meant for implementation review, not long-term role design only. `npm run test:contracts` verifies the protected backend route table against server route registrations and OpenAPI paths.

## Permission Catalog

The executable fallback role defaults live in `server/src/auth/permissions.js`. Demo users derive their `permissions` array from that module. Prisma-backed accounts read role grants from the `permissions` and `role_permissions` tables seeded from the same policy, then fall back to the code defaults if a role has not been configured yet. Route guards and repository ownership checks continue to use one permission vocabulary through `requirePermission` / `hasPermission`.

| Permission | Purpose | Current backend guard | Current frontend guard |
| --- | --- | --- | --- |
| `task:create` | Create marketplace tasks and convert content into tasks | `POST /api/tasks`, `POST /api/posts/:id/convert-to-task`, `POST /api/library/items/:id/convert-to-task` | Publish task, convert community post to task |
| `task:propose` | Submit task proposals | `POST /api/tasks/:id/proposals` | Not guarded yet |
| `task:claim` | Claim an open task | `POST /api/tasks/:id/claim` | Claim task |
| `task:submit` | Submit task deliverables | `POST /api/tasks/:id/submissions` | Submit work |
| `task:review` | Approve/reject task submissions and proposals | `POST /api/tasks/:id/review`, `POST /api/tasks/:id/proposals/:proposalId/actions` | Approve task, reject task |
| `task:moderate` | Moderate tasks at operations level | Repository-level roadmap checks only | Not guarded yet |
| `post:create` | Create community posts | `POST /api/posts` | Not guarded yet |
| `post:moderate` | Moderate posts and reports | Repository-level checks for conversions/moderation ownership | Not guarded yet |
| `comment:create` | Create community comments | `POST /api/posts/:id/comments` | Not guarded yet |
| `points:read` | Read points ledger | `GET /api/points/ledger`; task approval writes settlement ledger entries | Not guarded yet |
| `points:adjust` | Search/export user ledgers, adjust points, submit high-value adjustments for review, read point policy/history, and approve points queue reviews | `GET /api/admin/points/ledger`, `GET /api/admin/points/ledger.csv`, `GET /api/admin/points/policy`, `GET /api/admin/points/policy/history`, `POST /api/admin/points/adjustments`; also permits `userHandle` lookup on `GET /api/points/ledger`; required with `admin:queue:review` for `points` queue decisions | Admin Finance tab visibility and actions |
| `admin:access` | Access operations/admin shell | Not a data route guard | Admin navigation visibility |
| `admin:audit:read` | Read privileged audit events and read-only operations history | `GET /api/admin/audit`, `GET /api/admin/audit/:id`, `GET /api/admin/audit/export`, `GET /api/admin/creative/generations`, `GET /api/admin/creative/generations/:id` | Admin page audit API load, deep-link lookup, JSON export, and read-only creative generation history |
| `admin:queue:read` | Read admin review queues | `GET /api/admin/reviews`, `GET /api/media/review-queue` | Admin review queue and media governance API loads |
| `admin:queue:review` | Perform admin review actions | `POST /api/admin/reviews/:id/actions`, `POST /api/media/uploads/:id/scan` | Admin queue and media approve/reject buttons |
| `admin:permissions:manage` | Edit role permission grants and point policy | `PUT /api/admin/roles/:role/permissions`, `PUT /api/admin/points/policy`, `POST /api/admin/points/policy/rollback` | Admin permission matrix edit/save controls; point policy save/rollback |

## Planned Creative Generation Mutation Permissions

These permissions are proposed for a future real-provider phase and are not executable yet. Admin generation history remains read-only under `admin:audit:read`; future mutation controls must not reuse read-only audit access, media queue review access, or point adjustment access.

| Proposed permission | Future purpose | Planned actions |
| --- | --- | --- |
| `admin:creative:retry` | Controlled retry after retryable provider failure or timeout | Retry generation |
| `admin:creative:cancel` | Stop queued/running provider work where cancellation is supported | Cancel generation |
| `admin:creative:review` | Move completed generated output into manual review without accounting changes | Force review |
| `admin:creative:credits:adjust` | Apply internal creative-credit refunds/corrections | Refund creative credits |
| `admin:creative:settlement:manage` | Resolve stuck provider/accounting states | Manual settlement |

The full requirements, audit metadata, notification inventory, idempotency rules, and rollback semantics live in `docs/REAL_PROVIDER_ADMIN_MUTATION_REQUIREMENTS.md`.

## Demo Accounts

| Handle | Role | Permissions | Primary test use |
| --- | --- | --- | --- |
| `taskops` | `member` | `task:create`, `post:create`, `comment:create`, `points:read` | Task creation, post/library conversion success |
| `launchteam` | `publisher` | `task:create`, `task:review`, `post:create`, `comment:create`, `points:read` | Publisher review flow |
| `promptlin` | `creator` | `task:propose`, `task:claim`, `task:submit`, `post:create`, `comment:create`, `points:read` | Claim/submit/comment success, task creation denial |
| `legalpixel` | `moderator` | `task:moderate`, `post:moderate`, `admin:access`, `admin:audit:read`, `admin:queue:read`, `admin:queue:review`, `post:create`, `comment:create`, `points:read` | Admin access without full admin role |
| `opsplus` | `admin` | All current permissions | Admin audit and full privileged flow |
| `finops` | `admin` | All current permissions | Second approver for high-value point adjustment review |

## Frontend Guards

The frontend currently checks permissions in `src/App.tsx` before triggering high-risk actions:

| User action | Required permission | Behavior when missing |
| --- | --- | --- |
| Publish task | `task:create` | Opens login modal and logs a toast |
| Convert community post to task | `task:create` | Opens login modal and logs a toast |
| Claim task | `task:claim` | Opens login modal and logs a toast |
| Submit task work | `task:submit` | Opens login modal and logs a toast |
| Approve task | `task:review` | Opens login modal and logs a toast |
| Reject task | `task:review` | Opens login modal and logs a toast |
| Open admin center navigation | `admin:access` | Hides admin nav entry |
| Edit role permissions | `admin:permissions:manage` | Shows edit/save controls in permission matrix |
| Search/export/admin-adjust point ledgers | `points:adjust` | Shows Admin Finance tab, adjustment/export controls, policy view, and point approval filter |
| Edit point adjustment policy | `admin:permissions:manage` | Enables point policy save |
| Record current policy consent | Authenticated account | First-use consent gate blocks normal UI until exact current versions are accepted |
| Submit or track a support request | Authenticated account | Support center opens login and backend enforces request ownership |

Frontend guards are UX helpers only. Backend route guards remain the source of truth.

## Backend Route Guards

| Route | Auth requirement | Permission requirement | Covered by tests |
| --- | --- | --- | --- |
| `POST /api/tasks` | Required | `task:create` | Yes |
| `POST /api/tasks/:id/claim` | Required | `task:claim` | Yes |
| `GET /api/tasks/:id/proposals` | Required | Resource-level visibility | Yes |
| `POST /api/tasks/:id/proposals` | Required | `task:propose` | Yes |
| `POST /api/tasks/:id/proposals/:proposalId/actions` | Required | `task:review` plus owner/admin check | Yes |
| `POST /api/tasks/:id/submissions` | Required | `task:submit` | Yes |
| `GET /api/tasks/:id/submissions` | Required | Resource-level visibility | Yes |
| `POST /api/tasks/:id/review` | Required | `task:review` | Yes |
| `POST /api/posts` | Required | `post:create` | Yes |
| `POST /api/posts/:id/comments` | Required | `comment:create` | Yes |
| `POST /api/posts/:id/like` | Required | Any authenticated user | Yes |
| `DELETE /api/posts/:id/like` | Required | Any authenticated user | Yes |
| `POST /api/posts/:id/convert-to-task` | Required | `task:create` | Yes |
| `POST /api/library/items` | Required | Any authenticated user | Yes |
| `POST /api/library/items/:id/convert-to-task` | Required | `task:create` | Yes |
| `POST /api/library/items/:id/send-to-workspace` | Required | Any authenticated user | Yes |
| `POST /api/creative/generations` | Required | Any authenticated user | Yes |
| `POST /api/creative/providers/replicate/callback/:generationId` | Provider callback | Timestamped HMAC, generation/job nonce, staging kill switch | Yes |
| `GET /api/compliance/consent` | Required | Any authenticated user; consent record scoped to actor | Yes |
| `POST /api/compliance/consent` | Required | Any authenticated user; exact current policy versions required | Yes |
| `GET /api/support/requests` | Required | Any authenticated user; owner-scoped | Yes |
| `POST /api/support/requests` | Required | Any authenticated user; safe-field validation | Yes |
| `GET /api/support/requests/:id` | Required | Any authenticated user; owner-scoped | Yes |
| `GET /api/points/ledger` | Required | `points:read` | Yes |
| `GET /api/admin/points/ledger` | Required | `points:adjust` | Yes |
| `GET /api/admin/points/ledger.csv` | Required | `points:adjust` | Yes |
| `GET /api/admin/points/policy` | Required | `points:adjust` | Yes |
| `GET /api/admin/points/policy/history` | Required | `points:adjust` | Yes |
| `PUT /api/admin/points/policy` | Required | `admin:permissions:manage` | Yes |
| `POST /api/admin/points/policy/rollback` | Required | `admin:permissions:manage` | Yes |
| `POST /api/admin/points/adjustments` | Required | `points:adjust` | Yes |
| `GET /api/admin/operations/metrics` | Required | `admin:audit:read` | Yes |
| `GET /api/admin/operations/metrics/export` | Required | `admin:audit:read` | Yes |
| `GET /api/notifications` | Required | Any authenticated user; recipient-scoped | Yes |
| `POST /api/notifications/:id/read` | Required | Any authenticated user; recipient ownership enforced | Yes |
| `POST /api/notifications/read-all` | Required | Any authenticated user; recipient ownership enforced | Yes |
| `GET /api/media/review-queue` | Required | `admin:queue:read` | Yes |
| `GET /api/media/scan-jobs` | Required | `admin:queue:read` | Yes |
| `GET /api/media/scan-jobs/archive` | Required | `admin:queue:read` | Yes |
| `POST /api/media/scan-jobs/archive` | Required | `admin:queue:review` | Yes |
| `GET /api/media/governance-config` | Required | `admin:queue:read` | Yes |
| `PUT /api/media/governance-policy` | Required | `admin:permissions:manage` | Yes |
| `GET /api/media/governance-policy/history` | Required | `admin:queue:read` | Yes |
| `POST /api/media/governance-policy/rollback` | Required | `admin:permissions:manage` | Yes |
| `GET /api/media/scan-alerts` | Required | `admin:queue:read` | Yes |
| `GET /api/media/scan-alerts/:id/events` | Required | `admin:queue:read` | Yes |
| `POST /api/media/scan-alerts/:id/acknowledge` | Required | `admin:queue:review` | Yes |
| `POST /api/media/scan-alerts/:id/silence` | Required | `admin:queue:review` | Yes |
| `POST /api/media/scan-alerts/:id/unsilence` | Required | `admin:queue:review` | Yes |
| `GET /api/media/uploads/:id/scan-jobs` | Required | `admin:queue:read` | Yes |
| `POST /api/media/scan-jobs/sweep` | Required | `admin:queue:review` | Yes |
| `POST /api/media/uploads` | Required | Any authenticated user | Yes |
| `POST /api/media/uploads/:id/complete` | Required | Owner or `admin:access` | Yes |
| `POST /api/media/uploads/:id/scan` | Required | `admin:queue:review` | Yes |
| `POST /api/media/uploads/:id/scan-callback` | Not required | `x-media-scan-secret` must match `MEDIA_SCAN_WEBHOOK_SECRET`; optional timestamped HMAC when configured | Yes |
| `POST /api/media/uploads/:id/scan-retry` | Required | `admin:queue:review` | Yes |
| `GET /api/media/assets/:id/download` | Required | Owner or `admin:access`; asset must be uploaded and clean | Yes |
| `GET /api/admin/permissions` | Required | `admin:audit:read` | Yes |
| `GET /api/admin/roles` | Required | `admin:audit:read` | Yes |
| `PUT /api/admin/roles/:role/permissions` | Required | `admin:permissions:manage` | Yes |
| `GET /api/admin/reviews` | Required | `admin:queue:read` | Yes |
| `POST /api/admin/reviews/:id/actions` | Required | `admin:queue:review` | Yes |
| `GET /api/admin/audit` | Required | `admin:audit:read` | Yes |
| `GET /api/admin/audit/export` | Required | `admin:audit:read` | Yes |
| `GET /api/admin/audit/:id` | Required | `admin:audit:read` | Yes |
| `GET /api/admin/creative/generations` | Required | `admin:audit:read` | Yes |
| `GET /api/admin/creative/generations/:id` | Required | `admin:audit:read` | Yes |

## Repository-Level Ownership Checks

Some authorization rules require resource context and are enforced below the route layer:

| Resource action | Rule |
| --- | --- |
| Submit task | Actor must be the assignee when one exists, unless `admin:access` applies |
| List task proposals | Publisher/admin can view all proposals; proposers can view their own proposals |
| Accept/reject task proposal | Actor must be the publisher unless `admin:access` applies; accepting assigns the task to the proposer |
| Complete media upload | Actor must own the media asset unless `admin:access` applies |
| Create media download contract | Actor must own the media asset unless `admin:access` applies; asset must be uploaded and scan-clean |
| List task submissions | Publisher, assignee, or `admin:access` can view normalized submissions |
| Review task | Actor must be the publisher unless `admin:access` applies; approval creates an idempotent settled point ledger entry for the assignee or latest submitter |
| Convert post to task | Actor must own the post, have `post:moderate`, or have `admin:access` |
| Convert library item to task | Actor must own the item or have `admin:access` |
| Send library item to workspace | Actor must own the item or have `admin:access` |

The seed repository and Prisma repository now enforce the same high-risk ownership rules for task submit/review, post conversion, and library conversion/workspace actions.

## Test Coverage Snapshot

| Area | Coverage |
| --- | --- |
| Request parsers | Success, defaults, enum failure, invalid scalar/array failures, list query parsing |
| Task list/create routes | Pagination, filtering, invalid limit, missing auth, missing permission, validation failure, success envelope |
| Task claim route | Missing permission, success envelope |
| Task proposal route | Missing permission, validation failure, pagination, publisher visibility, accept/reject actions, assign-on-accept, success envelope |
| Task submission route | Missing permission, validation failure, assignee ownership denial, normalized list visibility, success envelope |
| Task review route | Missing permission, validation failure, publisher ownership denial, admin bypass, normalized submission review state update, reward settlement, rejection without settlement, success envelope |
| Community comments route | Missing auth, validation failure, success envelope |
| Post list/create routes | Pagination, filtering, invalid limit, missing auth, validation failure, success envelope |
| Post like route | Missing auth, success envelope |
| Post unlike route | Success envelope |
| Post-to-task route | Missing permission, owner success, ownership denial, admin bypass |
| Library save route | Missing auth, validation failure, success envelope |
| Library list route | Pagination, filtering, invalid limit |
| Library-to-task route | Missing permission, owner success, ownership denial, admin bypass |
| Library send-to-workspace route | Missing auth, not found, owner success, ownership denial, admin bypass |
| Creative provider routes | Safe capability catalog, missing auth, invalid mode validation, moderation block, quota exceeded, persisted mock generation output, media scan/download governance, policy review routing |
| Points ledger route | Missing auth, pagination, invalid limit, scoped summary envelope, privileged user lookup |
| Admin points routes | Missing permission, user/status/search filtering, summary envelope, low-value manual adjustment audit event, role limit review routing, self-approval denial, points queue permission guard, CSV export |
| Media upload route | Missing auth, validation failure, signed upload contract, owner completion, ownership denial, admin bypass, scan permission, clean download, rejected download block, review-queue filtering, scan-job filtering, webhook scanner callback, scan retry, scan sweep, scan notifications |
| Profile list/detail routes | Pagination, filtering, invalid limit, profile detail, not found |
| Auth routes | Login success/failure, refresh, logout |
| Admin review queue route | Missing auth, missing permission, moderator success envelope, pagination, filtering, invalid limit |
| Admin review action route | Missing permission, validation failure, not found, success envelope |
| Admin audit route | Missing auth, missing permission, admin success envelope, moderator success envelope, pagination and action filtering |
| Admin permission catalog route | Missing auth, missing permission, success envelope |
| Admin role permission route | Read matrix, missing management permission, invalid permission validation, protected admin grant validation, unknown role, success update |

## Next Gaps

- Add end-to-end browser coverage for the editable permission matrix.
- Add frontend typed service integration for proposal/submission workflows.
