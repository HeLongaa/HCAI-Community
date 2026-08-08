#!/bin/sh
set -eu

root=${NEWCHAT_STAGING_ROOT:-/opt/newchat-staging}
artifact_sha256=${1:-}
run_id=${2:-sldr-$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 4)}
lifecycle_root=${SECRET_LIFECYCLE_HOST_ROOT:-$root/secret-lifecycle}
vault_image='hashicorp/vault@sha256:a296a888b118615dc01d5f1a6846e6d4a7277946caaed5b447008fff5fe06b54'
restore_container="newchat-vault-dr-$run_id"
run_root="$root/rehearsals/secret-lifecycle-dr"
run_dir="$run_root/$run_id"
restore_data="$run_dir/restore-data"
snapshot="$run_dir/source.snap"
source_path_created=false

cleanup() {
  if docker inspect "$restore_container" >/dev/null 2>&1; then
    restore_state=$(docker inspect --format '{{.State.Status}}' "$restore_container" 2>/dev/null || true)
    if [ "$restore_state" != running ]; then
      docker logs --tail 100 "$restore_container" >&2 || true
    fi
    docker rm --force "$restore_container" >/dev/null 2>&1 || true
  fi
  if [ "$source_path_created" = true ] && [ -n "${vault_container:-}" ] && [ -n "${source_root_token:-}" ]; then
    docker exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt \
      -e VAULT_TOKEN="$source_root_token" "$vault_container" \
      vault kv metadata delete -mount=provider-secrets "${vault_path:-missing}" >/dev/null 2>&1 || true
  fi
  rm -rf "$run_dir"
}
trap 'cleanup' EXIT HUP INT TERM

if [ "$(id -u)" -ne 0 ]; then
  echo "Vault DR rehearsal must run as root" >&2
  exit 1
fi
case "$artifact_sha256" in
  *[!0-9a-f]*|'') echo "Release artifact SHA-256 is invalid" >&2; exit 1 ;;
esac
case "$run_id" in
  *[!a-z0-9-]*|'') echo "Vault DR run id is invalid" >&2; exit 1 ;;
esac
test "${#artifact_sha256}" -eq 64 || { echo "Release artifact SHA-256 is invalid" >&2; exit 1; }
test "${#run_id}" -ge 8 && test "${#run_id}" -le 64 || { echo "Vault DR run id length is invalid" >&2; exit 1; }
for command in docker git jq node openssl sha256sum stat; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 1; }
done
run_started=$(date +%s)

manifest="$root/artifacts/$artifact_sha256.env"
runtime="$root/secrets/runtime.env"
init_file="$lifecycle_root/private/vault-init.json"
test -f "$manifest" && test -f "$runtime" && test -f "$init_file" || { echo "Secret lifecycle deployment is not provisioned" >&2; exit 1; }

set -a
. "$runtime"
. "$manifest"
RELEASE_ARTIFACT_SHA256=$artifact_sha256
SECRET_LIFECYCLE_HOST_ROOT=$lifecycle_root
export RELEASE_ARTIFACT_SHA256 SECRET_LIFECYCLE_HOST_ROOT
set +a

actual_source_commit=$(git -C "$root/source" rev-parse HEAD)
test "$actual_source_commit" = "$SOURCE_COMMIT" || { echo "Staging source checkout does not match the allowlisted artifact" >&2; exit 1; }
test -z "$(git -C "$root/source" status --porcelain)" || { echo "Staging source checkout must be clean" >&2; exit 1; }

compose() {
  docker compose --project-name newchat-staging \
    --file "$root/source/infra/production.compose.yml" \
    --file "$root/source/infra/staging.compose.yml" \
    --file "$root/source/infra/staging-secret-lifecycle.compose.yml" "$@"
}
vault_container=$(compose ps --quiet vault)
test -n "$vault_container" || { echo "Staging Vault is not running" >&2; exit 1; }

source_root_token=$(jq -r '.root_token' "$init_file")
source_unseal_key=$(jq -r '.unseal_keys_b64[0]' "$init_file")
test -n "$source_root_token" && test -n "$source_unseal_key" || { echo "Vault recovery material is incomplete" >&2; exit 1; }
vault_admin() {
  docker exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt \
    -e VAULT_TOKEN="$source_root_token" "$vault_container" vault "$@"
}
vault_admin status -format=json | jq -e '.initialized == true and .sealed == false and .storage_type == "raft"' >/dev/null
vault_admin audit list -format=json | jq -e 'has("staging-file/") and .["staging-file/"].type == "file"' >/dev/null

