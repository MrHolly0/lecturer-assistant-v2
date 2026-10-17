#!/bin/sh
set -eu
pair="${1:?usage: verify-pair.sh PAIR_DIRECTORY}"
manifest="$pair/manifest.properties"
[ -f "$manifest" ] || { echo "manifest is missing" >&2; exit 1; }
value() { sed -n "s/^$1=//p" "$manifest"; }
[ "$(value format_version)" = "1" ] || { echo "unsupported backup format" >&2; exit 1; }
db_file="$(value database_file)"
blob_file="$(value blob_file)"
[ "$db_file" = "database.dump" ] || { echo "unexpected database file path" >&2; exit 1; }
[ "$blob_file" = "blob-data.tar.gz" ] || { echo "unexpected blob file path" >&2; exit 1; }
[ "$(sha256sum "$pair/$db_file" | cut -d ' ' -f 1)" = "$(value database_sha256)" ] \
  || { echo "database checksum mismatch" >&2; exit 1; }
[ "$(sha256sum "$pair/$blob_file" | cut -d ' ' -f 1)" = "$(value blob_sha256)" ] \
  || { echo "blob checksum mismatch" >&2; exit 1; }
pg_restore --list "$pair/$db_file" >/dev/null
tar -tzf "$pair/$blob_file" | awk 'BEGIN { bad=0 } /^\// || /(^|\/)\.\.(\/|$)/ { bad=1 } END { exit bad }'
tar -tzf "$pair/$blob_file" >/dev/null
echo "verified pair: $(value backup_id) project=$(value source_project) app=$(value app_version) schema=$(value flyway_version)"
