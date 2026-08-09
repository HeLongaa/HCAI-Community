# Release Infrastructure Rehearsal

`RELEASE-01` turns the PostgreSQL, Redis, and S3 release checklist into an executable isolated rehearsal. It never targets an application production database directly. Both source and restore database names must contain `rehearsal`, must differ, and use the dedicated object and Redis namespaces frozen in `config/release-infrastructure-rehearsal-contract.json`.

## Local Rehearsal

Run:

```bash
npm run test:release-infrastructure
npm run release:infrastructure:rehearse
```

The local command starts pinned PostgreSQL 16, Redis 7 with AOF, and MinIO S3 containers. It applies every Prisma migration with `migrate deploy`, verifies permission seeds, writes a marker, creates a custom-format `pg_dump`, uploads the dump to the backup bucket, removes the local dump, downloads and checksum-verifies the backup, and restores it into a separate database.

The same run writes and synchronously persists a Redis marker, restarts Redis, and verifies recovery. It also writes an object to the primary bucket, copies its bytes to the backup bucket, deletes the primary object, restores it, and verifies the SHA-256 checksum. After recovery succeeds, the rehearsal simulates the 35-day expiry boundary: it deletes both the database and media backup objects, proves absence with HEAD, proves restore denial with GET, and removes the local restore copy. Containers and volumes are removed after the run unless `--keep` is supplied directly to the runner.

Sanitized evidence is written below `.artifacts/release-infrastructure/`, which is excluded from Git. Evidence contains service labels, counts, durations, content hashes, objective results, explicit `backupExpiry` results, and a SHA-256 receipt. A source section binds the HEAD commit, tracked-diff digest, untracked-file manifest digest, byte/count summaries, clean state, and one combined snapshot digest. Local runs may record `clean=false`; target-environment runs reject a dirty checkout before mutating infrastructure. Evidence rejects secret-shaped fields recursively. Local evidence keeps `targetScheduleVerified=false` and `managedKeyDestructionVerified=false`; those claims require protected target-environment evidence.

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

Target environment resources must be dedicated rehearsal resources in the same managed infrastructure boundary as the intended release. Never point these values at the live application database or bucket. The protected GitHub job reaches them through a forced-command SSH adapter, so database and storage credentials stay on the target host.

The protected GitHub Environment requires:

```text
RELEASE_REHEARSAL_CONFIRMATION=release-01-isolated-rehearsal
RELEASE_REHEARSAL_SSH_HOST=...
RELEASE_REHEARSAL_SSH_PORT=22
RELEASE_REHEARSAL_SSH_USER=newchat-deploy
RELEASE_REHEARSAL_SSH_INFRASTRUCTURE_COMMAND=/opt/newchat-staging/bin/rehearse-infrastructure
RELEASE_REHEARSAL_SSH_PRIVATE_KEY=...
RELEASE_REHEARSAL_SSH_KNOWN_HOSTS=...
```

The target host's protected `/opt/newchat-staging/secrets/release-infrastructure.env` contains the direct resource configuration:

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

The Redis recovery command is executed without a shell and only accepts `aws`, `az`, `docker`, `gcloud`, `kubectl`, or `redis-cli` as the executable. Its target arguments must contain `rehearsal`, and credential-shaped arguments are rejected; credentials must come from the protected environment. Arguments are never written to evidence. Both S3 bucket names must also contain `rehearsal` and must differ. PostgreSQL, Redis, and local MinIO ports in the rehearsal Compose profile bind to loopback only.

Run the fail-closed preflight before any mutation:

```bash
npm run release:infrastructure:preflight
```

Preflight writes a secret-free `target-preflight.json` below the ignored evidence directory. It is bound to the clean source snapshot and HEAD commit and expires after two hours. The execute command refuses a missing, expired, modified, dirty, or source-mismatched preflight, so the protected job cannot validate one checkout and mutate infrastructure with another.

After reviewing its safe summary and entering an approved release window, run:

```bash
npm run release:infrastructure:rehearse:env
```

The GitHub Actions `Quality Gates` workflow exposes the operation through `smoke_profile=infrastructure-rehearsal` and a protected GitHub Environment. The server dispatcher permits only `preflight|execute` plus the exact 40-character Git SHA, while the job uploads only `latest.json` sanitized evidence for 30 days.

## Accepted Staging Rehearsal

The protected staging rehearsal completed on 2026-08-08 in [Quality Gates run 31238305998](https://github.com/HeLongaa/HCAI-Community/actions/runs/31238305998), bound to clean source `874ffb17429abc6a2f4d1066daeadfd11010aecf`. All 23 checks passed: 114 migrations and permission seeds were present, a 764,069-byte database backup was uploaded to dedicated S3 storage and checksum-restored, Redis recovered its marker after restart, and the primary object was restored from the isolated backup bucket. RPO was zero; total RTO was 25.507 seconds, including 4.927 seconds for PostgreSQL, 2.757 seconds for Redis, and 0.471 seconds for object storage. Independent receipt verification returned `valid=true`, found no forbidden evidence fields, and confirmed receipt `18d9d574ed565b4c02548b3ea6cd5191a97fecd9f0e7b396b64acb33a98bfeed`.

## Production Boundary

The accepted protected staging evidence closes `RELEASE-01` for the isolated target recovery scope. It does not prove a production provider's real 35-day lifecycle schedule, managed encryption-key destruction, cross-zone failover, production access policy, or production latency. Those remain separate launch and data-governance gates.

For account deletion, production backup expiry receipts remain separate from this infrastructure rehearsal. RELEASE-01 supplies the backup inventory and recovery evidence needed to execute that lifecycle without claiming that a specific user's backup expiry has occurred.
