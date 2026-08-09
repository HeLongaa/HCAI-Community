#!/bin/sh
set -eu

root=${NEWCHAT_STAGING_ROOT:-/opt/newchat-staging}
artifact_sha256=${1:-}

case "$artifact_sha256" in
  *[!0-9a-f]*|'') echo "Release artifact SHA-256 is invalid" >&2; exit 1 ;;
esac
if [ "${#artifact_sha256}" -ne 64 ]; then
  echo "Release artifact SHA-256 must contain 64 lowercase hexadecimal characters" >&2
  exit 1
fi

manifest="$root/artifacts/$artifact_sha256.env"
runtime="$root/secrets/runtime.env"
if [ ! -f "$manifest" ]; then
  echo "Release artifact is not allowlisted on this staging host" >&2
  exit 1
fi
if [ ! -f "$runtime" ]; then
  echo "Staging runtime configuration is missing" >&2
  exit 1
fi

set -a
. "$runtime"
. "$manifest"
RELEASE_ARTIFACT_SHA256=$artifact_sha256
export RELEASE_ARTIFACT_SHA256
set +a

verify_image() {
  image=$1
  expected=$2
  observed=$(docker image inspect --format '{{.Id}}' "$image")
  if [ "$observed" != "$expected" ]; then
    echo "Staging image identity does not match its allowlisted manifest" >&2
    exit 1
  fi
}

verify_registry_image() {
  image=$1
  expected_id=$2
  expected_index_digest=$3
  expected_platform_digest=$4
  label=$5
  if [ "${TARGET_PLATFORM:-}" != "linux/arm64" ]; then
    echo "Registry artifact target platform is not supported by this staging host" >&2
    exit 1
  fi
  for expected_digest in "$expected_index_digest" "$expected_platform_digest"; do
    case "$expected_digest" in
      sha256:*) expected_digest_hex=${expected_digest#sha256:} ;;
      *) expected_digest_hex= ;;
    esac
    case "$expected_digest_hex" in
      *[!0-9a-f]*|'') echo "$label artifact digest is invalid" >&2; exit 1 ;;
    esac
    if [ "${#expected_digest_hex}" -ne 64 ]; then
      echo "$label artifact digest is invalid" >&2
      exit 1
    fi
  done
  case "$image" in
    ghcr.io/*@"$expected_index_digest") ;;
    *) echo "$label image is not pinned to its allowlisted OCI index digest" >&2; exit 1 ;;
  esac
  observed_platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")
  if [ "$observed_platform" != "$TARGET_PLATFORM" ]; then
    echo "$label image architecture does not match its allowlisted target platform" >&2
    exit 1
  fi
  if ! docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image" | grep -Fxq "$image"; then
    echo "$label image RepoDigest does not match its allowlisted OCI index digest" >&2
    exit 1
  fi
  verify_image "$image" "$expected_id"
}

case "${ARTIFACT_FORMAT:-local-image-id-v1}" in
  local-image-id-v1)
    verify_image "$FRONTEND_IMAGE" "$FRONTEND_IMAGE_ID"
    verify_image "$API_IMAGE" "$API_IMAGE_ID"
    verify_image "$WORKER_IMAGE" "$WORKER_IMAGE_ID"
    verify_image "$MIGRATION_IMAGE" "$MIGRATION_IMAGE_ID"
    ;;
  registry-digest-v1)
    verify_registry_image "$FRONTEND_IMAGE" "$FRONTEND_IMAGE_ID" "$FRONTEND_INDEX_DIGEST" "$FRONTEND_PLATFORM_DIGEST" frontend
    verify_registry_image "$API_IMAGE" "$API_IMAGE_ID" "$API_INDEX_DIGEST" "$API_PLATFORM_DIGEST" api
    verify_registry_image "$WORKER_IMAGE" "$WORKER_IMAGE_ID" "$WORKER_INDEX_DIGEST" "$WORKER_PLATFORM_DIGEST" worker
    verify_registry_image "$MIGRATION_IMAGE" "$MIGRATION_IMAGE_ID" "$MIGRATION_INDEX_DIGEST" "$MIGRATION_PLATFORM_DIGEST" migration
    ;;
  *) echo "Release artifact format is unsupported" >&2; exit 1 ;;
esac

lock="$root/deploy.lock"
if [ ! -w "$lock" ]; then
  echo "Staging deployment lock is not writable by the deployment user" >&2
  exit 1
fi
exec 9>"$lock"
flock -w 900 9

set -- docker compose \
  --project-name newchat-staging \
  --file "$root/source/infra/production.compose.yml" \
  --file "$root/source/infra/staging.compose.yml"
if [ "${STAGING_SECRET_LIFECYCLE_ENABLED:-false}" = "true" ]; then
  set -- "$@" --file "$root/source/infra/staging-secret-lifecycle.compose.yml"
fi
"$@" up --detach --no-build --wait --wait-timeout 600

# Compose does not recreate the gateway when only its bind-mounted Caddyfile changes.
# Recreate that stateless service after the application is healthy so new routes apply.
"$@" up --detach --no-build --no-deps --force-recreate --wait --wait-timeout 60 gateway

health=$(curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${APP_PORT:-8080}/health")
printf '%s' "$health" | grep -Fq "$artifact_sha256"
readiness=$(curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${APP_PORT:-8080}/ready")
printf '%s' "$readiness" | grep -Fq "$artifact_sha256"
printf '%s' "$readiness" | grep -Fq '"status":"ready"'
printf 'deployed_artifact_sha256=%s\n' "$artifact_sha256"
