#!/bin/sh
# Sourced by lecturer-k8s.sh. Snapshot the actual mounted PVC, including external NFS.
cmd_backup() (
  set -eu
  require_init
  umask 077
  backup_root="${BACKUP_DIR:-$HOME/lecturer-k8s-backups}"
  mkdir -p "$backup_root"
  backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  backup_final="$backup_root/$backup_stamp"
  [ ! -e "$backup_final" ] || die "backup already exists"
  backup_tmp="$(mktemp -d "$backup_root/.partial-$backup_stamp.XXXXXX")"
  backup_app_pod="$(primary_pod app-db)"
  backup_analytics_pod="$(primary_pod analytics-db)"
  backup_guard="la-backup-$backup_stamp"
  backup_guard_pid=''

  backup_sql() {
    kc -n "$NS" exec "$backup_app_pod" -c postgres -- psql -XAtq -v ON_ERROR_STOP=1 -d lecturer -c "$1"
  }
  backup_lock_exists() {
    backup_sql "select exists(select 1 from pg_locks l join pg_stat_activity a using (pid)
      where a.application_name='$backup_guard' and l.locktype='advisory'
      and l.classid=14713 and l.objid=2525 and l.objsubid=2 and l.granted)" | tr -d '\r\n '
  }
  backup_cleanup() {
    if [ -n "$backup_guard_pid" ]; then
      backup_sql "select pg_terminate_backend(pid) from pg_stat_activity
        where application_name='$backup_guard' and datname='lecturer'" >/dev/null 2>&1 || true
      kill "$backup_guard_pid" 2>/dev/null || true
      wait "$backup_guard_pid" 2>/dev/null || true
    fi
    [ ! -d "$backup_tmp" ] || rm -rf "$backup_tmp"
  }
  trap backup_cleanup EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  step "Согласованная резервная копия в $backup_final"
  # All application blob mutations take this lock. Keep the exact primary/session
  # for the whole snapshot and fail if it disappears (including primary failover).
  kc -n "$NS" exec "$backup_app_pod" -c postgres -- env "PGAPPNAME=$backup_guard" \
    'PGOPTIONS=-c statement_timeout=0 -c lock_timeout=60s' \
    psql -Xq -v ON_ERROR_STOP=1 -d lecturer \
    -c 'select pg_advisory_lock(14713,2525); select pg_sleep(1800);' </dev/null >/dev/null 2>&1 &
  backup_guard_pid=$!
  backup_attempt=0
  until [ "$(backup_lock_exists)" = t ]; do
    kill -0 "$backup_guard_pid" 2>/dev/null || die "не удалось получить блокировку файлов"
    backup_attempt=$((backup_attempt + 1))
    [ "$backup_attempt" -le 65 ] || die "ожидание блокировки файлов истекло"
    sleep 1
  done
  kc -n "$NS" exec "$backup_app_pod" -c postgres -- pg_dump -Fc -d lecturer > "$backup_tmp/lecturer.dump"
  # Read through the application's actual PVC, not /srv/nfs on the first server.
  kc -n "$NS" exec deployment/core -- tar -czf - -C /data blobs > "$backup_tmp/lecturer-blobs.tar.gz"
  [ "$(backup_lock_exists)" = t ] || die "блокировка потеряна: резервная копия отклонена"
  kc -n "$NS" exec "$backup_analytics_pod" -c postgres -- pg_dump -Fc -d analytics > "$backup_tmp/analytics.dump"
  kc -n "$NS" exec -i "$backup_app_pod" -c postgres -- pg_restore --list < "$backup_tmp/lecturer.dump" >/dev/null
  kc -n "$NS" exec -i "$backup_analytics_pod" -c postgres -- pg_restore --list < "$backup_tmp/analytics.dump" >/dev/null
  tar -tzf "$backup_tmp/lecturer-blobs.tar.gz" >/dev/null
  backup_sql "select version from shared.flyway_schema_history where success order by installed_rank desc limit 1" \
    > "$backup_tmp/flyway-version.txt"
  [ ! -f "$IMAGES" ] || cp "$IMAGES" "$backup_tmp/images.json"
  (cd "$backup_tmp" && shasum -a 256 ./* > SHA256SUMS)
  mv "$backup_tmp" "$backup_final"
  ls -lh "$backup_final"
)
