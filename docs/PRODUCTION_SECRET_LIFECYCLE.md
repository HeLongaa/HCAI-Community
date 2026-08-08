# Production Secret Lifecycle

Production Provider credentials must live in an external HA or managed Vault deployment. The application stack does not run a production Vault server. `infra/production-secret-lifecycle.compose.yml` adds only a Vault Agent, the lifecycle gateway, and the Worker wiring to `infra/production.compose.yml`.

## Required External Controls

Do not start the overlay until all of these are independently evidenced:

- Vault uses an HA storage topology or a managed service with an approved availability target.
- Vault auto-unseal uses KMS or HSM-backed key material. Shamir keys stored on the application host are not accepted.
- Raft snapshots or the managed-service equivalent have passed a restore rehearsal, with encrypted backup retention and access logs.
- The workload certificate and private key are short-lived, scoped to the lifecycle gateway, and rotated by the platform identity system.
- Vault audit devices are enabled and exported to durable storage outside the application host.
- The KV v2 mount is named `provider-secrets`; production Provider values live only below `hcai/production/providers/`.

The confirmation value `ha-auto-unseal-backed-vault` is a fail-closed deployment acknowledgement. It is not evidence by itself and must not be set before the controls above have receipts.

## Vault Policy And Identity

Apply `infra/production/secret-lifecycle-policy.hcl` to the external Vault. The policy can soft-delete or destroy selected KV v2 versions and read metadata; it cannot read secret values.

Configure Vault certificate auth with a dedicated role:

```bash
vault auth enable cert
vault policy write newchat-secret-lifecycle infra/production/secret-lifecycle-policy.hcl
vault write auth/cert/certs/newchat-secret-lifecycle-gateway \
  certificate=@workload-ca.crt \
  allowed_common_names=newchat-secret-lifecycle-gateway \
  token_policies=newchat-secret-lifecycle \
  token_no_default_policy=true \
  token_period=5m
```

Use an auth mount path other than `auth/cert` only after creating an environment-specific Agent configuration and updating the machine contract. Do not replace certificate auto-auth with a token file or a long-lived AppRole SecretID.

## Host Files

Set `SECRET_LIFECYCLE_PRODUCTION_ROOT` to a root-owned directory with this layout:

```text
client/
  gateway-token
gateway/
  server.crt
  server.key
trust/
  ca-bundle.crt
workload/
  ca.crt
  client.crt
  client.key
```

`client/gateway-token` authenticates the Worker to the internal gateway. Rotate it by atomically replacing the file inside the mounted directory; both processes reload it per request. `workload/client.key` is mounted only into Vault Agent. The Agent writes renewable Vault tokens to a RAM-backed Compose volume mounted read-only by the gateway. The Worker cannot access that sink, the workload identity, or the gateway TLS private key.

## Deployment

Use exact image digests from the approved supply-chain manifest and include the overlay explicitly:

```bash
docker compose \
  --file infra/production.compose.yml \
  --file infra/production-secret-lifecycle.compose.yml \
  up --detach --wait
```

Required environment values include:

- `SECRET_MANAGER_PROVIDER=vault`
- `SECRET_LIFECYCLE_VAULT_ADDR=https://<managed-vault-origin>/`
- `SECRET_LIFECYCLE_PRODUCTION_ROOT=/absolute/root-owned/path`
- `WORKER_IMAGE=<approved-worker-image-digest>`

The lifecycle gateway readiness probe reloads both file credentials and calls Vault `auth/token/lookup-self`. A missing, revoked, expired, or untrusted credential therefore prevents the gateway and dependent Worker from becoming ready.

## Acceptance

Before production traffic:

1. Write two isolated KV versions under the production prefix using a non-application provisioning identity.
2. Revoke the current Vault Agent token and verify automatic certificate re-authentication without restarting the gateway.
3. Verify the gateway readiness changes to unavailable and recovers.
4. Run one soft-delete and one destroy through the real retention Worker.
5. Verify Vault metadata, immutable hash-only database receipts, audit-device entries, and absence of secret values in application logs.
6. Restart every Vault node one at a time and prove automatic unseal, quorum continuity, and gateway recovery.
7. Restore a Vault snapshot into an isolated cluster and verify the exact KV metadata state.

Production remains No-Go until the target environment supplies these receipts. The Staging certificate auto-auth rehearsal proves the application integration but does not prove production HA, KMS/HSM, backup, or platform identity operations.
