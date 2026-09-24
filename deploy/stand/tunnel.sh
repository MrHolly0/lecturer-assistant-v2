#!/usr/bin/env sh
# Стенд за туннелем одной командой: весь продукт в compose, печать публичного адреса.
# Туннель — либо внешний с постоянным адресом (PUBLIC_DOMAIN в .env, например Tuna,
# клиент которого уже смотрит на 127.0.0.1:TUNNEL_PORT), либо ngrok, который скрипт
# запускает сам, если PUBLIC_DOMAIN пуст.
#   sh deploy/stand/tunnel.sh          — поднять (или перезапустить с новым адресом)
#   sh deploy/stand/tunnel.sh stop     — остановить туннель и контейнеры (данные сохраняются)
#   sh deploy/stand/tunnel.sh status   — текущий адрес и состояние сервисов
# Нужны: Docker Compose v2; для ngrok — ngrok с authtoken (`ngrok config add-authtoken ...`), .env
# с секретами (sh deploy/stand/init-env.sh). Постоянный адрес: NGROK_DOMAIN в .env —
# бесплатный статический домен из кабинета ngrok (Domains), например abc-xyz.ngrok-free.app.
set -eu

cd "$(dirname "$0")/../.."
STATE_DIR=deploy/stand/.tunnel
mkdir -p "$STATE_DIR"

env_value() { [ -f .env ] && sed -n "s/^$1=//p" .env | tail -1 || true; }

TUNNEL_PORT="${TUNNEL_PORT:-$(env_value TUNNEL_PORT)}"; TUNNEL_PORT="${TUNNEL_PORT:-18088}"
NGROK_DOMAIN="${NGROK_DOMAIN:-$(env_value NGROK_DOMAIN)}"
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-$(env_value PUBLIC_DOMAIN)}"
# Почта Let's Encrypt за туннелем не используется, но prod-оверлей требует значение.
ACME_EMAIL="${ACME_EMAIL:-unused@example.invalid}"
export TUNNEL_PORT ACME_EMAIL

compose() {
  docker compose -p lecturer-stand \
    -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml "$@"
}

ngrok_url() {
  for port in 4040 4041 4042 4043; do
    url="$(curl -s --max-time 2 "http://127.0.0.1:$port/api/tunnels" 2>/dev/null \
      | sed -n 's/.*"public_url":"\(https:[^"]*\)".*/\1/p' | head -1)"
    [ -n "$url" ] && { echo "$url"; return 0; }
  done
  return 1
}

stop_ngrok() {
  if [ -f "$STATE_DIR/ngrok.pid" ]; then
    kill "$(cat "$STATE_DIR/ngrok.pid")" 2>/dev/null || true
    rm -f "$STATE_DIR/ngrok.pid"
  fi
}

case "${1:-up}" in
  stop)
    stop_ngrok
    SITE_DOMAIN=stopped compose stop
    exit 0
    ;;
  status)
    [ -n "$PUBLIC_DOMAIN" ] && echo "внешний туннель: https://$PUBLIC_DOMAIN" || ngrok_url || echo "ngrok не запущен"
    SITE_DOMAIN="$(cat "$STATE_DIR/domain" 2>/dev/null || echo unknown)" compose ps
    exit 0
    ;;
esac

[ -n "$(env_value JWT_SECRET)" ] && [ -n "$(env_value MAX_WEBHOOK_PATH)" ] || {
  echo "В .env нет секретов стенда. Выполните: sh deploy/stand/init-env.sh" >&2; exit 1; }

# 1. Туннель. Смотрит на Caddy (он разводит /webhook/* на адаптер MAX, остальное — на веб).
stop_ngrok
if [ -n "$PUBLIC_DOMAIN" ]; then
  PUBLIC_URL="https://$PUBLIC_DOMAIN"
else
  command -v ngrok >/dev/null || { echo "ngrok не установлен: brew install ngrok" >&2; exit 1; }
  ngrok config check >/dev/null 2>&1 || { echo "Нет конфигурации ngrok: ngrok config add-authtoken <токен>" >&2; exit 1; }
  if [ -n "$NGROK_DOMAIN" ]; then
    nohup ngrok http "127.0.0.1:$TUNNEL_PORT" --url "https://$NGROK_DOMAIN" --log stdout \
      > "$STATE_DIR/ngrok.log" 2>&1 &
  else
    nohup ngrok http "127.0.0.1:$TUNNEL_PORT" --log stdout > "$STATE_DIR/ngrok.log" 2>&1 &
  fi
  echo $! > "$STATE_DIR/ngrok.pid"

  i=0
  until PUBLIC_URL="$(ngrok_url)"; do
    i=$((i + 1))
    [ "$i" -gt 20 ] && { echo "ngrok не поднял туннель, журнал: $STATE_DIR/ngrok.log" >&2; tail -5 "$STATE_DIR/ngrok.log" >&2; exit 1; }
    sleep 1
  done
fi
SITE_DOMAIN="${PUBLIC_URL#https://}"
export SITE_DOMAIN

PREVIOUS="$(cat "$STATE_DIR/domain" 2>/dev/null || true)"
echo "$SITE_DOMAIN" > "$STATE_DIR/domain"

# 2. Продукт. Адаптер MAX получает новый адрес и сам перерегистрирует вебхук при старте.
compose up -d --build --wait
if [ -n "$PUBLIC_DOMAIN" ]; then
  sh deploy/stand/check.sh "$PUBLIC_DOMAIN" || echo "Внешний туннель не отвечает: запущен ли его клиент и смотрит ли он на 127.0.0.1:$TUNNEL_PORT?" >&2
fi

cat <<EOF

Стенд поднят.
  Публичный адрес (мини-приложение и веб): $PUBLIC_URL/
  Проверка доступности:                     $PUBLIC_URL/health
  Вебхук MAX (зарегистрирован адаптером):   $PUBLIC_URL/webhook/…  (путь — MAX_WEBHOOK_PATH в .env)
EOF
if [ "$SITE_DOMAIN" != "$PREVIOUS" ]; then
  cat <<EOF

  АДРЕС ИЗМЕНИЛСЯ (был: ${PREVIOUS:-нет}). Вручную: кабинет MAX для партнёров →
  «Чат-боты» → бот → ⋮ → «Настройки» → ссылка мини-приложения: $PUBLIC_URL/
EOF
fi
