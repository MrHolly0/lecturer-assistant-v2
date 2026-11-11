#!/usr/bin/env sh
# Lecturer Assistant на облачном сервере: одна команда для установки и обслуживания.
#
#   sh deploy/cloud/lecturer.sh init         один раз: спросит адрес и бота, создаст .env с секретами
#   sh deploy/cloud/lecturer.sh up           собрать и запустить (повторный запуск безопасен)
#   sh deploy/cloud/lecturer.sh admin        создать первого администратора
#   sh deploy/cloud/lecturer.sh seed         добавить тестовые данные (курс, лекция, учётки)
#   sh deploy/cloud/lecturer.sh lock-setup   закрыть создание администратора после настройки
#   sh deploy/cloud/lecturer.sh status       контейнеры и проверка сайта снаружи
#   sh deploy/cloud/lecturer.sh logs [сервис]
#   sh deploy/cloud/lecturer.sh update       git pull + up
#   sh deploy/cloud/lecturer.sh backup       сделать резервную копию прямо сейчас
#   sh deploy/cloud/lecturer.sh stop         остановить (данные сохраняются)
#
# Два режима публикации (PUBLIC_MODE в .env):
#   domain — у сервера свой домен; Caddy слушает 80/443 и сам получает сертификат Let's Encrypt.
#   tunnel — HTTPS даёт туннель (например, Tuna); Caddy слушает HTTP на 127.0.0.1:TUNNEL_PORT.
set -eu

cd "$(dirname "$0")/../.."
PROJECT=lecturer-assistant
ENV_FILE=.env

say() { printf '%s\n' "$*"; }
die() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }

env_value() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 || true; }

set_value() {
  key="$1"; value="$2"
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  if grep -q "^$key=" "$ENV_FILE"; then
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" 'index($0, k"=")==1 {print k"="v; next} {print}' "$ENV_FILE" > "$tmp"
    cat "$tmp" > "$ENV_FILE" && rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

ask() {
  key="$1"; prompt="$2"; default="${3:-}"
  [ -n "$(env_value "$key")" ] && return 0
  if [ -n "$default" ]; then printf '%s [%s]: ' "$prompt" "$default"; else printf '%s: ' "$prompt"; fi
  read -r answer
  answer="${answer:-$default}"
  [ -n "$answer" ] || die "$key обязателен"
  set_value "$key" "$answer"
}

mode() { m="$(env_value PUBLIC_MODE)"; echo "${m:-domain}"; }
domain() { env_value SITE_DOMAIN; }

compose() {
  if [ "$(mode)" = tunnel ]; then
    docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml "$@"
  else
    docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.prod.yml "$@"
  fi
}

require_env() {
  [ -n "$(env_value JWT_SECRET)" ] && [ -n "$(domain)" ] \
    || die "нет настроенного .env. Сначала: sh deploy/cloud/lecturer.sh init"
}

check_site() {
  sh deploy/stand/check.sh "$(domain)"
}

cmd_init() {
  command -v openssl >/dev/null || die "нужен openssl"
  say "Настройка .env (уже заданные значения не меняются)."

  if [ -z "$(env_value PUBLIC_MODE)" ]; then
    say "Как сайт будет доступен из интернета?"
    say "  domain — у сервера свой домен, A-запись указывает на его IP (рекомендуется)"
    say "  tunnel — через туннель (Tuna и т.п.), порты 80/443 открывать не нужно"
  fi
  ask PUBLIC_MODE "Режим (domain/tunnel)" domain
  case "$(mode)" in domain|tunnel) ;; *) die "PUBLIC_MODE должен быть domain или tunnel" ;; esac

  if [ "$(mode)" = tunnel ]; then
    ask SITE_DOMAIN "Публичный адрес туннеля без https:// (например, lecturer-assistant.ru.tuna.am)"
    set_value ACME_EMAIL unused@example.invalid
    ask TUNNEL_PORT "Локальный порт, на который смотрит туннель" 18088
    sh deploy/stand/init-env.sh
  else
    sh deploy/stand/init-env.sh --vps
  fi

  # Создание первого администратора открыто, пока задан этот токен; закрывается lock-setup.
  [ -n "$(env_value ADMIN_SETUP_TOKEN)" ] || set_value ADMIN_SETUP_TOKEN "$(openssl rand -hex 32)"

  if [ -z "$(env_value BACKUP_DESTINATION)" ]; then
    if [ -w /var/backups ]; then default_backup=/var/backups/lecturer-assistant
    else default_backup="$HOME/lecturer-assistant-backups"; fi
    ask BACKUP_DESTINATION "Каталог для резервных копий (лучше на отдельном диске)" "$default_backup"
  fi
  mkdir -p "$(env_value BACKUP_DESTINATION)"

  say ""
  say "Готово: .env создан с правами 600. Сохраните его копию в менеджер паролей."
  say "Дальше: sh deploy/cloud/lecturer.sh up"
}

