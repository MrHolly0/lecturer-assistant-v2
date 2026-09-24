#!/usr/bin/env sh
# Создаёт .env для стенда со случайными секретами. Запускать на сервере из корня
# репозитория: sh deploy/stand/init-env.sh
# Существующий .env не перезаписывается. Секреты после создания сохранить в менеджер
# паролей; в git .env не попадает (.gitignore).
set -eu

ENV_FILE="${ENV_FILE:-.env}"

if [ -e "$ENV_FILE" ]; then
  echo "$ENV_FILE уже существует — не трогаю. Удалите его сами, если нужно создать заново." >&2
  exit 1
fi

rand() { openssl rand -hex "$1"; }

printf 'Домен стенда (A-запись уже указывает на этот сервер), например lecture.example.ru: '
read -r SITE_DOMAIN
printf 'Почта для уведомлений Let'"'"'s Encrypt: '
read -r ACME_EMAIL
printf 'Токен бота MAX (ввод скрыт): '
stty -echo 2>/dev/null || true
read -r MAX_BOT_TOKEN
stty echo 2>/dev/null || true
echo

[ -n "$SITE_DOMAIN" ] && [ -n "$ACME_EMAIL" ] && [ -n "$MAX_BOT_TOKEN" ] || {
  echo "Домен, почта и токен обязательны." >&2
  exit 1
}

POSTGRES_PASSWORD="$(rand 24)"

umask 077
cat > "$ENV_FILE" <<EOF
# Стенд. Создано deploy/stand/init-env.sh $(date +%Y-%m-%d). Не коммитить.
SITE_DOMAIN=$SITE_DOMAIN
ACME_EMAIL=$ACME_EMAIL

POSTGRES_DB=lecturer_assistant
POSTGRES_USER=lecturer
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
DB_USERNAME=lecturer
DB_PASSWORD=$POSTGRES_PASSWORD

JWT_SECRET=$(rand 48)
SLIDE_IMAGE_URL_SECRET=$(rand 48)
CHANNEL_INTERNAL_API_KEY=$(rand 32)
REQUIRE_STRONG_JWT_SECRET=true
REFRESH_COOKIE_SECURE=true

MAX_BOT_TOKEN=$MAX_BOT_TOKEN
MAX_WEBHOOK_PATH=/webhook/$(rand 24)
MAX_WEBHOOK_SECRET=$(rand 32)
EOF

echo "Готово: $ENV_FILE (права 600). Сохраните его содержимое в менеджер паролей."