install -d -m 0700 -o root -g root "$run_root" "$run_dir"
install -d -m 0750 -o 100 -g 1000 "$restore_data"
restore_config="$run_dir/restore.hcl"
{
  printf 'ui = false\n'
  printf 'disable_mlock = true\n'
  printf 'storage "raft" {\n  path = "/vault/file"\n  node_id = "newchat-staging-vault-dr"\n}\n'
  printf 'listener "tcp" {\n  address = "127.0.0.1:8200"\n  cluster_address = "127.0.0.1:8201"\n  tls_cert_file = "/vault/tls/vault.crt"\n  tls_key_file = "/vault/tls/vault.key"\n  tls_min_version = "tls12"\n}\n'
  printf 'api_addr = "https://127.0.0.1:8200"\n'
  printf 'cluster_addr = "https://127.0.0.1:8201"\n'
} > "$restore_config"
chown root:1000 "$restore_config"
chmod 0440 "$restore_config"

vault_path="hcai/staging/providers/dr/$run_id"
source_path_created=true
credential_1=$(openssl rand -hex 32)
credential_2=$(openssl rand -hex 32)
credential_3=$(openssl rand -hex 32)
value_hash_1=$(printf '%s' "$credential_1" | sha256sum | cut -d' ' -f1)
value_hash_2=$(printf '%s' "$credential_2" | sha256sum | cut -d' ' -f1)

write_source_version() {
  value=$1
  jq -n --arg value "$value" '{credential: $value}' | docker exec -i \
    -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt -e VAULT_TOKEN="$source_root_token" \
    "$vault_container" vault kv put -mount=provider-secrets "$vault_path" - >/dev/null
}
metadata_projection() {
  jq -S '{current_version: .data.current_version, oldest_version: .data.oldest_version, versions: (.data.versions | with_entries(.value |= {created_time, deletion_time, destroyed}))}'
}

write_source_version "$credential_1"
write_source_version "$credential_2"
source_metadata=$(vault_admin kv metadata get -format=json -mount=provider-secrets "$vault_path")
source_projection=$(printf '%s' "$source_metadata" | metadata_projection)
printf '%s' "$source_projection" | jq -e '.current_version == 2 and (.versions | length) == 2 and .versions["1"].destroyed == false and .versions["2"].deletion_time == ""' >/dev/null
source_metadata_sha256=$(printf '%s' "$source_projection" | sha256sum | cut -d' ' -f1)

snapshot_audit_before=$(docker exec "$vault_container" cat /vault/file/audit.log | jq -s '[.[] | select(.type == "request" and .request.path == "sys/storage/raft/snapshot")] | length')
snapshot_name="$run_id.snap"
vault_admin operator raft snapshot save "/tmp/$snapshot_name"
vault_admin operator raft snapshot inspect "/tmp/$snapshot_name" >/dev/null
docker cp "$vault_container:/tmp/$snapshot_name" "$snapshot" >/dev/null
docker exec "$vault_container" rm -f "/tmp/$snapshot_name"
chown root:1000 "$snapshot"
chmod 0640 "$snapshot"
snapshot_bytes=$(stat -c '%s' "$snapshot")
snapshot_sha256=$(sha256sum "$snapshot" | cut -d' ' -f1)
test "$snapshot_bytes" -gt 0

write_source_version "$credential_3"
vault_admin kv delete -versions=2 -mount=provider-secrets "$vault_path" >/dev/null
mutated_metadata=$(vault_admin kv metadata get -format=json -mount=provider-secrets "$vault_path")
printf '%s' "$mutated_metadata" | jq -e '.data.current_version == 3 and .data.versions["2"].deletion_time != ""' >/dev/null

restore_started=$(date +%s)
docker run --detach --name "$restore_container" \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 128 \
  --memory 512m \
  --cpus 1 \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --mount "type=bind,src=$restore_config,dst=/vault/config/restore.hcl,readonly" \
  --mount "type=bind,src=$restore_data,dst=/vault/file" \
  --mount "type=bind,src=$lifecycle_root/tls/ca.crt,dst=/vault/tls/ca.crt,readonly" \
  --mount "type=bind,src=$lifecycle_root/tls/vault.crt,dst=/vault/tls/vault.crt,readonly" \
  --mount "type=bind,src=$lifecycle_root/tls/vault.key,dst=/vault/tls/vault.key,readonly" \
  --mount "type=bind,src=$snapshot,dst=/vault/restore/source.snap,readonly" \
  "$vault_image" server -config=/vault/config/restore.hcl >/dev/null

restore_status="$run_dir/restore-status.json"
attempt=0
while [ "$attempt" -lt 60 ]; do
  docker exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt \
    "$restore_container" vault status -format=json > "$restore_status" 2>/dev/null || true
  if jq -e 'has("initialized") and has("sealed")' "$restore_status" >/dev/null 2>&1; then break; fi
  attempt=$((attempt + 1))
  sleep 1
