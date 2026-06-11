# Telegram Adapter

Минимальный long-poll адаптер фазы 4. Core не импортирует Telegram SDK: адаптер общается с core только через Channel SPI.

```bash
CORE_URL=http://localhost:8080 \
CHANNEL_INTERNAL_API_KEY=phase-4-local-channel-key \
TELEGRAM_BOT_TOKEN=... \
node adapters/telegram/telegram-adapter.mjs
```

Реализовано:

- `getUpdates` long polling.
- Нормализация `COMMAND/TEXT/CALLBACK` в `/internal/v1/channels/telegram/inbound`.
- Poll `channel.outbox` и delivery reports.
- Лимиты отправки: 25 сообщений/с глобально, 1 сообщение/с на чат.
- Обработка Telegram `429 retry_after`.

`file_id`-кэш и `EDIT_LAST` хранит core в таблицах `channel.tg_file_cache` и `channel.thread_refs`; полная отправка изображений подключается после появления стабильных slide blob-ref в контентном API.
