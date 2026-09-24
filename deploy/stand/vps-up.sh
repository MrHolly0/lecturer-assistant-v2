#!/usr/bin/env sh
# Стенд на VPS одной командой: .env (если ещё не готов), сборка и запуск, проверка
# доступности снаружи, cron с проверкой раз в час. Запускать на сервере из корня клона:
#   sh deploy/stand/vps-up.sh          — стенд без данных
#   sh deploy/stand/vps-up.sh --seed   — плюс тестовые данные (учётки, курс, лекция, вопросы)
# Повторный запуск безопасен: обновляет контейнеры после git pull и не трогает секреты.
set -eu

cd "$(dirname "$0")/../.."

command -v docker >/dev/null || { echo "Нужен Docker Engine с Compose v2" >&2; exit 1; }
# Автозапуск Docker после перезагрузки сервера; контейнеры поднимет restart: unless-stopped.
if command -v systemctl >/dev/null && ! systemctl is-enabled --quiet docker 2>/dev/null; then
  echo "Включите автозапуск Docker: sudo systemctl enable --now docker" >&2
fi

sh deploy/stand/init-env.sh --vps
DOMAIN="$(sed -n 's/^SITE_DOMAIN=//p' .env | tail -1)"

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --wait

# Проверка доступности раз в час; журнал — deploy/stand/check.log.
ROOT="$(pwd)"
LINE="0 * * * * cd $ROOT && sh deploy/stand/check.sh $DOMAIN >> deploy/stand/check.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'deploy/stand/check.sh' ; echo "$LINE" ) | crontab -

echo
echo "Проверка стенда (Let's Encrypt выпускает сертификат при первом запросе, до минуты):"
sleep 5
sh deploy/stand/check.sh "$DOMAIN" || {
  echo "Не все проверки прошли. Повторите через минуту: sh deploy/stand/check.sh $DOMAIN" >&2
  exit 1
}
if [ "${1:-}" = "--seed" ]; then
  docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm \
    -e SEED_PUBLIC_URL="https://$DOMAIN" seed
fi

cat <<EOF

Стенд: https://$DOMAIN/
Осталось вручную: кабинет MAX для партнёров → «Чат-боты» → бот → ⋮ → «Настройки» →
ссылка мини-приложения https://$DOMAIN/ ; остальное — таблица в deploy/stand/TUNNEL.md.
Клиент туннеля на прежней машине остановите, сторожа снимите:
  sh deploy/stand/watch-install.sh remove
EOF
[ "${1:-}" = "--seed" ] || echo "Тестовые данные: sh deploy/stand/vps-up.sh --seed"
