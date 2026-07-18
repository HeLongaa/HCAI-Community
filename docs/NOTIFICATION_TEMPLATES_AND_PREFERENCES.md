# Notification Templates And Preferences

## Scope

NOTIFY-01 adds versioned templates, typed variable validation, personal in-app preferences, and an Admin operations surface. It remains personal-account scoped. External email, webhook, SMS, and Provider delivery belong to NOTIFY-02 and are deliberately unavailable here.

## Template Lifecycle

Each template has a stable lowercase key, category, lifecycle status, active version number, and optimistic `version`. Creating or editing a template appends a draft `NotificationTemplateVersion`; previously published content is never edited. Publishing promotes one draft and supersedes the previous active version. Rollback repoints the active version to a version that has prior publication evidence. Archive is a soft delete and restore preserves all versions.

Title and body placeholders use `{{variableName}}`. The closed schema supports bounded `string`, `number`, and `boolean` values, rejects undeclared variables, rejects unknown runtime values, and requires every required variable to be referenced. Preview and send-test execute the same renderer.

## User Preferences

`GET /api/notifications/preferences` returns explicit overrides. An absent type defaults to enabled. `PUT /api/notifications/preferences/{type}` creates an override with `expectedVersion: null` or updates it with the current optimistic version. All shared seed and Prisma notification creation helpers load the recipient's exact-type preference before dedupe and persistence, so task, points, media, security, and Provider lifecycle producers inherit the same behavior.

## Admin Operations

- `admin:notifications:read`: list/detail, filters, metrics, preview, and bounded JSON/CSV export.
- `admin:notifications:manage`: create, append draft version, archive, and restore.
- `admin:notifications:publish`: publish, rollback, and send a rendered test notification.

Admin list filters are status, category, bounded search, and deleted inclusion; sorting is limited to key, creation time, and update time. Export is capped at 100 rows. Mutations use CAS, stable reason codes, and sanitized audit metadata. Notification rows record `templateKey` and `templateVersion`, not template variables or secret material.

## Recovery And Failure

Schema and variable errors fail before persistence. Duplicate keys return `RESOURCE_CONFLICT`; stale template or preference writes return `STATE_CONFLICT`; publish without a draft and rollback to a never-published version fail closed. Sending a test to a disabled preference returns `NOTIFICATION_PREFERENCE_DISABLED` without bypassing the user's setting. Existing legacy notification payload producers remain supported while gaining preference enforcement.

## Verification

Run `npm run test:notification-templates-preferences` for the machine contract, domain tests, and route lifecycle coverage. With local PostgreSQL configured as `FOUNDATION_DATABASE_URL`, run `npm run test:notification-templates-preferences:integration` for serializable concurrency, immutable version, rollback, preference suppression, delivery evidence, and audit coverage.
