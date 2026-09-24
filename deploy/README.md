# Deploy

| Файл | Назначение |
|---|---|
| `docker-compose.yml` | весь продукт локально: `postgres`, `core`, `converter`, `web`, `max-adapter`, `telegram-adapter` |
| `docker-compose.prod.yml` | оверлей стенда: Caddy с HTTPS, резервные копии базы, обязательные секреты |
| `docker-compose.dev.yml` | hot-reload для разработки, профиль `hot-reload` |
| `docker-compose.tunnel.yml` | временный HTTPS через cloudflared quick tunnel, профиль `tunnel` |
| `caddy/Caddyfile` | маршруты стенда: `/api`, `/ws`, `/health` → core, `/webhook/*` → адаптер MAX, остальное → web |
| `converter/` | конвертер презентаций: LibreOffice Impress + poppler, `POST /convert`, `GET /health` |
| `stand/` | развёртывание стенда, генерация `.env`, проверка доступности — см. [stand/README.md](stand/README.md) |
| `BUILD_TIME.md` | замер времени сборки образов с условиями |

Секреты в репозиторий не попадают: локально работают значения по умолчанию из compose,
на стенде — `.env`, созданный `stand/init-env.sh`.
