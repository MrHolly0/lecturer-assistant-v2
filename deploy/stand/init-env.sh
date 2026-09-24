#!/usr/bin/env sh
# Готовит .env стенда: генерирует секреты, которых нет, которые пусты или совпадают с
# шаблоном из .env.example. Остальные значения (в том числе токен бота) не трогает.
# Перед правкой сохраняет копию в .env.bak. Запускать из корня репозитория:
#   sh deploy/stand/init-env.sh          — туннель ngrok (домен подставит tunnel.sh)
#   sh deploy/stand/init-env.sh --vps    — VPS: дополнительно спросит домен и почту
# После запуска сохраните .env в менеджер паролей; в git он не попадает (.gitignore).
set -eu

ENV_FILE="${ENV_FILE:-.env}"
EXAMPLE_FILE="${EXAMPLE_FILE:-.env.example}"
MODE="${1:-tunnel}"

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
[ -s "$ENV_FILE" ] && cp -p "$ENV_FILE" "$ENV_FILE.bak"

current() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
example() { [ -f "$EXAMPLE_FILE" ] && sed -n "s/^$1=//p" "$EXAMPLE_FILE" | tail -1 || true; }

set_value() {
  key="$1"; value="$2"
  if grep -q "^$key=" "$ENV_FILE"; then
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" 'index($0, k"=")==1 {print k"="v; next} {print}' "$ENV_FILE" > "$tmp"
    cat "$tmp" > "$ENV_FILE" && rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
  echo "  $key — задан"
}

# Секрет генерируется, если его нет, он пуст или равен шаблону из .env.example.
ensure_secret() {
  key="$1"; bytes="$2"; prefix="${3:-}"
  value="$(current "$key")"
  if [ -z "$value" ] || [ "$value" = "$(example "$key")" ]; then
    set_value "$key" "$prefix$(openssl rand -hex "$bytes")"
  fi
}

ensure_plain() {
  key="$1"; value="$2"
  [ "$(current "$key")" = "$value" ] || set_value "$key" "$value"
}

ask() {
  key="$1"; prompt="$2"; secret="${3:-}"
  [ -n "$(current "$key")" ] && return 0
  printf '%s: ' "$prompt"
  [ -n "$secret" ] && { stty -echo 2>/dev/null || true; }
  read -r answer
  [ -n "$secret" ] && { stty echo 2>/dev/null || true; echo; }
  [ -n "$answer" ] || { echo "$key обязателен" >&2; exit 1; }
  set_value "$key" "$answer"
}

echo "Проверяю $ENV_FILE:"
ask MAX_BOT_TOKEN "Токен бота MAX (ввод скрыт)" secret
if [ "$MODE" = "--vps" ]; then
  ask SITE_DOMAIN "Домен стенда (A-запись уже указывает на этот сервер)"
  ask ACME_EMAIL "Почта для уведомлений Let's Encrypt"
fi

ensure_secret POSTGRES_PASSWORD 24
ensure_plain DB_PASSWORD "$(current POSTGRES_PASSWORD)"
ensure_secret JWT_SECRET 48
ensure_secret SLIDE_IMAGE_URL_SECRET 48
ensure_secret CHANNEL_INTERNAL_API_KEY 32
ensure_secret MAX_WEBHOOK_SECRET 32
ensure_secret MAX_WEBHOOK_PATH 24 /webhook/
ensure_secret SEED_PASSWORD_ADMIN 12
ensure_secret SEED_PASSWORD_LECTURER 12
ensure_secret SEED_PASSWORD_ASSISTANT 12
ensure_plain REQUIRE_STRONG_JWT_SECRET true
ensure_plain REFRESH_COOKIE_SECURE true

echo "Готово. Права на $ENV_FILE — 600. Сохраните его в менеджер паролей."
