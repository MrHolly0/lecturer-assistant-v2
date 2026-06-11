# Lecturer Assistant v2

Новый репозиторий v2 по `docs/ARCHITECTURE_V2.md`.

## Быстрый старт фазы 0

```bash
mvn verify
cd web && npm install && npm run gen:api && npm run build
docker compose up --build
```

После старта:

- web: http://localhost:3000
- core: http://localhost:8080/api/v1/system/info
- postgres: localhost:5432

## Структура

- `core/` — модульный монолит Spring Boot.
- `adapters/telegram/` — будущий внешний процесс Telegram-адаптера.
- `web/` — SPA лектора/студента.
- `e2e/` — будущие сквозные проверки.
- `deploy/` — инструкции и compose-профили.
- `docs/` — копия ТЗ, ADR и проектная документация.

