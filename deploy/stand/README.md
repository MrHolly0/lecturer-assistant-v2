# Стенд: развёртывание

Пока нет VPS — временный стенд за туннелем Tuna (https://lecturer-assistant.ru.tuna.am): [TUNNEL.md](TUNNEL.md). Ниже — VPS.

Начальный сервер: Linux, 4 vCPU, 8 ГБ RAM, Docker Engine с плагином Compose ≥ 2.24.4, открыты 80 и 443
(TCP и UDP для HTTP/3). Домен: A-запись указывает на IP сервера.

Лимиты контейнеров, JVM/БД, импортов и границы масштабирования:
[ресурсные бюджеты](../../docs/runtime-budgets.md). Это стартовая конфигурация,
ёмкость по числу одновременных занятий подтверждается отдельной нагрузкой.

## Первый запуск

```bash
git clone <репозиторий> lecturer-assistant && cd lecturer-assistant
git checkout <ветка сдачи>
sh deploy/stand/vps-up.sh            # .env, сборка, запуск, проверка, cron раз в час
```

`vps-up.sh` вызывает `init-env.sh --vps`: он спросит домен, почту, токен и публичное имя бота (если их
ещё нет в `.env`) и сгенерирует секреты. `.env` создаётся с правами 600. Его содержимое сразу сохранить в менеджер
паролей: там пароль базы, `JWT_SECRET`, ключ адаптера, секрет вебхука.

Caddy сам выпускает сертификат Let's Encrypt при первом запросе к домену и продлевает
его. MAX не принимает самоподписанные сертификаты, поэтому стенд без настоящего домена
для бота не годится.

Адаптер MAX при старте регистрирует вебхук `https://<домен><MAX_WEBHOOK_PATH>` и удаляет
прочие подписки бота. Поэтому бот с этим токеном должен быть подключён только к одному
стенду.

## Первый администратор и тестовый набор

`init-env.sh` не включает установочный endpoint автоматически. На новой установке перед запуском задайте в `.env` случайный `ADMIN_SETUP_TOKEN` длиной не менее 32 символов (`openssl rand -hex 32`). После запуска создайте администратора локально командой `python3 deploy/admin/provision.py` либо создайте тестовый набор:

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm seed
```

Три пароля `SEED_PASSWORD_*` уже сгенерированы `init-env.sh`. После успешного создания администратора удалите `ADMIN_SETUP_TOKEN` из `.env` и примените изменения командой `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate core`. Если используется туннель, во всех командах добавьте `-f docker-compose.tunnel.yml`.

## После запуска — в кабинете MAX для партнёров

«Чат-боты» → бот → ⋮ → «Настройки» → ссылка мини-приложения: `https://<домен>/`.

## Что где

| Что | Где |
|---|---|
| Сайт и мини-приложение | `https://<домен>/` |
| API | `https://<домен>/api/v1/...` |
| Вебхук MAX | `https://<домен><MAX_WEBHOOK_PATH>` — путь случайный, в `.env` |
| Проверка доступности | `https://<домен>/health` → `{"status":"UP"}` |
| Резервные копии | пары `pair-<UTC stamp>` в `BACKUP_DESTINATION`, ежедневно, retention `BACKUP_KEEP_DAYS` |

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

## Пара резервной копии и проверка свежести

Сервис `db-backup` создаёт одну директорию `pair-<UTC stamp>` с `database.dump`,
`blob-data.tar.gz` и `manifest.properties`. В manifest записаны SHA-256 файлов, версия
приложения, git SHA, версия Flyway, версия формата и имя исходного compose-проекта.
Перед публикацией пары проверяются `pg_restore --list`, целостность tar и контрольные суммы.
Сервис берёт общий PostgreSQL advisory lock с blob storage на время создания пары, чтобы
в этот период не менялись файлы презентаций/слайдов. `BACKUP_DESTINATION` монтируется read-write;
разместите его на отдельном диске или заранее смонтированном независимом storage, задайте
доступ на запись контейнеру и включите внешний монитор его доступности.

После `.env` setup проверьте:

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps db-backup
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=30 db-backup
```

Состояние `healthy` подтверждает наличие пары не старше 26 часов и успешную повторную
проверку её hashes/архивов. Полная проверка выбранной пары:

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db-backup \
  /usr/local/bin/verify-pair.sh /backup-destination/pair-<UTC stamp>
```

Каталог назначения не коммитят. Внешний backup transport/storage должен иметь собственную
аутентификацию, шифрование и retention; каталог на том же диске, что и контейнеры, не считается
независимой копией.

## Restore drill в отдельном compose-проекте

Каждый релиз проверяйте на синтетической паре с тестовой презентацией/PNG и известной тестовой
учётной записью. Не используйте production restore для drill. Команды ниже создают отдельную
PostgreSQL, named volume и compose-сеть с новым project name. Сначала убедитесь, что такой project
name и volume ещё не существуют. Файл env храните в `/tmp`, не добавляйте его в репозиторий.

```sh
restore_project=restore-drill-$(date -u +%Y%m%d%H%M%S)
restore_env="$(mktemp)"
chmod 600 "$restore_env"
cat > "$restore_env" <<'ENV'
POSTGRES_DB=postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=restore-drill-only
POSTGRES_PORT=55439
DB_URL=jdbc:postgresql://postgres:5432/restore_target
DB_USERNAME=postgres
DB_PASSWORD=restore-drill-only
CORE_PORT=18089
WEB_PORT=18090
ENV

docker compose -p "$restore_project" --env-file "$restore_env" -f docker-compose.yml up -d postgres
blob_volume="${restore_project}_blob-data"
docker volume create "$blob_volume"
docker run --rm -v "$blob_volume:/target" alpine:3.20 \
  sh -c 'printf "%s" "$1" > /target/.restore-target-id' sh "$restore_project"
docker run --rm --network "${restore_project}_default" \
  -e PGHOST=postgres -e PGUSER=postgres -e PGPASSWORD=restore-drill-only -e PGDATABASE=postgres \
  -v "$BACKUP_DESTINATION/pair-<UTC stamp>:/pair:ro" \
  -v "$blob_volume:/target" -v "$PWD/deploy/stand/backup:/backup-scripts:ro" \
  postgres:16-alpine sh -ceu 'createdb -h "$PGHOST" -U "$PGUSER" restore_target && \
    /backup-scripts/restore-pair.sh /pair restore_target /target "$1"' sh "$restore_project"
docker compose -p "$restore_project" --env-file "$restore_env" -f docker-compose.yml up -d --build core
```

`restore-pair.sh` verifies manifest hashes and file formats, requires the explicit target marker,
refuses a database equal to `PGDATABASE`, and accepts only an existing empty target database and
empty blob volume. It never drops or cleans a database or overwrites files. The restore target uses
a separate Compose project and its own `restore-drill_blob-data` volume. Open a known synthetic
lecture and fetch one slide image through the restored core before recording the drill as passed.
Compare aggregate counts and the manifest SHA/version with the selected pair. On failure, remove
only the isolated `restore_project` after confirming its name and volumes belong to this drill.

`restore-pair.sh` intentionally restores into a new empty target. For a real recovery, stop writers,
create a separately named recovery Compose project, restore and verify it first, then cut over using
a reviewed deployment procedure. Do not point this script at an existing project or volume.
