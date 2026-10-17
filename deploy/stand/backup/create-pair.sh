#!/bin/sh
set -eu

: "${BACKUP_DESTINATION:?BACKUP_DESTINATION must be a separately mounted backup destination}"
: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${BACKUP_SOURCE_PROJECT:?BACKUP_SOURCE_PROJECT is required}"
: "${BLOB_SOURCE:=/blob-source}"
: "${BACKUP_KEEP_DAYS:=14}"
: "${BACKUP_LOCK_WAIT_SECONDS:=1800}"
: "${APP_VERSION:=unknown}"
: "${APP_GIT_SHA:=unknown}"
case "$BACKUP_LOCK_WAIT_SECONDS" in *[!0-9]*|'') echo "BACKUP_LOCK_WAIT_SECONDS must be an integer" >&2; exit 2 ;; esac
case "$BACKUP_KEEP_DAYS" in *[!0-9]*|'') echo "BACKUP_KEEP_DAYS must be an integer" >&2; exit 2 ;; esac
case "$BACKUP_DESTINATION" in /*) ;; *) echo "BACKUP_DESTINATION must be an absolute directory" >&2; exit 2 ;; esac
[ -d "$BLOB_SOURCE" ] || { echo "BLOB_SOURCE must be an existing directory" >&2; exit 2; }

mkdir -p "$BACKUP_DESTINATION"
backup_root="$(cd "$BACKUP_DESTINATION" && pwd -P)"
blob_root="$(cd "$BLOB_SOURCE" && pwd -P)"
[ "$backup_root" != "/" ] || { echo "BACKUP_DESTINATION cannot be filesystem root" >&2; exit 2; }
case "$backup_root/" in "$blob_root/"*) echo "BACKUP_DESTINATION cannot be inside BLOB_SOURCE" >&2; exit 2 ;; esac
case "$blob_root/" in "$backup_root/"*) echo "BLOB_SOURCE cannot be inside BACKUP_DESTINATION" >&2; exit 2 ;; esac
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
random_suffix="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
[ -n "$random_suffix" ] || { echo "could not create unique backup lock name" >&2; exit 1; }
final="$BACKUP_DESTINATION/pair-$stamp"
tmp="$BACKUP_DESTINATION/.partial-$stamp-$$-$random_suffix"
lock_app="blob-backup-$stamp-$$-$random_suffix"
sql_lock_app="$(printf '%s' "$lock_app" | sed "s/'/''/g")"
sql_lock_db="$(printf '%s' "$PGDATABASE" | sed "s/'/''/g")"
guard_pid=""
tmp_created=0
release_guard() {
  if [ -n "$guard_pid" ]; then
    # Terminate the exact generated session whether it holds or is still waiting for the lock.
    psql -Xq -v ON_ERROR_STOP=1 -d postgres \
      -c "select pg_terminate_backend(a.pid) from pg_stat_activity a
          where a.application_name = '$sql_lock_app' and a.datname = '$sql_lock_db'" \
      >/dev/null 2>&1 || true
    kill "$guard_pid" 2>/dev/null || true
    wait "$guard_pid" 2>/dev/null || true
    guard_pid=""
    remaining=unknown
    attempt=0
    while [ "$attempt" -lt 10 ]; do
      remaining="$(psql -XAtq -v ON_ERROR_STOP=1 -d postgres \
        -c "select exists(select 1 from pg_stat_activity a
            where a.application_name = '$sql_lock_app' and a.datname = '$sql_lock_db')" 2>/dev/null)" \
        || remaining=unknown
      [ "$remaining" = "f" ] && break
      attempt=$((attempt + 1))
      sleep 0.1
    done
    [ "$remaining" = "f" ] || { echo "blob snapshot lock session did not terminate" >&2; return 1; }
  fi
}
cleanup() {
  release_guard || true
  if [ "$tmp_created" = 1 ]; then rm -rf "$tmp"; fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
[ ! -e "$final" ] || { echo "backup pair already exists: $final" >&2; exit 1; }
[ ! -e "$tmp" ] || { echo "backup temporary directory already exists: $tmp" >&2; exit 1; }
mkdir -m 700 "$tmp"
tmp_created=1

# The application takes this transaction advisory lock around every blob write/delete.
PGAPPNAME="$lock_app" psql -Xq -v ON_ERROR_STOP=1 -d "$PGDATABASE" \
  -c 'select pg_advisory_lock(14713, 2525); select pg_sleep(86400);' >/dev/null 2>&1 &
guard_pid=$!
locked=0
attempt=0
while [ "$attempt" -lt "$BACKUP_LOCK_WAIT_SECONDS" ]; do
  locked="$(psql -XAtq -v ON_ERROR_STOP=1 -d postgres -c \
    "select exists(select 1 from pg_locks l join pg_stat_activity a using (pid) where a.application_name = '$lock_app' and l.locktype = 'advisory' and l.classid = 14713 and l.objid = 2525 and l.objsubid = 2 and l.granted)")"
  [ "$locked" = "t" ] && break
  kill -0 "$guard_pid" 2>/dev/null || { echo "could not acquire blob snapshot lock" >&2; exit 1; }
  attempt=$((attempt + 1))
  sleep 1
done
[ "$locked" = "t" ] || { echo "timed out acquiring blob snapshot lock" >&2; exit 1; }

pg_dump --format=custom --no-owner --no-privileges -f "$tmp/database.dump" -d "$PGDATABASE"
tar -C "$BLOB_SOURCE" -czf "$tmp/blob-data.tar.gz" .
pg_restore --list "$tmp/database.dump" >/dev/null
tar -tzf "$tmp/blob-data.tar.gz" >/dev/null
schema_version="$(psql -XAtq -v ON_ERROR_STOP=1 -d "$PGDATABASE" -c \
  "select coalesce((select version from shared.flyway_schema_history where success order by installed_rank desc limit 1), 'baseline')")"
database_sha="$(sha256sum "$tmp/database.dump" | cut -d ' ' -f 1)"
blob_sha="$(sha256sum "$tmp/blob-data.tar.gz" | cut -d ' ' -f 1)"
cat > "$tmp/manifest.properties" <<MANIFEST
format_version=1
backup_id=$stamp
created_utc=$stamp
source_project=$BACKUP_SOURCE_PROJECT
app_version=$APP_VERSION
app_git_sha=$APP_GIT_SHA
flyway_version=$schema_version
postgres_major=16
database_file=database.dump
database_sha256=$database_sha
blob_file=blob-data.tar.gz
blob_sha256=$blob_sha
MANIFEST

chmod 600 "$tmp"/*
release_guard
mv "$tmp" "$final"
trap - EXIT HUP INT TERM
echo "backup pair created: $final (db=$database_sha blobs=$blob_sha schema=$schema_version)"
for old_pair in "$BACKUP_DESTINATION"/pair-*; do
  [ -d "$old_pair" ] || continue
  [ -f "$old_pair/manifest.properties" ] || continue
  old_project="$(sed -n 's/^source_project=//p' "$old_pair/manifest.properties")"
  [ "$old_project" = "$BACKUP_SOURCE_PROJECT" ] || continue
  find "$old_pair" -maxdepth 0 -type d -mtime "+$BACKUP_KEEP_DAYS" -exec rm -rf -- {} +
done
