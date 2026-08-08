#!/bin/sh
set -eu

deploy_command=${NEWCHAT_STAGING_DEPLOY_COMMAND:-/opt/newchat-staging/bin/deploy-release}
infrastructure_command=${NEWCHAT_STAGING_INFRASTRUCTURE_COMMAND:-/opt/newchat-staging/bin/rehearse-infrastructure}
original=${SSH_ORIGINAL_COMMAND:-}
prefix="$deploy_command "

case "$original" in
  "$prefix"*)
    artifact_sha256=${original#"$prefix"}
    case "$artifact_sha256" in
      *[!0-9a-f]*|'') echo "Release artifact SHA-256 is invalid" >&2; exit 1 ;;
    esac
    if [ "${#artifact_sha256}" -ne 64 ] || [ "$original" != "$prefix$artifact_sha256" ]; then
      echo "Release artifact SHA-256 is invalid" >&2
      exit 1
    fi
    exec "$deploy_command" "$artifact_sha256"
    ;;
  "$infrastructure_command preflight "*|"$infrastructure_command execute "*)
    mode_and_sha=${original#"$infrastructure_command "}
    mode=${mode_and_sha%% *}
    source_sha=${mode_and_sha#"$mode "}
    case "$source_sha" in
      *[!0-9a-f]*|'') echo "Infrastructure rehearsal source SHA is invalid" >&2; exit 1 ;;
    esac
    if [ "${#source_sha}" -ne 40 ] || [ "$original" != "$infrastructure_command $mode $source_sha" ]; then
      echo "Infrastructure rehearsal source SHA is invalid" >&2
      exit 1
    fi
    exec "$infrastructure_command" "$mode" "$source_sha"
    ;;
  *) echo "Only protected staging commands are allowed" >&2; exit 1 ;;
esac
