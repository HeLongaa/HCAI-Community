#!/bin/sh
set -eu

root=${NEWCHAT_STAGING_ROOT:-/opt/newchat-staging}
staging_group=${NEWCHAT_STAGING_GROUP:-newchat-deploy}
image_prefix=${NEWCHAT_RELEASE_IMAGE_PREFIX:-ghcr.io/helongaa/hcai-community}
manifest_source=${1:-}
expected_manifest_sha256=${2:-}
expected_source_commit=${3:-}
target_platform=linux/arm64

if [ "$(id -u)" -ne 0 ]; then
  echo "Supply-chain release import must run as root" >&2
  exit 1
fi
for command in docker jq sha256sum; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 1; }
done
test -f "$manifest_source" || { echo "Supply-chain digest manifest is missing" >&2; exit 1; }
case "$expected_manifest_sha256" in
  *[!0-9a-f]*|'') echo "Supply-chain manifest SHA-256 is invalid" >&2; exit 1 ;;
esac
if [ "${#expected_manifest_sha256}" -ne 64 ]; then
  echo "Supply-chain manifest SHA-256 must contain 64 lowercase hexadecimal characters" >&2
  exit 1
fi
case "$expected_source_commit" in
  *[!0-9a-f]*|'') echo "Expected source commit is invalid" >&2; exit 1 ;;
esac
if [ "${#expected_source_commit}" -ne 40 ]; then
  echo "Expected source commit must contain 40 lowercase hexadecimal characters" >&2
  exit 1
