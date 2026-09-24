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

## Восстановление базы из копии

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop core
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T db-backup \
  pg_restore --clean --if-exists -d lecturer_assistant /backups/<файл>.dump
docker compose -f docker-compose.yml -f docker-compose.prod.yml start core
```
