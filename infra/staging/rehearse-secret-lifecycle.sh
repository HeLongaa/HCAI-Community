#!/bin/sh
set -eu

root=${NEWCHAT_STAGING_ROOT:-/opt/newchat-staging}
artifact_sha256=${1:-}
run_id=${2:-slg-$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 4)}
lifecycle_root=${SECRET_LIFECYCLE_HOST_ROOT:-$root/secret-lifecycle}

case "$artifact_sha256" in
  *[!0-9a-f]*|'') echo "Release artifact SHA-256 is invalid" >&2; exit 1 ;;
esac
case "$run_id" in
  *[!a-z0-9-]*|'') echo "Acceptance run id is invalid" >&2; exit 1 ;;
esac
test "${#artifact_sha256}" -eq 64 || { echo "Release artifact SHA-256 is invalid" >&2; exit 1; }
test "${#run_id}" -ge 8 && test "${#run_id}" -le 64 || { echo "Acceptance run id length is invalid" >&2; exit 1; }

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

compose() {
  docker compose --project-name newchat-staging \
    --file "$root/source/infra/production.compose.yml" \
    --file "$root/source/infra/staging.compose.yml" \
    --file "$root/source/infra/staging-secret-lifecycle.compose.yml" "$@"
}
vault_container=$(compose ps --quiet vault)
agent_container=$(compose ps --quiet vault-agent)
gateway_container=$(compose ps --quiet secret-lifecycle-gateway)
test -n "$vault_container" && test -n "$agent_container" && test -n "$gateway_container" || { echo "Secret lifecycle services are not running" >&2; exit 1; }

root_token=$(jq -r '.root_token' "$init_file")
vault_admin() {
  docker exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt \
    -e VAULT_TOKEN="$root_token" "$vault_container" vault "$@"
}

old_agent_token=$(docker exec "$agent_container" cat /run/vault-agent/token)
test -n "$old_agent_token" || { echo "Vault Agent token sink is empty" >&2; exit 1; }
vault_admin token revoke "$old_agent_token" >/dev/null
rotation_verified=false
attempt=0
while [ "$attempt" -lt 150 ]; do
  current_agent_token=$(docker exec "$agent_container" cat /run/vault-agent/token 2>/dev/null || true)
  if [ -n "$current_agent_token" ] && [ "$current_agent_token" != "$old_agent_token" ] \
    && vault_admin token lookup "$current_agent_token" >/dev/null 2>&1; then
    rotation_verified=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
unset old_agent_token current_agent_token
if [ "$rotation_verified" != true ]; then
  compose logs --no-color --tail 100 vault-agent secret-lifecycle-gateway >&2 || true
  echo "Vault Agent did not automatically re-authenticate after token revocation" >&2
  exit 1
fi

readiness_recovered=false
attempt=0
while [ "$attempt" -lt 30 ]; do
  if docker exec "$gateway_container" node -e \
    "fetch('https://127.0.0.1:8790/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; then
    readiness_recovered=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
test "$readiness_recovered" = true || { echo "Lifecycle gateway readiness did not recover after Vault Agent re-authentication" >&2; exit 1; }

vault_path="hcai/staging/providers/acceptance/$run_id"
write_version() {
  credential=$(openssl rand -hex 32)
  printf '{"credential":"%s"}\n' "$credential" | docker exec -i \
    -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt -e VAULT_TOKEN="$root_token" \
    "$vault_container" vault kv put -mount=provider-secrets "$vault_path" - >/dev/null
  unset credential
}
write_version
write_version

acceptance_output=$(compose run --rm --no-deps \
  -e SECRET_LIFECYCLE_ACCEPTANCE_CONFIRMATION=real-staging-secret-lifecycle \
  -e SECRET_LIFECYCLE_ACCEPTANCE_RUN_ID="$run_id" \
  worker node src/modelControl/secretLifecycleStagingAcceptance.js)
acceptance_json=$(printf '%s\n' "$acceptance_output" | tail -n 1)
printf '%s' "$acceptance_json" | jq -e '.status == "passed" and (.actions | length == 2)' >/dev/null

metadata=$(docker exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt -e VAULT_TOKEN="$root_token" \
  "$vault_container" vault kv metadata get -format=json -mount=provider-secrets "$vault_path")
printf '%s' "$metadata" | jq -e '.data.versions["1"].destroyed == true and .data.versions["2"].destroyed == false' >/dev/null

evidence_dir="$root/evidence"
install -d -m 0750 -o root -g newchat-deploy "$evidence_dir"
evidence="$evidence_dir/secret-lifecycle-$run_id.json"
umask 077
jq -n -S \
  --arg artifactSha256 "$artifact_sha256" \
    --arg sourceCommit "$SOURCE_COMMIT" \
    --argjson acceptance "$acceptance_json" \
    --argjson vaultVersions "$(printf '%s' "$metadata" | jq '{"1": {destroyed: .data.versions["1"].destroyed, deletionTimePresent: (.data.versions["1"].deletion_time != "")}, "2": {destroyed: .data.versions["2"].destroyed}}')" \
    '{schemaVersion: 2, status: "passed", environment: "staging", artifactSha256: $artifactSha256, sourceCommit: $sourceCommit, workloadAuth: {method: "vault_cert_auto_auth", tokenRotationVerified: true, gatewayReadinessRecovered: true}, acceptance: $acceptance, vaultVersions: $vaultVersions}' > "$evidence"
chown root:newchat-deploy "$evidence"
chmod 0640 "$evidence"

if grep -Eq 'credential|secret://|root_token|unseal_keys|vault-service-token|gateway-bearer-token' "$evidence"; then
  echo "Acceptance evidence contains a forbidden sensitive field" >&2
  exit 1
fi
receipt=$(sha256sum "$evidence" | cut -d' ' -f1)
printf 'status=passed\n'
printf 'run_id=%s\n' "$run_id"
printf 'actions=2\n'
printf 'vault_versions=2\n'
printf 'vault_agent_token_rotation=passed\n'
printf 'gateway_readiness_recovery=passed\n'
printf 'receipt_sha256=%s\n' "$receipt"
printf 'evidence=%s\n' "$evidence"
