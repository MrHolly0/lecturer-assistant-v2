#!/usr/bin/env sh
# Проверка доступности стенда снаружи: сайт, API, вебхук MAX, срок сертификата.
# Использование: sh deploy/stand/check.sh lecture.example.ru
# Код выхода 0 — всё доступно, 1 — есть проблема (годится для cron и внешнего мониторинга).
set -u

DOMAIN="${1:?укажите домен стенда}"
BASE="https://$DOMAIN"
fail=0

check() {
  name="$1"; url="$2"; expected="$3"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url")"
  if [ "$code" = "$expected" ]; then
    echo "OK   $name: $code"
  else
    echo "FAIL $name: $code, ожидали $expected ($url)"
    fail=1
  fi
}

check "мини-приложение" "$BASE/" 200
check "core /health" "$BASE/health" 200
# Адаптер отвечает 404 на любой запрос без секрета — важно, что ответ пришёл от него
# по HTTPS, а не ошибка TLS или 502 от Caddy.
check "вебхук MAX" "$BASE/webhook/probe" 404

end="$(echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null \
  | openssl x509 -noout -enddate -issuer 2>/dev/null)"
if [ -n "$end" ]; then
  echo "OK   сертификат: $(echo "$end" | tr '\n' ' ')"
else
  echo "FAIL сертификат не получен"
  fail=1
fi

exit "$fail"