fi
case "$image_prefix" in
  *[!a-z0-9./_-]*|ghcr.io/|ghcr.io//*|ghcr.io/*/|ghcr.io/*//*|ghcr.io/*/*/*)
    echo "Release image prefix must identify an exact GHCR repository prefix" >&2
    exit 1
    ;;
  ghcr.io/*/*) ;;
  *) echo "Release image prefix must identify an exact GHCR repository prefix" >&2; exit 1 ;;
esac

install -d -m 0770 -g "$staging_group" "$root/artifacts"
manifest_copy=$(mktemp "$root/artifacts/.supply-chain-manifest.XXXXXX")
artifact_tmp=
cleanup() {
  status=$?
  trap - EXIT
  rm -f "$manifest_copy"
  if [ -n "$artifact_tmp" ]; then rm -f "$artifact_tmp"; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
cp "$manifest_source" "$manifest_copy"
if [ "$(wc -c < "$manifest_copy")" -gt 1048576 ]; then
  echo "Supply-chain digest manifest exceeds the 1 MiB limit" >&2
  exit 1
fi
observed_manifest_sha256=$(sha256sum "$manifest_copy" | cut -d' ' -f1)
if [ "$observed_manifest_sha256" != "$expected_manifest_sha256" ]; then
  echo "Supply-chain manifest SHA-256 does not match the approved value" >&2
  exit 1
fi

jq -e \
  --arg source "$expected_source_commit" \
  --arg prefix "$image_prefix" '
    . as $manifest
    | .schemaVersion == "production-image-digest-manifest-v1"
    and .registryReady == true
    and .sourceRevision == $source
    and ((.images | keys | sort) == ["api", "frontend", "migration", "worker"])
    and (["frontend", "api", "worker", "migration"] | all(. as $id |
      ($manifest.images[$id].target == (if $id == "migration" then "migrate" else $id end))
      and ($manifest.images[$id].digest | type == "string" and test("^sha256:[0-9a-f]{64}$"))
      and ($manifest.images[$id].reference == ($prefix + "-" + $id + "@" + $manifest.images[$id].digest))
      and (($manifest.images[$id].platforms | sort) == ["linux/amd64", "linux/arm64"])
      and (($manifest.images[$id].platformManifests | keys | sort) == ["linux/amd64", "linux/arm64"])
      and ($manifest.images[$id].platformManifests["linux/amd64"] | type == "string" and test("^sha256:[0-9a-f]{64}$"))
      and ($manifest.images[$id].platformManifests["linux/arm64"] | type == "string" and test("^sha256:[0-9a-f]{64}$"))
    ))
  ' "$manifest_copy" >/dev/null || {
    echo "Supply-chain digest manifest does not satisfy the deployable dual-platform contract" >&2
    exit 1
  }

for image_id in frontend api worker migration; do
  index_digest=$(jq -r ".images[\"$image_id\"].digest" "$manifest_copy")
  platform_digest=$(jq -r ".images[\"$image_id\"].platformManifests[\"linux/arm64\"]" "$manifest_copy")
  image=$(jq -r ".images[\"$image_id\"].reference" "$manifest_copy")
  docker pull --platform "$target_platform" "$image" >/dev/null
  observed_platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")
  if [ "$observed_platform" != "$target_platform" ]; then
    echo "$image_id image architecture does not match $target_platform" >&2
    exit 1
  fi
  if ! docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image" | grep -Fxq "$image"; then
    echo "$image_id image RepoDigest does not match the approved OCI index digest" >&2
    exit 1
  fi
  observed_id=$(docker image inspect --format '{{.Id}}' "$image")
  case "$observed_id" in
    sha256:*) observed_id_hex=${observed_id#sha256:} ;;
    *) observed_id_hex= ;;
  esac
  case "$observed_id_hex" in
    *[!0-9a-f]*|'') echo "$image_id local image ID is invalid" >&2; exit 1 ;;
  esac
  if [ "${#observed_id_hex}" -ne 64 ]; then
    echo "$image_id local image ID is invalid" >&2
    exit 1
  fi
  case "$image_id" in
    frontend)
      frontend_image=$image
      frontend_image_id=$observed_id
      frontend_index_digest=$index_digest
      frontend_platform_digest=$platform_digest
      ;;
    api)
      api_image=$image
      api_image_id=$observed_id
      api_index_digest=$index_digest
      api_platform_digest=$platform_digest
      ;;
    worker)
      worker_image=$image
      worker_image_id=$observed_id
      worker_index_digest=$index_digest
      worker_platform_digest=$platform_digest
      ;;
    migration)
      migration_image=$image
      migration_image_id=$observed_id
      migration_index_digest=$index_digest
      migration_platform_digest=$platform_digest
      ;;
  esac
done

artifact_sha256=$(
  {
    printf 'format=registry-digest-v1\n'
    printf 'source=%s\n' "$expected_source_commit"
    printf 'manifest=%s\n' "$expected_manifest_sha256"
    printf 'platform=%s\n' "$target_platform"
    printf 'frontend_index=%s\n' "$frontend_index_digest"
    printf 'frontend_platform=%s\n' "$frontend_platform_digest"
    printf 'api_index=%s\n' "$api_index_digest"
    printf 'api_platform=%s\n' "$api_platform_digest"
    printf 'worker_index=%s\n' "$worker_index_digest"
    printf 'worker_platform=%s\n' "$worker_platform_digest"
    printf 'migration_index=%s\n' "$migration_index_digest"
    printf 'migration_platform=%s\n' "$migration_platform_digest"
  } | sha256sum | cut -d' ' -f1
)

umask 077
artifact="$root/artifacts/$artifact_sha256.env"
artifact_tmp=$(mktemp "$root/artifacts/.$artifact_sha256.env.XXXXXX")
write_artifact_image() {
  upper=$1
  image=$2
  local_image_id=$3
  index_digest=$4
  platform_digest=$5
  printf '%s_IMAGE=%s\n' "$upper" "$image"
  printf '%s_IMAGE_ID=%s\n' "$upper" "$local_image_id"
  printf '%s_INDEX_DIGEST=%s\n' "$upper" "$index_digest"
  printf '%s_PLATFORM_DIGEST=%s\n' "$upper" "$platform_digest"
}
{
  printf 'ARTIFACT_FORMAT=registry-digest-v1\n'
  printf 'SOURCE_COMMIT=%s\n' "$expected_source_commit"
  printf 'SUPPLY_CHAIN_MANIFEST_SHA256=%s\n' "$expected_manifest_sha256"
  printf 'TARGET_PLATFORM=%s\n' "$target_platform"
  write_artifact_image FRONTEND "$frontend_image" "$frontend_image_id" "$frontend_index_digest" "$frontend_platform_digest"
  write_artifact_image API "$api_image" "$api_image_id" "$api_index_digest" "$api_platform_digest"
  write_artifact_image WORKER "$worker_image" "$worker_image_id" "$worker_index_digest" "$worker_platform_digest"
  write_artifact_image MIGRATION "$migration_image" "$migration_image_id" "$migration_index_digest" "$migration_platform_digest"
} > "$artifact_tmp"

if [ -e "$artifact" ]; then
  if ! cmp -s "$artifact_tmp" "$artifact"; then
    echo "A conflicting allowlisted artifact already exists" >&2
    exit 1
  fi
  rm -f "$artifact_tmp"
  artifact_tmp=
else
  mv "$artifact_tmp" "$artifact"
  artifact_tmp=
fi
chgrp "$staging_group" "$artifact"
chmod 0640 "$artifact"

printf 'artifact_sha256=%s\n' "$artifact_sha256"
printf 'source_commit=%s\n' "$expected_source_commit"
printf 'supply_chain_manifest_sha256=%s\n' "$expected_manifest_sha256"
printf 'target_platform=%s\n' "$target_platform"
