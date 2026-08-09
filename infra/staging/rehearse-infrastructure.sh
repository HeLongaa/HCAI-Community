#!/bin/sh
set -eu
umask 027

root=${NEWCHAT_STAGING_ROOT:-/opt/newchat-staging}
repository=${NEWCHAT_REHEARSAL_REPOSITORY:-https://github.com/HeLongaa/HCAI-Community.git}
mode=${1:-}
source_sha=${2:-}
rehearsal_root="$root/release-01"
source_dir="$rehearsal_root/source"
runtime="$root/secrets/release-infrastructure.env"
lock="$rehearsal_root/rehearsal.lock"

case "$mode" in preflight|execute) ;; *) echo "Infrastructure rehearsal mode is invalid" >&2; exit 1 ;; esac
case "$source_sha" in *[!0-9a-f]*|'') echo "Infrastructure rehearsal source SHA is invalid" >&2; exit 1 ;; esac
if [ "${#source_sha}" -ne 40 ]; then
  echo "Infrastructure rehearsal source SHA must contain 40 lowercase hexadecimal characters" >&2
  exit 1
fi
if [ ! -f "$runtime" ]; then
  echo "Infrastructure rehearsal runtime configuration is missing" >&2
  exit 1
fi

install -d -m 0770 "$rehearsal_root"
install -d -m 0770 "$rehearsal_root/tmp"
TMPDIR="$rehearsal_root/tmp"
export TMPDIR
touch "$lock"
chmod 0660 "$lock"
exec 9>"$lock"
flock -w 1800 9

if [ "$mode" = preflight ]; then
  if [ ! -d "$source_dir/.git" ]; then
    git clone --no-checkout "$repository" "$source_dir" >/dev/null 2>&1
  fi
  git -C "$source_dir" fetch --quiet --no-tags origin "$source_sha"
  git -C "$source_dir" checkout --quiet --detach "$source_sha"
  git -C "$source_dir" clean -ffdx >/dev/null
  npm --prefix "$source_dir" ci --ignore-scripts --no-audit --no-fund >/dev/null
  npm --prefix "$source_dir/server" ci --ignore-scripts --no-audit --no-fund >/dev/null
else
  if [ ! -d "$source_dir/.git" ] || [ "$(git -C "$source_dir" rev-parse HEAD)" != "$source_sha" ]; then
    echo "Infrastructure execute source does not match its preflight" >&2
    exit 1
  fi
fi

if [ -n "$(git -C "$source_dir" status --porcelain --untracked-files=no)" ]; then
  echo "Infrastructure rehearsal source must be clean" >&2
  exit 1
fi

cd "$source_dir"
set -a
. "$runtime"
set +a

if [ "$mode" = execute ]; then
  docker compose --project-name newchat-release-rehearsal --file "$source_dir/infra/release-rehearsal.compose.yml" up --detach --wait postgres redis >/dev/null
  postgres_container=newchat-release-rehearsal-postgres-1
  docker exec "$postgres_container" psql -U release -d postgres -v ON_ERROR_STOP=1 -Atc \
    "SELECT 'CREATE DATABASE newchat_restore_rehearsal' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'newchat_restore_rehearsal')" |
    docker exec -i "$postgres_container" psql -U release -d postgres -v ON_ERROR_STOP=1 >/dev/null

  client_bin="$rehearsal_root/postgres-client"
  install -d -m 0770 "$client_bin"
  for client in psql pg_dump pg_restore; do
    wrapper="$client_bin/$client"
    printf '%s\n' '#!/bin/sh' "exec docker run --rm --network host --volume '$source_dir:$source_dir' --workdir '$source_dir' postgres:16.10-bookworm $client \"\$@\"" > "$wrapper"
    chmod 0750 "$wrapper"
  done
  PATH="$client_bin:$PATH"
  export PATH
fi

log="$rehearsal_root/$mode.log"
rm -f "$log"
if ! node scripts/rehearse-release-infrastructure.mjs --profile=env --mode="$mode" >"$log" 2>&1; then
  echo "Infrastructure rehearsal failed; inspect the protected server log" >&2
  exit 1
fi

if [ "$mode" = preflight ]; then
  evidence="$source_dir/.artifacts/release-infrastructure/target-preflight.json"
else
  evidence="$source_dir/.artifacts/release-infrastructure/latest.json"
fi
if [ ! -s "$evidence" ]; then
  echo "Infrastructure rehearsal did not produce evidence" >&2
  exit 1
fi
cat "$evidence"
