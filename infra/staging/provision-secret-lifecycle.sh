#!/bin/sh
set -eu

root=${NEWCHAT_STAGING_ROOT:-/opt/newchat-staging}
artifact_sha256=${1:-}
lifecycle_root=${SECRET_LIFECYCLE_HOST_ROOT:-$root/secret-lifecycle}

if [ "$(id -u)" -ne 0 ]; then
  echo "Secret lifecycle provisioning must run as root" >&2
  exit 1
fi
case "$artifact_sha256" in
  *[!0-9a-f]*|'') echo "Release artifact SHA-256 is invalid" >&2; exit 1 ;;
esac
if [ "${#artifact_sha256}" -ne 64 ]; then
  echo "Release artifact SHA-256 must contain 64 lowercase hexadecimal characters" >&2
  exit 1
fi
for command in docker jq openssl; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 1; }
done

manifest="$root/artifacts/$artifact_sha256.env"
runtime="$root/secrets/runtime.env"
test -f "$manifest" || { echo "Release artifact is not allowlisted" >&2; exit 1; }
test -f "$runtime" || { echo "Staging runtime configuration is missing" >&2; exit 1; }

set -a
. "$runtime"
. "$manifest"
RELEASE_ARTIFACT_SHA256=$artifact_sha256
SECRET_LIFECYCLE_HOST_ROOT=$lifecycle_root
export RELEASE_ARTIFACT_SHA256 SECRET_LIFECYCLE_HOST_ROOT
set +a

install -m 0750 -o root -g newchat-deploy "$root/source/infra/staging/deploy-release.sh" "$root/bin/deploy-release"
install -d -m 0750 -o root -g 1000 "$lifecycle_root" "$lifecycle_root/tls" "$lifecycle_root/secrets"
install -d -m 0700 -o root -g root "$lifecycle_root/private"
install -d -m 0750 -o 100 -g 1000 "$lifecycle_root/data"
install -m 0640 -o root -g 1000 "$root/source/infra/staging/vault.hcl" "$lifecycle_root/vault.hcl"

if [ ! -f "$lifecycle_root/private/ca.key" ]; then
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 365 \
    -subj '/CN=newchat-staging-secret-lifecycle-ca' \
    -keyout "$lifecycle_root/private/ca.key" -out "$lifecycle_root/tls/ca.crt" >/dev/null 2>&1
fi

issue_certificate() {
  name=$1
  sans=$2
  extended_key_usage=$3
  if [ -f "$lifecycle_root/tls/$name.crt" ] && [ -f "$lifecycle_root/tls/$name.key" ] \
    && openssl x509 -checkend 604800 -noout -in "$lifecycle_root/tls/$name.crt" >/dev/null 2>&1; then
    return
  fi
  ext=$(mktemp "$lifecycle_root/$name-ext.XXXXXX")
  trap 'rm -f "$ext"' EXIT HUP INT TERM
  {
    printf 'subjectAltName=%s\n' "$sans"
    printf 'extendedKeyUsage=%s\n' "$extended_key_usage"
    printf 'keyUsage=digitalSignature,keyEncipherment\n'
  } > "$ext"
  openssl req -new -newkey rsa:3072 -sha256 -nodes -subj "/CN=$name" \
    -keyout "$lifecycle_root/tls/$name.key" -out "$lifecycle_root/tls/$name.csr" >/dev/null 2>&1
  openssl x509 -req -sha256 -days 90 -in "$lifecycle_root/tls/$name.csr" \
    -CA "$lifecycle_root/tls/ca.crt" -CAkey "$lifecycle_root/private/ca.key" -CAcreateserial \
    -extfile "$ext" -out "$lifecycle_root/tls/$name.crt" >/dev/null 2>&1
  rm -f "$lifecycle_root/tls/$name.csr" "$ext"
  trap - EXIT HUP INT TERM
}

issue_certificate vault 'DNS:vault,DNS:localhost,IP:127.0.0.1' serverAuth
issue_certificate gateway 'DNS:secret-lifecycle-gateway,DNS:localhost,IP:127.0.0.1' serverAuth
issue_certificate vault-agent 'DNS:vault-agent' clientAuth
chmod 0644 "$lifecycle_root/tls/ca.crt" "$lifecycle_root/tls/vault.crt" "$lifecycle_root/tls/gateway.crt" "$lifecycle_root/tls/vault-agent.crt"
chmod 0640 "$lifecycle_root/tls/vault.key" "$lifecycle_root/tls/gateway.key" "$lifecycle_root/tls/vault-agent.key"
chown root:1000 "$lifecycle_root/tls/"*
chmod 0600 "$lifecycle_root/private/ca.key"
chown root:root "$lifecycle_root/private/ca.key"

if [ ! -f "$lifecycle_root/secrets/gateway-token" ]; then
  umask 077
  openssl rand -hex 32 > "$lifecycle_root/secrets/gateway-token"
fi
chown root:1000 "$lifecycle_root/secrets/gateway-token"
chmod 0640 "$lifecycle_root/secrets/gateway-token"