done
jq -e '.initialized == false and .sealed == true and .storage_type == "raft"' "$restore_status" >/dev/null

restore_init="$run_dir/restore-init.json"
docker exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt \
  "$restore_container" vault operator init -key-shares=1 -key-threshold=1 -format=json > "$restore_init"
temporary_unseal_key=$(jq -r '.unseal_keys_b64[0]' "$restore_init")
temporary_root_token=$(jq -r '.root_token' "$restore_init")
docker exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt \
  "$restore_container" vault operator unseal "$temporary_unseal_key" >/dev/null

docker exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt \
  -e VAULT_TOKEN="$temporary_root_token" -e VAULT_CLIENT_TIMEOUT=120s \
  "$restore_container" vault operator raft snapshot restore -force /vault/restore/source.snap >/dev/null
docker exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt \
  "$restore_container" vault operator unseal "$source_unseal_key" >/dev/null

restore_admin() {
  docker exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt \
    -e VAULT_TOKEN="$source_root_token" "$restore_container" vault "$@"
}
restore_admin status -format=json | jq -e '.initialized == true and .sealed == false and .storage_type == "raft"' >/dev/null
restored_metadata=$(restore_admin kv metadata get -format=json -mount=provider-secrets "$vault_path")
restored_projection=$(printf '%s' "$restored_metadata" | metadata_projection)
restored_metadata_sha256=$(printf '%s' "$restored_projection" | sha256sum | cut -d' ' -f1)
metadata_hash_matches=false
if [ "$restored_metadata_sha256" = "$source_metadata_sha256" ]; then metadata_hash_matches=true; fi

restored_1=$(restore_admin kv get -version=1 -field=credential -mount=provider-secrets "$vault_path")
restored_2=$(restore_admin kv get -version=2 -field=credential -mount=provider-secrets "$vault_path")
restored_hash_1=$(printf '%s' "$restored_1" | sha256sum | cut -d' ' -f1)
restored_hash_2=$(printf '%s' "$restored_2" | sha256sum | cut -d' ' -f1)
value_hashes_match=false
if [ "$restored_hash_1" = "$value_hash_1" ] && [ "$restored_hash_2" = "$value_hash_2" ]; then value_hashes_match=true; fi
post_snapshot_mutation_excluded=false
if printf '%s' "$restored_metadata" | jq -e '.data.current_version == 2 and (.data.versions | length) == 2 and .data.versions["2"].deletion_time == ""' >/dev/null; then
  post_snapshot_mutation_excluded=true
fi
restore_completed=$(date +%s)
restore_duration_seconds=$((restore_completed - restore_started))
test "$metadata_hash_matches" = true
test "$value_hashes_match" = true
test "$post_snapshot_mutation_excluded" = true

snapshot_audit_after=$(docker exec "$vault_container" cat /vault/file/audit.log | jq -s '[.[] | select(.type == "request" and .request.path == "sys/storage/raft/snapshot")] | length')
snapshot_request_count=$((snapshot_audit_after - snapshot_audit_before))
rehearsal_request_count=$(docker exec "$vault_container" cat /vault/file/audit.log | jq -s --arg suffix "$vault_path" '[.[] | select(.type == "request" and (.request.path | type) == "string" and (.request.path | endswith($suffix)))] | length')
plaintext_values_present=$(docker exec "$vault_container" cat /vault/file/audit.log | jq -Rs --arg one "$credential_1" --arg two "$credential_2" --arg three "$credential_3" 'contains($one) or contains($two) or contains($three)')
plaintext_values_absent=false
if [ "$plaintext_values_present" = false ]; then plaintext_values_absent=true; fi
test "$snapshot_request_count" -gt 0
test "$rehearsal_request_count" -gt 0
test "$plaintext_values_absent" = true

unset credential_1 credential_2 credential_3 restored_1 restored_2 temporary_unseal_key temporary_root_token
vault_admin kv metadata delete -mount=provider-secrets "$vault_path" >/dev/null
source_path_created=false
docker rm --force "$restore_container" >/dev/null
restore_container_removed=true
restore_container="newchat-vault-dr-cleaned-$run_id"
rm -f "$snapshot" "$restore_init" "$restore_status" "$restore_config"
snapshot_removed=true
rm -rf "$restore_data"
restore_data_removed=true
test ! -e "$snapshot" && test ! -e "$restore_data"
run_completed=$(date +%s)

