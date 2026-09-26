# Стенд: развёртывание

Пока нет VPS — временный стенд за туннелем Tuna (https://lecturer-assistant.ru.tuna.am): [TUNNEL.md](TUNNEL.md). Ниже — VPS.

Сервер: Linux, 2 vCPU, 4 ГБ RAM, Docker Engine с плагином Compose v2, открыты 80 и 443
(TCP и UDP для HTTP/3). Домен: A-запись указывает на IP сервера.

## Первый запуск

```bash
git clone <репозиторий> lecturer-assistant && cd lecturer-assistant
git checkout <ветка сдачи>
sh deploy/stand/vps-up.sh            # .env, сборка, запуск, проверка, cron раз в час
```

`vps-up.sh` вызывает `init-env.sh --vps`: он спросит домен, почту и токен бота (если их
ещё нет в `.env`) и сгенерирует секреты. `.env` создаётся с правами 600. Его содержимое сразу сохранить в менеджер
паролей: там пароль базы, `JWT_SECRET`, ключ адаптера, секрет вебхука.

Caddy сам выпускает сертификат Let's Encrypt при первом запросе к домену и продлевает
его. MAX не принимает самоподписанные сертификаты, поэтому стенд без настоящего домена
для бота не годится.

Адаптер MAX при старте регистрирует вебхук `https://<домен><MAX_WEBHOOK_PATH>` и удаляет
прочие подписки бота. Поэтому бот с этим токеном должен быть подключён только к одному
стенду.

## После запуска — в кабинете MAX для партнёров

«Чат-боты» → бот → ⋮ → «Настройки» → ссылка мини-приложения: `https://<домен>/`.

## Что где

| Что | Где |
|---|---|
| Сайт и мини-приложение | `https://<домен>/` |
| API | `https://<домен>/api/v1/...` |
| Вебхук MAX | `https://<домен><MAX_WEBHOOK_PATH>` — путь случайный, в `.env` |
| Проверка доступности | `https://<домен>/health` → `{"status":"UP"}` |
| Резервные копии базы | `deploy/stand/backups/*.dump`, раз в сутки, хранятся 14 дней |

Наружу открыты только 80 и 443. Postgres и core слушают 127.0.0.1 сервера.

## Перезапуск и обновление

У всех сервисов `restart: unless-stopped`: после перезагрузки сервера стек поднимается
сам, если служба Docker включена (`systemctl enable docker`).

```bash
git pull
sh deploy/stand/vps-up.sh
```

## Мониторинг

`check.sh` проверяет сайт, `/health`, доступность вебхука и сертификат; код выхода 1
при любой проблеме. `vps-up.sh` ставит его в cron раз в час, журнал —
`deploy/stand/check.log` (строки FAIL — повод разбираться).

Для оповещений нужен внешний монитор (например, UptimeRobot) на `https://<домен>/health`
с интервалом 5 минут и уведомлением на почту дежурного.

## Проверка копии в отдельной базе

Сначала нужно доказать, что dump читается и схема восстанавливается. Рабочую базу
для этой проверки не останавливают и не изменяют:

```bash
# Имя тестовой БД должно быть новым; файл выбирается по точному имени.
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db-backup \
  createdb lecturer_assistant_restore_verify
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db-backup \
  pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
  -d lecturer_assistant_restore_verify /backups/<файл>.dump
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db-backup \
  psql -v ON_ERROR_STOP=1 -d lecturer_assistant_restore_verify \
  -c 'select count(*), max(installed_rank) from shared.flyway_schema_history;'
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db-backup \
  dropdb lecturer_assistant_restore_verify
```

Перед `createdb` убедитесь, что БД с таким именем нет. Для приёмки сравнивают только
агрегатные счётчики, а не сами персональные данные.

## Аварийное восстановление рабочей базы

Эта операция разрушительна для текущего состояния БД: её выполняют только после выбора
проверенного dump и фиксации окна недоступности.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop core
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db-backup \
  sh -ceu 'pg_restore --clean --if-exists --exit-on-error --single-transaction \
    --no-owner --no-privileges -d "$PGDATABASE" "/backups/$1"' sh '<файл>.dump'
docker compose -f docker-compose.yml -f docker-compose.prod.yml start core
```

`pg_dump` сохраняет только PostgreSQL. Файлы презентаций и PNG лежат в `blob-data`; для полного
восстановления нужна отдельная копия этого тома, согласованная по времени с dump БД.

## Согласованная копия БД и `blob-data`

Чтобы БД и файлы относились к одному состоянию, на короткое окно останавливают компоненты,
которые могут писать данные. `postgres`, `db-backup`, `web` и Caddy продолжают работать.
Обработчик `trap` обязателен: он запускает компоненты обратно даже при ошибке копирования.

```bash
stamp='<UTC, например 20260925T105839Z>'
compose=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

restart_writers() {
  "${compose[@]}" start converter core max-adapter >/dev/null 2>&1 || true
}
trap restart_writers EXIT INT TERM
"${compose[@]}" stop max-adapter core converter

"${compose[@]}" exec -T db-backup sh -ceu '
  tmp="/backups/lecturer_assistant-quiesced-$1.dump.tmp"
  pg_dump -Fc -f "$tmp"
  mv "$tmp" "/backups/lecturer_assistant-quiesced-$1.dump"
' sh "$stamp"

# Точное имя тома сначала получают через docker inspect core-контейнера.
docker run --rm \
  -v '<compose-project>_blob-data:/source:ro' \
  -v "$PWD/deploy/stand/backups:/backups" \
  postgres:16-alpine sh -ceu '
    tar -C /source -czf "/backups/blob-data-$1.tar.gz.tmp" .
    mv "/backups/blob-data-$1.tar.gz.tmp" "/backups/blob-data-$1.tar.gz"
  ' sh "$stamp"

restart_writers
trap - EXIT INT TERM
```

После запуска компонентов проверяют `/health`, SHA-256 обоих файлов и читаемость архива без
печати списка файлов:

```bash
sha256sum deploy/stand/backups/*-$stamp.*
docker run --rm -v "$PWD/deploy/stand/backups:/backups:ro" postgres:16-alpine \
  tar -tzf "/backups/blob-data-$stamp.tar.gz" >/dev/null
```

Dump дополнительно восстанавливают в отдельную БД по процедуре выше. Оба файла должны храниться
и переноситься как одна пара; каталог `deploy/stand/backups` не коммитят.
