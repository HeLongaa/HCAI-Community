#!/bin/sh
set -eu

root=${NEWCHAT_STAGING_ROOT:-/opt/newchat-staging}
staging_group=${NEWCHAT_STAGING_GROUP:-newchat-deploy}
source_dir=${1:-}

if [ ! -d "$source_dir/.git" ] && [ ! -f "$source_dir/.git" ]; then
  echo "Build source must be a Git checkout" >&2
  exit 1
fi

commit=$(git -C "$source_dir" rev-parse HEAD)
case "$commit" in
  *[!0-9a-f]*|'') echo "Build source commit is invalid" >&2; exit 1 ;;
esac
if [ "${#commit}" -ne 40 ]; then
  echo "Build source commit must be a full Git SHA" >&2
  exit 1
fi
if [ -n "$(git -C "$source_dir" status --porcelain)" ]; then
  echo "Build source must be clean" >&2
  exit 1
fi

install -d -m 0770 -g "$staging_group" "$root/artifacts"

for target in frontend api worker migrate; do
  image="newchat-staging-$target:$commit"
  if [ "$target" = frontend ]; then
    docker build --target "$target" --build-arg "VITE_APP_RELEASE=$commit" --tag "$image" "$source_dir"
  else
    docker build --target "$target" --tag "$image" "$source_dir"
  fi
done

frontend_id=$(docker image inspect --format '{{.Id}}' "newchat-staging-frontend:$commit")
api_id=$(docker image inspect --format '{{.Id}}' "newchat-staging-api:$commit")
worker_id=$(docker image inspect --format '{{.Id}}' "newchat-staging-worker:$commit")
migration_id=$(docker image inspect --format '{{.Id}}' "newchat-staging-migrate:$commit")

artifact_sha256=$(
  printf '%s\n' \
    "commit=$commit" \
    "frontend=$frontend_id" \
    "api=$api_id" \
    "worker=$worker_id" \
    "migration=$migration_id" |
    sha256sum | cut -d' ' -f1
)

umask 077
manifest_tmp="$root/artifacts/$artifact_sha256.env.tmp"
manifest="$root/artifacts/$artifact_sha256.env"
{
  printf 'SOURCE_COMMIT=%s\n' "$commit"
  printf 'FRONTEND_IMAGE=%s\n' "newchat-staging-frontend:$commit"
  printf 'FRONTEND_IMAGE_ID=%s\n' "$frontend_id"
  printf 'API_IMAGE=%s\n' "newchat-staging-api:$commit"
  printf 'API_IMAGE_ID=%s\n' "$api_id"
  printf 'WORKER_IMAGE=%s\n' "newchat-staging-worker:$commit"
  printf 'WORKER_IMAGE_ID=%s\n' "$worker_id"
  printf 'MIGRATION_IMAGE=%s\n' "newchat-staging-migrate:$commit"
  printf 'MIGRATION_IMAGE_ID=%s\n' "$migration_id"
} > "$manifest_tmp"
mv "$manifest_tmp" "$manifest"
chgrp "$staging_group" "$manifest"
chmod 0640 "$manifest"

printf 'artifact_sha256=%s\n' "$artifact_sha256"
printf 'source_commit=%s\n' "$commit"
