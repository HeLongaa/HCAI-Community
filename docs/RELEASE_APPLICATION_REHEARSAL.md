# Release Application Rehearsal

`RELEASE-02` makes candidate deployment and rollback verification executable. It is separate from the `RELEASE-01` PostgreSQL, Redis, and object-storage recovery rehearsal. A successful run deploys one candidate artifact, verifies the candidate, restores the explicitly identified previous artifact, and repeats the same smoke suite.

## Local Fixture

Run:

```bash
npm run test:release-application
npm run release:application:rehearse
```

The local command starts an in-process HTTP fixture and changes only its in-memory artifact identity. It verifies orchestration, evidence, retry, artifact binding, and rollback without touching a deployment target. It does not build or deploy NewChat and cannot satisfy target-environment acceptance.

Both candidate and rollback phases require:

- `GET /health` returns HTTP 200, `data.status=ok`, and the expected SHA-256 artifact identity in both `data.releaseArtifactSha256` and `x-release-artifact-sha256`.
- `GET /api/openapi.json` returns HTTP 200.
- `GET /api/compliance/policies` returns HTTP 200.
- Unauthenticated `GET /api/me` returns HTTP 401.
- Deployment and smoke durations remain within the frozen objectives.

## Target Environment

Use only a protected staging or rehearsal environment. The target URL must use HTTPS and its hostname must contain `staging` or `rehearsal`; a production hostname is rejected before a deployment command runs.

Required non-secret protected environment variables:

```text
RELEASE_APPLICATION_REHEARSAL_CONFIRMATION=release-02-staging-rehearsal
RELEASE_REHEARSAL_TARGET_ORIGIN=https://api.staging.example.com
RELEASE_CANDIDATE_ARTIFACT_SHA256=<64 lowercase hex characters>
RELEASE_PREVIOUS_ARTIFACT_SHA256=<different 64 lowercase hex characters>
RELEASE_REHEARSAL_DEPLOY_COMMAND_JSON=["kubectl", ...]
RELEASE_REHEARSAL_ROLLBACK_COMMAND_JSON=["kubectl", ...]
```

Commands are parsed as JSON argument arrays and run without a shell. The executable must be one of `aws`, `az`, `docker`, `gcloud`, `kubectl`, `node`, `npm`, or `npx`. Credential-shaped command arguments are rejected; credentials must come from the protected environment. The runner supplies `RELEASE_TARGET_ARTIFACT_SHA256`, both artifact digests, and the target origin to each command. The deployment adapter must configure `RELEASE_ARTIFACT_SHA256` on the API process so `/health` can prove which artifact serves traffic.

For a single-host protected staging target, use the repository SSH adapter documented in
`docs/GITHUB_ENVIRONMENT.md`. The remote `infra/staging/deploy-release.sh` command accepts only a SHA-256 whose manifest
was created by `infra/staging/build-release.sh`, verifies every local Docker image ID against that manifest, serializes
deployments with a host lock, and starts the production Compose contract through the staging-only override. The public
TLS proxy remains separate from the application Compose project.

Run preflight and execute from the same clean checkout and protected job:

```bash
npm run release:application:preflight
npm run release:application:rehearse:env
```

Preflight binds the commit, complete source snapshot, candidate artifact, previous artifact, target origin, timestamp, and receipt. Execute rejects missing, changed, dirty, target-mismatched, artifact-mismatched, or older-than-30-minute preflight evidence before invoking either command. A candidate failure does not suppress rollback; the runner still attempts to restore and smoke the previous artifact.

The GitHub Actions `Quality Gates` workflow exposes this as `smoke_profile=application-rehearsal`. It uploads the sanitized `latest.json` receipt for 30 days.

## Evidence Boundary

Evidence records source and artifact hashes, target origin, bounded durations, status codes, retry counts, phase results, and a SHA-256 receipt. It does not record command arguments, command output, response bodies, credentials, cookies, or authorization headers.

A local receipt proves only that the fixture and evidence controls execute. `RELEASE-02` remains pending until a protected staging run deploys real immutable artifacts, passes candidate smoke, restores the previous artifact, passes rollback smoke, and an operator reviews the receipt. Production deployment is outside this rehearsal's allowed target boundary.
