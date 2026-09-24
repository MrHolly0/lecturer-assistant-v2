#!/usr/bin/env sh
# Сторож стенда: проверка снаружи, самолечение и уведомление. Запускать по расписанию
# (launchd: deploy/stand/watch-install.sh; на VPS — cron из vps-up.sh вызывает check.sh).
#   sh deploy/stand/watch.sh          — одна проверка; код выхода 1, если стенд не работает
# Что делает по шагам:
#   1. check.sh на публичный адрес (PUBLIC_DOMAIN или SITE_DOMAIN из .env);
#   2. если не прошло — проверяет Caddy локально, чтобы отличить «упали контейнеры»
#      от «не работает туннель»; контейнеры поднимает сам (compose up -d);
#   3. проверяет, что последняя копия базы свежее 26 часов;
#   4. каждая проверка — строка с временем в deploy/stand/check.log (это же журнал доступности
#      стенда за период оценки); уведомление macOS — одно на падение и одно на восстановление,
#      а не на каждую проверку.
# Область действия: только compose-проект стенда (lecturer-stand). Никаких docker restart по
# маске и «поднять все упавшие»: на машине живут чужие контейнеры.
set -u

cd "$(dirname "$0")/../.."
LOG=deploy/stand/check.log
env_value() { [ -f .env ] && sed -n "s/^$1=//p" .env | tail -1 || true; }

DOMAIN="${1:-$(env_value PUBLIC_DOMAIN)}"
[ -n "$DOMAIN" ] || DOMAIN="$(env_value SITE_DOMAIN)"
[ -n "$DOMAIN" ] || { echo "Не задан PUBLIC_DOMAIN или SITE_DOMAIN в .env" >&2; exit 2; }
TUNNEL_PORT="$(env_value TUNNEL_PORT)"; TUNNEL_PORT="${TUNNEL_PORT:-18088}"

# Тот же набор файлов, что использует tunnel.sh; на VPS туннельного оверлея нет.
if [ -n "$(env_value PUBLIC_DOMAIN)" ]; then
  FILES="-f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml"
  PROJECT=lecturer-stand
else
  FILES="-f docker-compose.yml -f docker-compose.prod.yml"
  PROJECT="$(basename "$(pwd)")"
fi
export SITE_DOMAIN="$DOMAIN" ACME_EMAIL="${ACME_EMAIL:-$(env_value ACME_EMAIL)}"
: "${ACME_EMAIL:=unused@example.invalid}"
export ACME_EMAIL TUNNEL_PORT

stamp() { date '+%Y-%m-%d %H:%M:%S'; }
note() { echo "$(stamp) $*" >> "$LOG"; }
STATE=deploy/stand/.watch-state
notify() {
  command -v osascript >/dev/null && \
    osascript -e "display notification \"$*\" with title \"Стенд Ассистент лектора\"" >/dev/null 2>&1
  return 0
}
alert() {
  echo "ТРЕВОГА: $*" >&2
  if [ "$(cat "$STATE" 2>/dev/null)" = FAIL ]; then
    note "ТРЕВОГА (продолжается): $*"
  else
    note "ТРЕВОГА: $*"
    notify "$*"
    echo FAIL > "$STATE"
  fi
}

problem=""
if ! out="$(sh deploy/stand/check.sh "$DOMAIN" 2>&1)"; then
  # Публично не отвечает. Различаем слои.
  if curl -fsS --max-time 5 "http://127.0.0.1:$TUNNEL_PORT/health" >/dev/null 2>&1; then
    problem="стенд жив локально, но не отвечает по https://$DOMAIN — не запущен клиент туннеля, нет сети или закончилась оплата тарифа"
  else
    note "локально не отвечает, поднимаю контейнеры"
    # shellcheck disable=SC2086
    docker compose -p "$PROJECT" $FILES up -d --wait >> "$LOG" 2>&1
    sleep 5
    if out="$(sh deploy/stand/check.sh "$DOMAIN" 2>&1)"; then
      note "восстановлен после перезапуска контейнеров"
    else
      problem="контейнеры перезапущены, но стенд по-прежнему не отвечает: $(echo "$out" | grep FAIL | tr '\n' ';')"
    fi
  fi
fi

# Свежесть резервной копии базы (создаётся раз в сутки, первая — через 5 минут после старта).
newest="$(ls -t deploy/stand/backups/*.dump 2>/dev/null | head -1)"
if [ -z "$newest" ]; then
  [ -z "$problem" ] && note "копий базы пока нет (первая создаётся через 5 минут после старта)"
else
  age=$(( $(date +%s) - $(stat -f %m "$newest" 2>/dev/null || stat -c %Y "$newest") ))
  if [ "$age" -gt 93600 ]; then
    problem="${problem:+$problem; }последняя копия базы старше 26 часов ($newest)"
  fi
fi

if [ -n "$problem" ]; then
  alert "$problem"
  exit 1
fi
note "OK https://$DOMAIN"
if [ "$(cat "$STATE" 2>/dev/null)" = FAIL ]; then
  note "ВОССТАНОВЛЕН https://$DOMAIN"
  notify "Стенд снова доступен: https://$DOMAIN"
fi
echo OK > "$STATE"
exit 0
