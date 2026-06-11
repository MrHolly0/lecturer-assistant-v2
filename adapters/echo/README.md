# Echo Adapter

REST-заглушка для проверки Channel SPI без внешних аккаунтов.

```bash
CORE_URL=http://localhost:8080 \
CHANNEL_INTERNAL_API_KEY=phase-4-local-channel-key \
node adapters/echo/echo-adapter.mjs
```

Команды в stdin:

- `in user-1 /help` — отправить inbound event от echo-пользователя.
- `poll` — забрать outbox один раз и сразу отправить delivery report.
- `quit` — выйти.