cmd_up() {
  require_env
  command -v docker >/dev/null || die "нужен Docker Engine с Compose v2"
  if command -v systemctl >/dev/null && ! systemctl is-enabled --quiet docker 2>/dev/null; then
    say "Совет: включите автозапуск Docker после перезагрузки: sudo systemctl enable --now docker"
  fi

  APP_GIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  APP_VERSION="$APP_GIT_SHA"
  export APP_GIT_SHA APP_VERSION

  compose up -d --build --wait

  # Ежечасная проверка сайта снаружи; журнал — deploy/cloud/check.log.
  if command -v crontab >/dev/null; then
    root="$(pwd)"
    line="0 * * * * cd $root && sh deploy/stand/check.sh $(domain) >> deploy/cloud/check.log 2>&1"
    ( crontab -l 2>/dev/null | grep -v 'deploy/stand/check.sh' ; echo "$line" ) | crontab -
  fi

  say ""
  say "Запущено. Проверяю сайт снаружи (первый сертификат выпускается до минуты)..."
  sleep 5
  if ! check_site; then
    if [ "$(mode)" = tunnel ]; then
      say "Сайт снаружи не отвечает. Запущен ли туннель и смотрит ли он на 127.0.0.1:$(env_value TUNNEL_PORT)?"
    else
      say "Сайт снаружи пока не отвечает. Проверьте DNS и порты 80/443, затем: sh deploy/cloud/lecturer.sh status"
    fi
  fi

  cat <<EOF

Сайт и мини-приложение: https://$(domain)/
В кабинете MAX для партнёров укажите ссылку мини-приложения: https://$(domain)/
EOF
  [ -n "$(env_value ADMIN_SETUP_TOKEN)" ] && say "Администратора ещё нет? sh deploy/cloud/lecturer.sh admin"
  return 0
}

cmd_admin() {
  require_env
  [ -n "$(env_value ADMIN_SETUP_TOKEN)" ] || die "создание администратора закрыто (ADMIN_SETUP_TOKEN пуст)"
  # Скрипт ходит в core по внутренней сети compose, порт core наружу не нужен.
  network="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$(compose ps -q core)")"
  docker run --rm -it --network "$network" \
    -e ADMIN_SETUP_TOKEN="$(env_value ADMIN_SETUP_TOKEN)" -e CORE_BASE_URL=http://core:8080 \
    -v "$(pwd)/deploy/admin:/admin:ro" python:3.12-alpine python /admin/provision.py
  say "Когда администратор создан и вход проверен: sh deploy/cloud/lecturer.sh lock-setup"
}

cmd_seed() {
  require_env
  compose run --rm -e SEED_PUBLIC_URL="https://$(domain)" seed
}

cmd_lock_setup() {
  require_env
  set_value ADMIN_SETUP_TOKEN ""
  compose up -d --force-recreate --wait core
  say "Создание администратора закрыто."
}

cmd_backup() {
  require_env
  compose exec -T db-backup /usr/local/bin/create-pair.sh
}

case "${1:-help}" in
  init) cmd_init ;;
  up) cmd_up ;;
  admin) cmd_admin ;;
  seed) cmd_seed ;;
  lock-setup) cmd_lock_setup ;;
  status) require_env; compose ps; say ""; check_site ;;
  logs) require_env; shift; compose logs -f --tail=100 "$@" ;;
  update) git pull --ff-only && cmd_up ;;
  backup) cmd_backup ;;
  stop) require_env; compose stop ;;
  compose) require_env; shift; compose "$@" ;;
  help|-h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "неизвестная команда '$1'. Список: sh deploy/cloud/lecturer.sh help" ;;
esac
