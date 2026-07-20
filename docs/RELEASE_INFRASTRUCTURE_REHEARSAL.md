# Release Infrastructure Rehearsal

`RELEASE-01` turns the PostgreSQL, Redis, and S3 release checklist into an executable isolated rehearsal. It never targets an application production database directly. Both source and restore database names must contain `rehearsal`, must differ, and use the dedicated object and Redis namespaces frozen in `config/release-infrastructure-rehearsal-contract.json`.

## Local Rehearsal

Run:

```bash
npm run test:release-infrastructure
npm run release:infrastructure:rehearse
```

The local command starts pinned PostgreSQL 16, Redis 7 with AOF, and MinIO S3 containers. It applies every Prisma migration with `migrate deploy`, verifies permission seeds, writes a marker, creates a custom-format `pg_dump`, uploads the dump to the backup bucket, removes the local dump, downloads and checksum-verifies the backup, and restores it into a separate database.

The same run writes and synchronously persists a Redis marker, restarts Redis, and verifies recovery. It also writes an object to the primary bucket, copies its bytes to the backup bucket, deletes the primary object, restores it, and verifies the SHA-256 checksum. Containers and volumes are removed after the run unless `--keep` is supplied directly to the runner.

Sanitized evidence is written below `.artifacts/release-infrastructure/`, which is excluded from Git. Evidence contains service labels, counts, durations, content hashes, objective results, and a SHA-256 receipt. It rejects secret-shaped fields recursively.

## RTO And RPO

The initial release objectives are:

| Objective | Maximum |
| --- | ---: |
| Overall rehearsal RTO | 900 seconds |
| PostgreSQL restore RTO | 600 seconds |
| Redis recovery RTO | 120 seconds |
| Object restore RTO | 300 seconds |
| Cross-service RPO | 300 seconds |

The rehearsal records zero data-loss seconds only when the exact database, Redis, and object marker hashes survive their respective recovery paths. Any missing marker, checksum mismatch, failed check, exceeded objective, oversized evidence, or receipt mismatch fails the command.

## Target Environment

Target environment resources must be dedicated rehearsal resources in the same managed infrastructure boundary as the intended release. Never point these variables at the live application database or bucket.

Required values:

```text
RELEASE_REHEARSAL_CONFIRMATION=release-01-isolated-rehearsal
RELEASE_REHEARSAL_DATABASE_URL=postgresql://.../source_rehearsal
RELEASE_REHEARSAL_RESTORE_DATABASE_URL=postgresql://.../restore_rehearsal
RELEASE_REHEARSAL_REDIS_URL=rediss://...
RELEASE_REHEARSAL_REDIS_RECOVERY_COMMAND_JSON=["aws", "elasticache", "reboot-cache-cluster", ...]
STORAGE_ENDPOINT=https://...
STORAGE_REGION=...
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
RELEASE_REHEARSAL_PRIMARY_BUCKET=...
RELEASE_REHEARSAL_BACKUP_BUCKET=...
```

The Redis recovery command is executed without a shell and only accepts `aws`, `az`, `docker`, `gcloud`, `kubectl`, or `redis-cli` as the executable. Its target arguments must contain `rehearsal`, and credential-shaped arguments are rejected; credentials must come from the protected environment. Arguments are never written to evidence. Both S3 bucket names must also contain `rehearsal` and must differ.

Run the fail-closed preflight before any mutation:

```bash
npm run release:infrastructure:preflight
```

After reviewing its safe summary and entering an approved release window, run:

```bash
npm run release:infrastructure:rehearse:env
```

The GitHub Actions `Quality Gates` workflow exposes the same operation through `smoke_profile=infrastructure-rehearsal` and a protected GitHub Environment. The job uploads only `latest.json` sanitized evidence for 30 days.

## Production Boundary

Local Docker evidence proves the executable recovery path, migration compatibility, and evidence controls. It does not prove a production provider's backup schedule, cross-zone failover, access policy, or actual target-environment latency. `RELEASE-01` remains incomplete until the protected target-environment workflow succeeds and an operator reviews the resulting receipt.

For account deletion, production backup expiry receipts remain separate from this infrastructure rehearsal. RELEASE-01 supplies the backup inventory and recovery evidence needed to execute that lifecycle without claiming that a specific user's backup expiry has occurred.