compose() {
  docker compose --project-name newchat-staging \
    --file "$root/source/infra/production.compose.yml" \
    --file "$root/source/infra/staging.compose.yml" \
    --file "$root/source/infra/staging-secret-lifecycle.compose.yml" "$@"
}

compose up --detach --no-build --no-deps vault
vault_container=$(compose ps --quiet vault)
test -n "$vault_container" || { echo "Vault container did not start" >&2; exit 1; }

attempt=0
while :; do
  docker exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt \
    "$vault_container" vault status -format=json >/tmp/newchat-vault-status.json 2>/dev/null || true
  if jq -e 'has("initialized") and has("sealed")' /tmp/newchat-vault-status.json >/dev/null 2>&1; then break; fi
  if [ "$attempt" -ge 30 ]; then break; fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ ! -s /tmp/newchat-vault-status.json ]; then
  echo "Vault status endpoint is unavailable" >&2
  exit 1
fi

init_file="$lifecycle_root/private/vault-init.json"
if [ "$(jq -r '.initialized' /tmp/newchat-vault-status.json)" != "true" ]; then
  umask 077
  docker exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt \
    "$vault_container" vault operator init -key-shares=1 -key-threshold=1 -format=json > "$init_file"
fi
test -s "$init_file" || { echo "Vault initialization material is missing" >&2; exit 1; }
chmod 0600 "$init_file"

unseal_key=$(jq -r '.unseal_keys_b64[0]' "$init_file")
root_token=$(jq -r '.root_token' "$init_file")
if [ "$(jq -r '.sealed' /tmp/newchat-vault-status.json)" = "true" ]; then
  docker exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt \
    "$vault_container" vault operator unseal "$unseal_key" >/dev/null
fi

vault_exec() {
  docker exec -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt \
    -e VAULT_TOKEN="$root_token" "$vault_container" vault "$@"
}
if ! vault_exec secrets list -format=json | jq -e 'has("provider-secrets/")' >/dev/null; then
  vault_exec secrets enable -path=provider-secrets -version=2 kv >/dev/null
fi
policy=$(cat <<'EOF'
path "provider-secrets/delete/hcai/staging/providers/*" {
  capabilities = ["update"]
}
path "provider-secrets/destroy/hcai/staging/providers/*" {
  capabilities = ["update"]
}
path "provider-secrets/metadata/hcai/staging/providers/*" {
  capabilities = ["read"]
}
path "auth/token/lookup-self" {
  capabilities = ["read"]
}
EOF
)
printf '%s\n' "$policy" | docker exec -i -e VAULT_ADDR=https://127.0.0.1:8200 -e VAULT_CACERT=/vault/tls/ca.crt \
  -e VAULT_TOKEN="$root_token" "$vault_container" vault policy write secret-lifecycle-gateway - >/dev/null

if ! vault_exec auth list -format=json | jq -e 'has("cert/")' >/dev/null; then
  vault_exec auth enable cert >/dev/null
fi
vault_exec write auth/cert/certs/newchat-secret-lifecycle-gateway \
  certificate=@/vault/tls/ca.crt \
  allowed_common_names=vault-agent \
  token_policies=secret-lifecycle-gateway \
  token_no_default_policy=true \
  token_period=1m >/dev/null

compose up --detach --no-build --no-deps vault-agent
agent_container=$(compose ps --quiet vault-agent)
test -n "$agent_container" || { echo "Vault Agent container did not start" >&2; exit 1; }
agent_ready=false
attempt=0
while [ "$attempt" -lt 90 ]; do
  if docker exec "$agent_container" sh -ec \
    'test -s /run/vault-agent/token && VAULT_TOKEN=$(cat /run/vault-agent/token) vault token lookup -address="$VAULT_ADDR" -ca-cert=/run/vault-workload/ca.crt >/dev/null'; then
    agent_ready=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$agent_ready" != true ]; then
  compose logs --no-color --tail 100 vault-agent >&2 || true
  echo "Vault Agent certificate auto-auth did not become ready" >&2
  exit 1
fi

legacy_token_file="$lifecycle_root/secrets/vault-gateway-token"
if [ -s "$legacy_token_file" ]; then
  legacy_token=$(cat "$legacy_token_file")
  if vault_exec token lookup "$legacy_token" >/dev/null 2>&1; then
    vault_exec token revoke "$legacy_token" >/dev/null
  fi
  unset legacy_token
  rm -f "$legacy_token_file"
fi

if ! grep -q '^STAGING_SECRET_LIFECYCLE_ENABLED=' "$runtime"; then
  printf '\nSTAGING_SECRET_LIFECYCLE_ENABLED=true\n' >> "$runtime"
else
  sed -i 's/^STAGING_SECRET_LIFECYCLE_ENABLED=.*/STAGING_SECRET_LIFECYCLE_ENABLED=true/' "$runtime"
fi
chmod 0640 "$runtime"
chown root:newchat-deploy "$runtime"
rm -f /tmp/newchat-vault-status.json

printf 'secret_lifecycle_provisioned=true\n'
printf 'vault_initialized=true\n'
printf 'vault_unsealed=true\n'
printf 'gateway_policy=secret-lifecycle-gateway\n'
printf 'vault_agent_auto_auth=cert\n'
printf 'static_vault_token_removed=true\n'