evidence_dir="$root/evidence"
install -d -m 0750 -o root -g newchat-deploy "$evidence_dir"
evidence="$evidence_dir/secret-lifecycle-dr-$run_id.json"
evidence_input="$run_dir/evidence-input.json"
started_at=$(date -u -d "@$run_started" +%Y-%m-%dT%H:%M:%S.000Z)
completed_at=$(date -u -d "@$run_completed" +%Y-%m-%dT%H:%M:%S.000Z)
jq -n -S \
  --arg runId "$run_id" \
  --arg startedAt "$started_at" \
  --arg completedAt "$completed_at" \
  --arg gitCommit "$SOURCE_COMMIT" \
  --arg artifactSha256 "$artifact_sha256" \
  --arg vaultImage "$vault_image" \
  --arg sourceMetadataSha256 "$source_metadata_sha256" \
  --arg snapshotSha256 "$snapshot_sha256" \
  --arg restoreMetadataSha256 "$restored_metadata_sha256" \
  --argjson snapshotBytes "$snapshot_bytes" \
  --argjson restoreDurationSeconds "$restore_duration_seconds" \
  --argjson rehearsalRequestCount "$rehearsal_request_count" \
  --argjson snapshotRequestCount "$snapshot_request_count" \
  --argjson metadataHashMatches "$metadata_hash_matches" \
  --argjson valueHashesMatch "$value_hashes_match" \
  --argjson postSnapshotMutationExcluded "$post_snapshot_mutation_excluded" \
  --argjson plaintextValuesAbsent "$plaintext_values_absent" \
  --argjson snapshotRemoved "$snapshot_removed" \
  --argjson restoreDataRemoved "$restore_data_removed" \
  --argjson restoreContainerRemoved "$restore_container_removed" \
  '{
    run: {id: $runId, startedAt: $startedAt, completedAt: $completedAt},
    source: {gitCommit: $gitCommit, artifactSha256: $artifactSha256, vaultImage: $vaultImage, storage: "raft", metadataSha256: $sourceMetadataSha256, versionCount: 2},
    target: {restoreRtoSeconds: 120},
    snapshot: {created: true, bytes: $snapshotBytes, sha256: $snapshotSha256, barrierEncrypted: true},
    restore: {networkMode: "none", hostPortsPublished: false, forced: true, durationSeconds: $restoreDurationSeconds, metadataSha256: $restoreMetadataSha256, metadataHashMatches: $metadataHashMatches, valueHashesMatch: $valueHashesMatch, postSnapshotMutationExcluded: $postSnapshotMutationExcluded},
    audit: {enabled: true, rehearsalRequestCount: $rehearsalRequestCount, snapshotRequestCount: $snapshotRequestCount, plaintextValuesAbsent: $plaintextValuesAbsent},
    cleanup: {snapshotRemoved: $snapshotRemoved, restoreDataRemoved: $restoreDataRemoved, restoreContainerRemoved: $restoreContainerRemoved},
    limitations: {productionHaVerified: false, kmsHsmAutoUnsealVerified: false, externalBackupRetentionVerified: false, externalAuditStorageVerified: false, targetProductionEnvironmentVerified: false},
    checks: [
      {id: "raft_snapshot_created", pass: true},
      {id: "restore_network_isolated", pass: true},
      {id: "restored_metadata_matches", pass: $metadataHashMatches},
      {id: "restored_value_hashes_match", pass: $valueHashesMatch},
      {id: "post_snapshot_mutation_excluded", pass: $postSnapshotMutationExcluded},
      {id: "audit_trail_present", pass: true},
      {id: "audit_plaintext_absent", pass: $plaintextValuesAbsent},
      {id: "ephemeral_material_removed", pass: true}
    ]
  }' > "$evidence_input"

node "$root/source/scripts/build-secret-lifecycle-dr-evidence.mjs" "$evidence_input" "$evidence"
node "$root/source/scripts/verify-secret-lifecycle-dr-evidence.mjs" "$evidence" | jq -e '.valid == true' >/dev/null
chown root:newchat-deploy "$evidence"
chmod 0640 "$evidence"
receipt=$(jq -r '.receiptHash' "$evidence")

printf 'status=passed\n'
printf 'run_id=%s\n' "$run_id"
printf 'snapshot_sha256=%s\n' "$snapshot_sha256"
printf 'restore_rto_seconds=%s\n' "$restore_duration_seconds"
printf 'metadata_restore=passed\n'
printf 'value_hash_restore=passed\n'
printf 'post_snapshot_mutation_excluded=passed\n'
printf 'audit_plaintext_absent=passed\n'
printf 'ephemeral_material_removed=passed\n'
printf 'production_ha_verified=false\n'
printf 'kms_hsm_auto_unseal_verified=false\n'
printf 'receipt_sha256=%s\n' "$receipt"
printf 'evidence=%s\n' "$evidence"
