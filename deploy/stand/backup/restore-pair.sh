#!/bin/sh
set -eu
pair="${1:?usage: restore-pair.sh PAIR_DIRECTORY TARGET_DATABASE EMPTY_BLOB_PARENT TARGET_ID}"
target_database="${2:?target database is required}"
blob_parent="${3:?empty blob parent is required}"
target_id="${4:?target id is required}"
: "${PGHOST:?PGHOST must point to the isolated restore PostgreSQL}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE must name the source/current database}"

case "$target_database" in *[!A-Za-z0-9_]*|'') echo "invalid target database name" >&2; exit 2 ;; esac
[ "$target_database" != "$PGDATABASE" ] || { echo "refusing to restore over PGDATABASE" >&2; exit 2; }
case "$blob_parent" in /*) ;; *) echo "blob parent must be an absolute path" >&2; exit 2 ;; esac
[ -d "$blob_parent" ] || { echo "blob parent must already exist" >&2; exit 2; }
[ -f "$blob_parent/.restore-target-id" ] || { echo "target identity marker is required" >&2; exit 2; }
[ "$(cat "$blob_parent/.restore-target-id")" = "$target_id" ] || {
  echo "target identity marker does not match; refusing to overwrite another project" >&2; exit 2;
}
extra="$(find "$blob_parent" -mindepth 1 -maxdepth 1 ! -name .restore-target-id -print -quit)"
[ -z "$extra" ] || { echo "blob restore destination is not empty; refusing to overwrite it" >&2; exit 2; }

"$(dirname "$0")/verify-pair.sh" "$pair"

# The database must exist and be empty. The script never drops or cleans a database.
exists="$(psql -XAtq -v ON_ERROR_STOP=1 -d postgres \
  -c "select exists(select 1 from pg_database where datname = '$target_database')")"
[ "$exists" = "t" ] || { echo "target database must be created in the isolated project first" >&2; exit 2; }
objects="$(psql -XAtq -v ON_ERROR_STOP=1 -d "$target_database" -c \
  "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and c.relkind in ('r','p','v','m','S','f')")"
[ "$objects" = "0" ] || { echo "target database contains objects; refusing to overwrite it" >&2; exit 2; }

stage="$blob_parent/.restore-stage-$$"
[ ! -e "$stage" ] || { echo "restore staging directory already exists" >&2; exit 2; }
mkdir -m 700 "$stage"
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT HUP INT TERM
blob_file="$(sed -n 's/^blob_file=//p' "$pair/manifest.properties")"
tar -xzf "$pair/$blob_file" -C "$stage" --no-same-owner --no-same-permissions
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
  -d "$target_database" "$pair/$(sed -n 's/^database_file=//p' "$pair/manifest.properties")"
for entry in "$stage"/* "$stage"/.[!.]*; do
  [ -e "$entry" ] || continue
  mv "$entry" "$blob_parent/"
done
rmdir "$stage"
trap - EXIT HUP INT TERM
echo "restored pair $(sed -n 's/^backup_id=//p' "$pair/manifest.properties") to database=$target_database blobs=$blob_parent"
