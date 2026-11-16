#!/bin/sh
# Host dependencies: Docker Engine + Compose, a shell and standard file utilities.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
export APPLIANCE_STATE=${APPLIANCE_STATE:-"$ROOT/deploy/appliance/.state"}
export APPLIANCE_BACKUPS=${APPLIANCE_BACKUPS:-"$ROOT/deploy/appliance/.backups"}
export CONTROLLER_IMAGE=${CONTROLLER_IMAGE:-lecturer-appliance-controller:local}
compose() { docker compose -f "$ROOT/deploy/appliance/compose.yml" "$@"; }
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
  up) compose up -d --no-build --wait --wait-timeout 300 k3s edge controller ;;
  stop) compose stop controller edge k3s ;;
  status|backup|admin) compose run --rm --no-deps controller "$1" ;;
  restore)
    [ "$#" -eq 2 ] || { echo 'Usage: lecturer.sh restore BACKUP_DIRECTORY_NAME' >&2; exit 1; }
    case "$2" in *[!a-zA-Z0-9_-]*|'') echo 'Invalid backup directory name' >&2; exit 1;; esac
    compose stop controller
    compose up -d --no-build --wait k3s
    compose run --rm --no-deps controller restore --backup "/backups/$2" ;;
  logs) compose logs --tail=100 -f controller ;;
  kubectl) shift; compose exec k3s kubectl "$@" ;;
  load-images)
    [ "$#" -eq 2 ] || { echo 'Usage: lecturer.sh load-images DOCKER_SAVE_ARCHIVE' >&2; exit 1; }
    compose exec -T k3s ctr images import - < "$2" ;;
  *) echo 'Commands: build-controller, init SITE IMAGES, up, stop, status, backup, restore NAME, admin, logs, kubectl ...' ;;
esac
