# Secret Lifecycle Staging Acceptance

The staging lifecycle path uses a dedicated Vault KV v2 mount and a separate HTTPS gateway. The application Worker receives only a file-mounted gateway bearer credential. The gateway receives only that bearer credential, its own TLS key, and a Vault token restricted to soft-delete, destroy, and metadata-read operations below `provider-secrets/hcai/staging/providers/*`. Root/unseal material and the CA private key remain in a host-only `private/` directory that is not mounted into any container.

Provision an allowlisted release artifact, deploy it, and run the acceptance:

```sh
sudo /opt/newchat-staging/source/infra/staging/provision-secret-lifecycle.sh <artifact-sha256>
sudo /opt/newchat-staging/bin/deploy-release <artifact-sha256>
sudo /opt/newchat-staging/source/infra/staging/rehearse-secret-lifecycle.sh <artifact-sha256>
```

The rehearsal writes two random KV versions, creates a real Provider SecretRef rotation in the staging PostgreSQL database, runs the production Prisma retention repository, verifies version 1 soft deletion and subsequent destruction after a simulated 31-day retention clock, and confirms immutable hash-only receipts. Evidence is written below `/opt/newchat-staging/evidence` and must not contain SecretRefs, Vault responses, tokens, unseal keys, or secret values.

This is a single-node staging acceptance only. It is not production approval. Production requires an HA Vault/HCP Vault or equivalent managed Secret Manager, workload authentication, automatic unseal backed by KMS/HSM, audited backup/restore, token renewal, monitoring, and approved access policies.
