# Production Release Evidence And Go/No-Go

`production-release-evidence-contract-v1` is the final production release index. It prevents an approved Release Control row from being deployed with an unrelated CI URL or evidence collected from a different source commit or candidate artifact.

Passing local tests does not create a production Go decision. A Go bundle exists only after six independent roles sign every required control for the same immutable source, candidate artifact, and rollback artifact.

## Binding

Every production release request records:

- the 40-character lowercase Git commit SHA;
- the candidate artifact SHA-256;
- a different rollback artifact SHA-256;
- the SHA-256 receipt of the complete production evidence bundle.

The request stores this binding in append-only `requested` evidence. Deployment requires the complete bundle again. The server reloads six trusted Ed25519 public keys, verifies every signature and control, checks expiry, recomputes the receipt, and compares all three source values and the receipt with the approved request. An older production request without this binding cannot be deployed.

## Independent Roles

| Role | Evidence domain |
| --- | --- |
| `platform` | HA quorum, KMS/HSM auto-unseal, offsite restore, workload CA, off-host audit, infrastructure rehearsal |
| `security` | Google/GitHub OAuth, negative auth lifecycle, mail delivery, bounce/complaint, upstream output/media assurance, alert delivery |
| `legal` | legal entity, jurisdiction, published policies, DPA, data region/retention, output rights |
| `provider_governance` | Chat/Image/Video/Music approval, budget and kill switches, incident/deletion process |
| `supply_chain` | immutable GHCR digests, dual SBOM, vulnerability policy, OIDC provenance, signed attestations, source binding |
| `operations` | candidate/rollback, multi-instance runtime, monitoring, UAT, rollback ownership, canary/hypercare |

The six attestations require six different approver hashes, key ids, and public keys. Each attestation is valid for no more than seven days and every control must be `pass=true`. Release Control requester/approver separation remains an additional approval layer; it does not replace the six evidence owners.

## Operator Flow

1. Build immutable candidate and rollback artifacts from the intended source commit.
2. Give each evidence owner the exact three-value source binding and that role's closed control list from `config/production-release-evidence-contract.json`.
3. Each owner creates an unsigned attestation containing only SHA-256 evidence references and signs it with a role-specific Ed25519 private key stored outside the application runtime.
4. Build and independently verify the complete bundle.
5. Import the JSON bundle in Admin Release Control or Model Control. The browser derives the four request binding fields from the bundle.
6. A different Release Control administrator approves the request.
7. At deployment, import the complete bundle again. The API verifies it against trusted public keys and the approved request before changing status to `deployed`.

Signing example:

```bash
chmod 600 /secure/platform-ed25519.pem
npm run production-release-evidence:sign -- \
  --input=.artifacts/platform-unsigned.json \
  --private-key=/secure/platform-ed25519.pem \
  --output=.artifacts/platform-signed.json
```

Bundle construction requires one `--attestation=<role>=<path>` and one `--public-key=<role>=<path>` for each role, plus `--source-commit`, `--artifact-sha256`, `--rollback-artifact-sha256`, and `--output`. Verify the result with:

```bash
PRODUCTION_RELEASE_SOURCE_COMMIT=<commit> \
PRODUCTION_RELEASE_ARTIFACT_SHA256=<candidate-sha256> \
PRODUCTION_RELEASE_ROLLBACK_ARTIFACT_SHA256=<rollback-sha256> \
npm run production-release-evidence:verify -- .artifacts/production-release-evidence.json
```

The verifier also requires the six `PRODUCTION_RELEASE_*_PUBLIC_KEY` variables. Public keys may be mounted in the application environment; private signing keys must never be mounted there. Signing and bundle output files are created with owner-only permissions on supported platforms.

`npm run smoke:production:env` also requires all six public keys to parse as Ed25519 and to be mutually distinct. Its safe summary reports only readiness and role counts, never key material.

## Persistence And Privacy

Release records retain the bundle id, bundle receipt, source/candidate/rollback hashes, and one SHA-256 per role attestation. The full signed bundle, signatures, raw CI URL, URL host, and operator note are not persisted. CI URL and host are represented only by SHA-256; notes are represented by presence and SHA-256.

Failed deployment attempts may be recorded without a Go bundle, but can only move the change to `failed`. They cannot enable production traffic. Rollback remains available from `deployed` or `failed` and records only hash-safe evidence.

## Current Decision

The code can validate a real bundle but cannot manufacture missing approvals. Until all six roles provide current, independent signatures for one real production candidate and rollback artifact, no valid bundle can be built and the system remains **No-Go**.
