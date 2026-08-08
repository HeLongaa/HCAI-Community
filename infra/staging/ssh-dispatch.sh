#!/bin/sh
set -eu

deploy_command=${NEWCHAT_STAGING_DEPLOY_COMMAND:-/opt/newchat-staging/bin/deploy-release}
original=${SSH_ORIGINAL_COMMAND:-}
prefix="$deploy_command "

case "$original" in
  "$prefix"*) artifact_sha256=${original#"$prefix"} ;;
  *) echo "Only the protected staging deployment command is allowed" >&2; exit 1 ;;
esac

case "$artifact_sha256" in
  *[!0-9a-f]*|'') echo "Release artifact SHA-256 is invalid" >&2; exit 1 ;;
esac
if [ "${#artifact_sha256}" -ne 64 ] || [ "$original" != "$prefix$artifact_sha256" ]; then
  echo "Release artifact SHA-256 is invalid" >&2
  exit 1
fi

exec "$deploy_command" "$artifact_sha256"
