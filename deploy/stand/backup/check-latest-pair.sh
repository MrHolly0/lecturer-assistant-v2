#!/bin/sh
set -eu
: "${BACKUP_DESTINATION:?BACKUP_DESTINATION is required}"
latest_manifest=""
latest_time=0
for manifest in "$BACKUP_DESTINATION"/pair-*/manifest.properties; do
  [ -f "$manifest" ] || continue
  modified="$(stat -c %Y "$manifest")"
  if [ "$modified" -gt "$latest_time" ]; then
    latest_time="$modified"
    latest_manifest="$manifest"
  fi
done
[ -n "$latest_manifest" ] || { echo "no completed backup pair" >&2; exit 1; }
age=$(( $(date +%s) - latest_time ))
[ "$age" -le 93600 ] || { echo "latest backup pair is older than 26 hours" >&2; exit 1; }
"$(dirname "$0")/verify-pair.sh" "$(dirname "$latest_manifest")" >/dev/null
echo "latest backup pair age=${age}s"
