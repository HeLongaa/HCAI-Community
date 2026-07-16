# Configuration Resource Domains

CONFIG-02 separates runtime configuration, feature flag definitions, reference data, and announcements without introducing tenant or organization scope.

## Domain boundaries

- Runtime configuration remains in `SystemSetting`. It keeps the SET-01 preview, two-person approval, publish, and rollback workflow.
- Feature flags publish into `FeatureFlag` with a stable key, default enabled state, opaque product payload, and the SET-02 rollout extension.
- Reference data publishes into `ReferenceDataEntry` with a label, value, sort order, and active state.
- Announcements publish into `Announcement` with body, severity level, optional schedule, and active state.
- Feature flag audience rules, percentage rollout, runtime evaluation, and emergency override are implemented by SET-02 and documented in `docs/FEATURE_FLAG_ROLLOUT.md`.

Each managed kind has separate read, manage, and publish permissions. A moderator receives read access; an administrator receives all operations.

## Lifecycle

`ConfigResource` is the shared governance envelope. Managed resources start as drafts. Draft updates use the row `version` as an optimistic concurrency token. Publishing copies the draft into the kind-specific projection, increments `publishedVersion`, creates an immutable `ConfigResourceRevision`, and records audit evidence in one transaction.

Rollback never edits a previous revision. It publishes a new revision from the selected immutable snapshot. Removal writes `deletedAt` and `deletedByRef` on the governance envelope and mirrors the tombstone to the kind-specific projection in one transaction. Restore clears both tombstones with another version check. Up to 100 resources can be soft-deleted atomically.

Reference data supports portable JSON export and atomic import. Import accepts at most 100 entries. New keys omit `expectedVersion`; updates must include the current version. The complete document is validated before any draft is written.

The database rejects updates and deletes against `config_resource_revisions` unless an explicit maintenance session flag is enabled.

## Kind schemas

Feature flag:

```json
{
  "enabled": false,
  "payload": {},
  "rules": [],
  "rolloutPercentage": null,
  "rolloutSeed": "v1"
}
```

Reference data:

```json
{ "label": "China", "value": "CN", "sortOrder": 10, "active": true }
```

Announcement:

```json
{
  "body": "Planned maintenance.",
  "level": "warning",
  "startsAt": "2026-07-18T00:00:00.000Z",
  "endsAt": "2026-07-18T02:00:00.000Z",
  "active": true
}
```

Unknown fields are rejected. Announcement end time must be after start time. Keys use lowercase letters, numbers, dots, slashes, underscores, and hyphens.

## Verification

Run:

```bash
npm run test:config-resource-domains
npm run test:config-resource-domains:integration
```

The integration suite requires `TEST_DATABASE_URL` or `DATABASE_URL`. It validates the complete migration chain, transactional publication, concurrent version rejection, rollback, soft deletion, and immutable revision triggers.
