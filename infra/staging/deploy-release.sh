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

verify_image "$FRONTEND_IMAGE" "$FRONTEND_IMAGE_ID"
verify_image "$API_IMAGE" "$API_IMAGE_ID"
verify_image "$WORKER_IMAGE" "$WORKER_IMAGE_ID"
verify_image "$MIGRATION_IMAGE" "$MIGRATION_IMAGE_ID"

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

health=$(curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${APP_PORT:-8080}/health")
printf '%s' "$health" | grep -Fq "$artifact_sha256"
printf 'deployed_artifact_sha256=%s\n' "$artifact_sha256"
