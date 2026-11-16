#!/bin/sh
set -eu
umask 077

die() { printf 'Deployment: %s\n' "$*" >&2; exit 1; }

: "${DEPLOY_DIR:?Set the absolute path to the production directory}"
: "${DEPLOY_COMPOSE_PROJECT:?Set the production Compose project name}"
: "${CI_REGISTRY_IMAGE:?Enable GitLab Container Registry}"
case "$DEPLOY_DIR" in /*) ;; *) die 'DEPLOY_DIR must be an absolute path' ;; esac
case "${DEPLOY_MODE:-domain}" in domain|tunnel) ;; *) die 'DEPLOY_MODE must be domain or tunnel' ;; esac
[ -r "$DEPLOY_DIR/.env" ] || die 'The production .env must already exist on the deployment host'

attempt_file="$DEPLOY_DIR/latest-deployment-pipeline"
if [ -f "$attempt_file" ] && [ "$(cat "$attempt_file")" -gt "$CI_PIPELINE_IID" ]; then
    die 'A newer pipeline has already started deployment'
fi

# Bind-mounted configuration must outlive the runner checkout.
mkdir -p "$DEPLOY_DIR/releases"
release_dir=$(mktemp -d "$DEPLOY_DIR/releases/$CI_COMMIT_SHA.XXXXXX")
cp docker-compose.yml docker-compose.prod.yml docker-compose.tunnel.yml "$release_dir/"
mkdir -p "$release_dir/deploy/stand"
cp -R deploy/caddy "$release_dir/deploy/"
cp -R deploy/stand/backup "$release_dir/deploy/stand/"

compose_file="$release_dir/images.yml"
printf 'services:\n' > "$compose_file"
for component in core web converter max-adapter telegram-adapter; do
    reference=$(cat "artifacts/images/$component.ref")
    digest=${reference##*@}
    printf '%s\n' "$digest" | grep -Eq '^sha256:[a-f0-9]{64}$' \
        || die "Invalid image digest for $component"
    [ "$reference" = "$CI_REGISTRY_IMAGE/$component@$digest" ] \
        || die "Unexpected image repository for $component"
    printf '  %s:\n    image: "%s"\n' "$component" "$reference" >> "$compose_file"
    if [ "$component" = web ]; then
        printf '    volumes:\n      - ./runtime-config.js:/usr/share/nginx/html/runtime-config.js:ro\n' >> "$compose_file"
    fi
done

compose() {
    set -- -f "$compose_file" "$@"
    if [ "${DEPLOY_MODE:-domain}" = tunnel ]; then
        set -- -f "$release_dir/docker-compose.tunnel.yml" "$@"
    fi
    docker compose --project-directory "$release_dir" --env-file "$DEPLOY_DIR/.env" \
        -p "$DEPLOY_COMPOSE_PROJECT" -f "$release_dir/docker-compose.yml" \
        -f "$release_dir/docker-compose.prod.yml" "$@"
}

export APP_VERSION="$CI_COMMIT_SHA" APP_GIT_SHA="$CI_COMMIT_SHA"
if [ "${DEPLOY_MODE:-domain}" = tunnel ]; then
    export ACME_EMAIL=unused@example.invalid
fi

compose config --quiet
resolved_env=$(compose config --environment)
site_domain=$(printf '%s\n' "$resolved_env" | sed -n 's/^SITE_DOMAIN=//p')
printf '%s\n' "$site_domain" | grep -Eq '^[a-zA-Z0-9][a-zA-Z0-9.-]*$' \
    || die 'SITE_DOMAIN in .env must be a hostname without https:// or a path'
backup_dir=$(printf '%s\n' "$resolved_env" | sed -n 's/^BACKUP_DESTINATION=//p')
case "$backup_dir" in /*) ;; *) die 'BACKUP_DESTINATION must be an absolute path' ;; esac
[ -d "$backup_dir" ] || die 'BACKUP_DESTINATION does not exist on the deployment host'
bot_name=$(printf '%s\n' "$resolved_env" | sed -n 's/^VITE_MAX_BOT_NAME=//p')
unset resolved_env
if [ -n "$bot_name" ]; then
    printf '%s\n' "$bot_name" | grep -Eq '^[a-zA-Z0-9_]+$' \
        || die 'VITE_MAX_BOT_NAME must contain only the bot name'
fi
printf 'window.__LECTURER_CONFIG__ = {"maxBotName":"%s"};\n' "$bot_name" > "$release_dir/runtime-config.js"
chmod 644 "$release_dir/runtime-config.js"

# Keep registry credentials scoped to this job.
DOCKER_CONFIG=$(mktemp -d)
export DOCKER_CONFIG
trap 'rm -rf -- "$DOCKER_CONFIG"' EXIT
trap 'exit 1' HUP INT TERM
printf '%s\n' "$CI_REGISTRY_PASSWORD" |
    docker login --username "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"

set -- postgres core converter web max-adapter caddy
if compose config --services | grep -qx telegram-adapter; then
    set -- "$@" telegram-adapter
fi
compose pull "$@" db-backup

if [ -n "$(compose ps --all --quiet postgres)" ] || \
    docker volume inspect "${DEPLOY_COMPOSE_PROJECT}_postgres-data" >/dev/null 2>&1; then
    [ -n "$(compose ps --quiet db-backup)" ] \
        || die 'The existing stack must have db-backup running before it can be updated'
    compose exec -T db-backup /usr/local/bin/create-pair.sh
fi

printf '%s\n' "$CI_PIPELINE_IID" > "$release_dir/pipeline-id"
mv -f "$release_dir/pipeline-id" "$attempt_file"
compose up -d --no-build --wait --wait-timeout 300 "$@"
# The scheduled backup can take several minutes to publish its first pair.
compose up -d --no-build --no-deps db-backup

curl_public() { curl --silent --fail --max-time 10 "$@"; }
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if health=$(curl_public "https://$site_domain/health") &&
        printf '%s\n' "$health" | jq -e '.status == "UP"' >/dev/null &&
        info=$(curl_public "https://$site_domain/api/v1/system/info") &&
        printf '%s\n' "$info" | jq -e --arg version "$CI_COMMIT_SHA" '.version == $version' >/dev/null &&
        curl_public -o /dev/null "https://$site_domain/"; then
        printf '%s\n' "$release_dir" > "$release_dir/successful-release"
        mv -f "$release_dir/successful-release" "$DEPLOY_DIR/current-release"
        printf 'Deployed %s to https://%s/\n' "$CI_COMMIT_SHA" "$site_domain"
        exit 0
    fi
    [ "$attempt" = 12 ] || sleep 5
done
die "Public checks did not confirm $CI_COMMIT_SHA at https://$site_domain/"
