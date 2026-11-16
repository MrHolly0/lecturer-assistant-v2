#!/bin/sh
# Host dependencies: Docker Engine + Compose, a shell and standard file utilities.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
export APPLIANCE_STATE=${APPLIANCE_STATE:-"$ROOT/deploy/appliance/.state"}
export APPLIANCE_BACKUPS=${APPLIANCE_BACKUPS:?Set an independent backup directory; do not use the installation disk}
export CONTROLLER_IMAGE=${CONTROLLER_IMAGE:-lecturer-appliance-controller:local}
compose() { if [ -f "$APPLIANCE_STATE/runtime.env" ]; then set -a; . "$APPLIANCE_STATE/runtime.env"; set +a; fi; docker compose -f "$ROOT/deploy/appliance/compose.yml" "$@"; }
check_capacity() {
  set -a; . "$APPLIANCE_STATE/runtime.env"; set +a
  available=$(docker info --format '{{.MemTotal}}')
  required=$(( (${CLUSTER_MEMORY%m} + 1024) * 1024 * 1024 ))
  [ "$available" -ge "$required" ] || { echo 'Docker has too little physical memory for this installation budget; adjust and revalidate the site configuration.' >&2; exit 1; }
  [ "$(docker info --format '{{.NCPU}}')" -ge "$CLUSTER_CPUS" ] || { echo 'Docker has fewer CPUs than the configured cluster budget.' >&2; exit 1; }
}
case ${1:-help} in
  build-controller) docker build -f "$ROOT/deploy/appliance/Dockerfile" -t "$CONTROLLER_IMAGE" "$ROOT" ;;
  init)
    [ "$#" -eq 3 ] || { echo 'Usage: lecturer.sh init site.json images.json' >&2; exit 1; }
    [ ! -e "$APPLIANCE_STATE/secrets.json" ] || { echo 'Installation already initialized' >&2; exit 1; }
    umask 077
    mkdir -p "$APPLIANCE_STATE" "$APPLIANCE_BACKUPS"
    cp "$2" "$APPLIANCE_STATE/site.json"
    cp "$3" "$APPLIANCE_STATE/images.json"
    docker run --rm -v "$APPLIANCE_STATE:/state" "$CONTROLLER_IMAGE" init ;;
  up) check_capacity; compose up -d --no-build --wait --wait-timeout 300 k3s edge controller backup ;;
  stop) compose stop backup controller edge k3s ;;
  status|backup|admin) compose run --rm --no-deps controller "$1" ;;
  restore)
    [ "$#" -ge 2 ] || { echo 'Usage: lecturer.sh restore BACKUP_NAME [OFFLINE_PRIVATE_KEY]' >&2; exit 1; }
    case "$2" in *[!a-zA-Z0-9_.-]*|''|.*|*..*) echo 'Invalid backup directory name' >&2; exit 1;; esac
    compose stop backup controller
    compose up -d --no-build --wait k3s
    case "$2" in
      *.cms)
        [ "$#" -eq 3 ] && [ -f "$3" ] || { echo 'Provide the offline private recovery key' >&2; exit 1; }
        compose run --rm --no-deps -v "$3:/recovery/key:ro" controller restore --backup "/backups/$2" --recovery-key /recovery/key ;;
      *) compose run --rm --no-deps controller restore --backup "/backups/$2" ;;
    esac ;;
  logs) compose logs --tail=100 -f controller ;;
  kubectl) shift; compose exec k3s kubectl "$@" ;;
  load-images)
    [ "$#" -eq 2 ] || { echo 'Usage: lecturer.sh load-images DOCKER_SAVE_ARCHIVE' >&2; exit 1; }
    compose exec -T k3s ctr images import - < "$2" ;;
  *) echo 'Commands: build-controller, init SITE IMAGES, up, stop, status, backup, restore NAME, admin, logs, kubectl ...' ;;
esac
